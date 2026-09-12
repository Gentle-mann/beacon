"use client";

import { useReactor, useReactorMessage } from "@reactor-team/js-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CREDITS_PER_SECOND,
  type OrbisMessage,
  chunkIndexOf,
  stamp,
  unwrapOrbisMessage,
} from "@/lib/orbis";
import {
  ARC,
  AUDIO_PROMPT,
  OPENING_PROMPT,
  SEED,
  buildPrompt,
  phaseForRate,
  targetRateAt,
} from "@/lib/scene";

export type PromptLogEntry = {
  at: number;
  clock: string;
  prompt: string;
  /** session_chunk at the moment of send, so we can measure landing latency. */
  sentAtChunk: number | null;
  /** session_chunk when the model acknowledged, filled in on prompt_accepted. */
  acceptedAtChunk: number | null;
  source: string;
};

export type ErrorLogEntry = {
  at: number;
  clock: string;
  /** Verbatim. Never summarised, never prettified. */
  text: string;
};

const PROMPT_LOG_KEY = "orbis.promptLog.v1";

/** Survives a mid-sentence reload — the prompt log is a demo artifact. */
function loadPromptLog(): PromptLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROMPT_LOG_KEY);
    return raw ? (JSON.parse(raw) as PromptLogEntry[]) : [];
  } catch {
    return [];
  }
}

const MAX_RECOVERY_ATTEMPTS = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useOrbisSession(resetJwt: () => void) {
  const { status, connect, disconnect, reconnect, sendCommand } = useReactor(
    (state) => ({
      status: state.status,
      connect: state.connect,
      disconnect: state.disconnect,
      reconnect: state.reconnect,
      sendCommand: state.sendCommand,
    }),
  );

  // ---- session state -------------------------------------------------------
  const [sessionChunk, setSessionChunk] = useState<number | null>(null);
  const [framesEmitted, setFramesEmitted] = useState<number | null>(null);
  const [firstFrameAt, setFirstFrameAt] = useState<number | null>(null);
  const [activePrompt, setActivePrompt] = useState("");
  const [availableResolutions, setAvailableResolutions] = useState<string[]>([]);
  const [runStarted, setRunStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [viewMounted, setViewMounted] = useState(false);

  // ---- logs ----------------------------------------------------------------
  const [promptLog, setPromptLog] = useState<PromptLogEntry[]>([]);
  const [errorLog, setErrorLog] = useState<ErrorLogEntry[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  /** Every transport status transition, timestamped. The record that tells us
   *  whether a mid-run death is a fluke or a clock. */
  const [transportLog, setTransportLog] = useState<string[]>([]);

  // ---- billing meter -------------------------------------------------------
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [frozenCredits, setFrozenCredits] = useState<number | null>(null);
  const creditsRef = useRef(0);
  const [generatingAt, setGeneratingAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ---- reconnect bookkeeping ----------------------------------------------
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [openSessions, setOpenSessions] = useState<number | null>(null);
  const [restating, setRestating] = useState(false);
  /** Read once at start, so a hunted seed makes a run reproducible. */
  const [seed, setSeed] = useState<number>(SEED);
  const seedRef = useRef<number>(SEED);

  // ---- entrainment arc -----------------------------------------------------
  /** BreathSource: the manual slider today, the mic later. Same input either way. */
  const [breathBpm, setBreathBpm] = useState(14);
  const breathBpmRef = useRef(14);
  const [arcRunning, setArcRunning] = useState(false);
  const [arcElapsed, setArcElapsed] = useState(0);
  const [targetBpm, setTargetBpm] = useState<number | null>(null);
  const [phaseIndex, setPhaseIndex] = useState<number | null>(null);
  const arcStartedAt = useRef<number | null>(null);
  const arcStartBpm = useRef(14);
  const arcRunningRef = useRef(false);
  const lastSendChunk = useRef<number | null>(null);
  const intentionalDisconnect = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousStatus = useRef(status);
  /** Read inside the recovery loop, which must see live status, not a closure. */
  const statusRef = useRef(status);
  statusRef.current = status;

  const everReady = useRef(false);
  /** The one and only recovery driver. See `recover` below. */
  const recoverRef = useRef<(() => Promise<void>) | null>(null);
  const recovering = useRef(false);
  const resumeArc = useRef(false);
  /** Set when the operator pressed the combined Warm+Start action. */
  const autoStart = useRef(false);
  /** Lets the status effect reach startRun, which is defined further down. */
  const startRunRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Drift test / Gate 2 spine: re-send a byte-identical prompt every N chunks.
   * Driven off chunk_complete, never a wall-clock timer — observed cadence is
   * ~1.96s/chunk against the 1.833s the audio sample count implies, so a timer
   * would slew out of phase with the chunk boundaries the model actually
   * lands prompts on.
   */
  const restateRef = useRef(false);
  const restateEveryRef = useRef(2);
  const lastRestateChunk = useRef<number | null>(null);
  const sendPromptRef = useRef<
    ((prompt: string, source: string) => Promise<unknown>) | null
  >(null);
  const currentPromptRef = useRef("");
  const chunkRef = useRef<number | null>(null);
  const conditionsReadyResolver = useRef<(() => void) | null>(null);

  const connected = status === "ready";

  useEffect(() => setPromptLog(loadPromptLog()), []);

  /** Truth from the server about what is alive and billing. */
  const refreshOpenSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      const body = (await response.json()) as {
        open?: unknown[];
        error?: string;
      };
      if (!body.error) setOpenSessions(body.open?.length ?? 0);
    } catch {
      /* the panel degrades to "?" rather than breaking the demo */
    }
  }, []);

  /** Independent of any session: what is alive on the account right now. */
  useEffect(() => {
    void refreshOpenSessions();
    const id = setInterval(() => void refreshOpenSessions(), 15_000);
    return () => clearInterval(id);
  }, [refreshOpenSessions]);

  /** 1Hz tick drives the credit meter and the elapsed clocks. */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const pushError = useCallback((text: string) => {
    setErrorLog((current) =>
      [{ at: Date.now(), clock: stamp(), text }, ...current].slice(0, 50),
    );
  }, []);

  const pushEvent = useCallback((type: string) => {
    setEvents((current) => [`${stamp()}  ${type}`, ...current].slice(0, 40));
  }, []);

  // ---- message handling ----------------------------------------------------
  useReactorMessage((raw: unknown) => {
    const message = unwrapOrbisMessage(raw);
    if (!message?.type) return;

    // Debug tap: every raw model message, newest first, on window.__orbisRaw.
    // The model's message schema is pass-through JSON that appears in neither
    // the SDK types nor the WASM, so this is the only way to see real field
    // names. Cheap, and it has already earned its place once.
    if (typeof window !== "undefined") {
      const w = window as unknown as { __orbisRaw?: unknown[] };
      w.__orbisRaw ??= [];
      w.__orbisRaw.unshift({ at: stamp(), raw, unwrapped: message });
      if (w.__orbisRaw.length > 60) w.__orbisRaw.length = 60;
    }

    if (message.type === "chunk_complete") {
      const index = chunkIndexOf(message);
      if (index !== null) {
        chunkRef.current = index;
        setSessionChunk(index);
      }
      if (typeof message.frames_emitted === "number") {
        setFramesEmitted(message.frames_emitted);
        // First chunk emits 0 frames while the upscaler primes. The first chunk
        // that emits any frame is the real "picture is on screen" moment.
        if (message.frames_emitted > 0) {
          setFirstFrameAt((current) => current ?? Date.now());
        }
      }
      // ---- the entrainment loop ------------------------------------------
      // The ramp is a function of elapsed seconds, but a SEND only ever happens
      // on a chunk boundary: prompts land at the next boundary anyway, and the
      // observed cadence (~1.96s) drifts from the documented 1.833s, so a timer
      // would slowly fall out of phase with the thing it is trying to hit.
      if (arcRunningRef.current && index !== null && arcStartedAt.current) {
        const elapsed = (Date.now() - arcStartedAt.current) / 1000;
        setArcElapsed(elapsed);

        if (elapsed >= ARC.durationS) {
          arcRunningRef.current = false;
          setArcRunning(false);
          setPhase("arc complete");
          pushEvent(`arc complete at ${elapsed.toFixed(1)}s`);
        } else {
          const since =
            lastSendChunk.current === null
              ? Infinity
              : index - lastSendChunk.current;
          if (since >= ARC.chunksPerSend) {
            lastSendChunk.current = index;
            const rate = targetRateAt(elapsed, arcStartBpm.current);
            const { index: pi, phase: clause } = phaseForRate(
              rate,
              arcStartBpm.current,
            );
            setTargetBpm(rate);
            setPhaseIndex(pi);
            void sendPromptRef.current?.(
              buildPrompt(clause),
              `arc ${elapsed.toFixed(0)}s ${rate.toFixed(1)}bpm p${pi}`,
            );
          }
        }
        return;
      }

      // Restate on the chunk boundary, not on a timer.
      if (restateRef.current && index !== null && currentPromptRef.current) {
        const since =
          lastRestateChunk.current === null
            ? Infinity
            : index - lastRestateChunk.current;
        if (since >= restateEveryRef.current) {
          lastRestateChunk.current = index;
          void sendPromptRef.current?.(currentPromptRef.current, "restate");
        }
      }

      // chunk_complete is high-frequency; keep it out of the event feed.
      return;
    }

    if (message.type === "state") {
      // state mirrors the chunk counter, so the panel stays live even if a
      // chunk_complete is missed.
      const stateChunk = chunkIndexOf(message);
      if (stateChunk !== null) {
        chunkRef.current = stateChunk;
        setSessionChunk(stateChunk);
      }
      if (typeof message.started === "boolean") setRunStarted(message.started);
      if (typeof message.paused === "boolean") setPaused(message.paused);
      if (message.available_resolutions?.length) {
        setAvailableResolutions(message.available_resolutions.map(String));
      }
      return;
    }

    pushEvent(message.type);

    if (message.type === "conditions_ready") {
      conditionsReadyResolver.current?.();
      conditionsReadyResolver.current = null;
    }

    if (message.type === "prompt_accepted") {
      if (typeof message.prompt === "string") setActivePrompt(message.prompt);
      setPromptLog((current) => {
        const next = [...current];
        const pending = next.findIndex((entry) => entry.acceptedAtChunk === null);
        if (pending !== -1) {
          next[pending] = { ...next[pending], acceptedAtChunk: chunkRef.current };
        }
        try {
          window.localStorage.setItem(PROMPT_LOG_KEY, JSON.stringify(next));
        } catch {
          /* quota or private mode — the log is a nicety, not the demo */
        }
        return next;
      });
    }

    if (message.type === "generation_started") {
      setRunStarted(true);
      setPaused(false);
      setGeneratingAt((current) => current ?? Date.now());
      setPhase("generating");
      if (resumeArc.current) {
        resumeArc.current = false;
        pushEvent("resuming arc from t=0 after recovery");
        beginArcRef.current();
      }
    }
    if (message.type === "generation_paused") setPaused(true);
    if (message.type === "generation_resumed") setPaused(false);
    if (
      message.type === "generation_complete" ||
      message.type === "generation_reset"
    ) {
      setRunStarted(false);
      setPaused(false);
      setPhase("stopped");
    }

    if (message.type === "command_error") {
      // Verbatim, including the whole payload when reason is missing.
      const detail =
        message.reason ?? JSON.stringify(message).slice(0, 400) ?? "rejected";
      pushError(`command_error [${message.command ?? "unknown"}]: ${detail}`);
      if (message.command === "start") {
        setRunStarted(false);
        setPhase("start rejected");
      }
    }
  });

  // ---- auto-reconnect ------------------------------------------------------
  useEffect(() => {
    const was = previousStatus.current;
    previousStatus.current = status;

    if (was !== status) {
      const line = `${stamp()}  ${was} -> ${status}`;
      setTransportLog((current) => [line, ...current].slice(0, 100));
      if (typeof window !== "undefined") {
        const w = window as unknown as { __transport?: string[] };
        w.__transport ??= [];
        w.__transport.unshift(line);
      }
    }

    if (status === "ready") {
      everReady.current = true;
      if (autoStart.current && !runStarted) {
        autoStart.current = false;
        void startRunRef.current?.();
      }
      setConnectedAt((current) => current ?? Date.now());
      setRecoveryAttempt(0);
      setViewMounted(true);
      setPhase((current) =>
        current === "connecting" || current === "reconnecting"
          ? "connected"
          : current,
      );
      return;
    }

    if (status === "disconnected" && was !== "disconnected") {
      setRunStarted(false);
      setPaused(false);
      setViewMounted(false);
      if (intentionalDisconnect.current) {
        setPhase("killed");
        return;
      }
      // Unexpected drop: hand it to the single recovery owner.
      pushError(`transport: status -> disconnected (unplanned), recovering`);
      void recoverRef.current?.();
    }
  }, [pushError, status]);

  /** Starting the arc, callable from the UI and from recovery alike. */
  const beginArc = useCallback(() => {
    arcStartBpm.current = breathBpmRef.current;
    arcStartedAt.current = Date.now();
    lastSendChunk.current = null;
    arcRunningRef.current = true;
    setArcRunning(true);
    setArcElapsed(0);
    setTargetBpm(breathBpmRef.current);
    setPhase("arc running");
    pushEvent(
      `arc start ${breathBpmRef.current} bpm -> ${ARC.targetBpm} bpm over ${ARC.descentS}s`,
    );
  }, [pushEvent]);
  const beginArcRef = useRef(beginArc);
  beginArcRef.current = beginArc;

  /**
   * B. THE SINGLE RECOVERY OWNER.
   *
   * One driver, guarded by `recovering`, so nothing races the SDK's own retry
   * (that race produced "Already connected or connecting" during the sweep).
   *
   * Recovery is always a fresh run from t=0, never a resume: the model allows
   * exactly ONE concurrent session (`concurrent_sessions_per_model = 1`), so a
   * stale session and a new one are mutually exclusive by definition. That
   * means REAP FIRST, then connect — the earlier loop created a new session per
   * attempt, each one failing against the slot its predecessor still held.
   *
   * At a ~17s warm-up and a 90s arc, restarting is a stumble, not a death.
   */
  const recover = useCallback(async () => {
    if (recovering.current || intentionalDisconnect.current) return;
    recovering.current = true;
    everReady.current = false;

    // A dropped arc resumes from t=0 on the locked seed rather than picking up
    // mid-descent: the run is only 90s, the seed makes it reproducible, and a
    // partial descent leads the breather from the wrong place.
    resumeArc.current = arcRunningRef.current;
    arcRunningRef.current = false;
    setArcRunning(false);
    autoStart.current = true;

    try {
      for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt++) {
        if (intentionalDisconnect.current) break;
        setRecoveryAttempt(attempt);
        setPhase(`recovering (${attempt}/${MAX_RECOVERY_ATTEMPTS})`);

        // Never fight the SDK: if it has already climbed back, we are done.
        if (statusRef.current === "ready") {
          setPhase("recovered");
          break;
        }
        if (statusRef.current === "connecting" || statusRef.current === "waiting") {
          await sleep(2000);
          continue;
        }

        try {
          // Free the slot before asking for one. In a 1-session world this is
          // not optional.
          const reaped = await fetch("/api/sessions", { method: "DELETE" })
            .then((r) => r.json() as Promise<{ deleted?: string[] }>)
            .catch(() => ({ deleted: [] as string[] }));
          if (reaped.deleted?.length) {
            pushEvent(`recovery reaped ${reaped.deleted.length} session(s)`);
          }

          resetJwt(); // the old token owns a session that no longer exists
          await connect();
          setPhase("recovered");
          break;
        } catch (caught) {
          const detail =
            caught instanceof Error ? caught.message : String(caught);
          pushError(`recovery ${attempt}: ${detail}`);

          // 429 covers both our own quota and Reactor having no free capacity.
          // Capacity is not ours to fix, so back off rather than hammer it.
          const capacity = /no available capacity|no available servers/i.test(detail);
          const quota = /quota_exceeded|429/i.test(detail);
          const backoff = capacity
            ? Math.min(20000, 5000 * attempt)
            : quota
              ? Math.min(12000, 3000 * attempt)
              : Math.min(10000, 1500 * 2 ** (attempt - 1));
          if (capacity) setPhase(`waiting for Reactor capacity (${attempt})`);
          await sleep(backoff);
        }
      }

      if (statusRef.current !== "ready" && !intentionalDisconnect.current) {
        setPhase("recovery gave up — press WARM + START");
        pushError(
          `recovery exhausted after ${MAX_RECOVERY_ATTEMPTS} attempts; not retrying (a hard quota is not something a retry loop can fix)`,
        );
      }
    } finally {
      recovering.current = false;
    }
  }, [connect, pushError, pushEvent, resetJwt]);

  recoverRef.current = recover;

  // ---- command helpers -----------------------------------------------------
  const runAction = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      pushError(
        `${label}: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * No 15-second ceiling. The starter timed out waiting for conditions_ready
   * after 15s, but session startup is measured in minutes, so that throw fired
   * before the model had woken up. Generous ceiling, and it reports progress.
   */
  const waitForConditionsReady = (timeoutMs = 300_000) => {
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        conditionsReadyResolver.current = null;
        reject(
          new Error(
            `conditions_ready did not arrive within ${Math.round(
              timeoutMs / 1000,
            )}s`,
          ),
        );
      }, timeoutMs);
      conditionsReadyResolver.current = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    return { promise, cancel: () => clearTimeout(timer) };
  };

  /** The single funnel every prompt goes through, so every prompt gets logged. */
  const sendPrompt = useCallback(
    async (prompt: string, source: string) => {
      const entry: PromptLogEntry = {
        at: Date.now(),
        clock: stamp(),
        prompt,
        sentAtChunk: chunkRef.current,
        acceptedAtChunk: null,
        source,
      };
      setPromptLog((current) => {
        const next = [entry, ...current].slice(0, 200);
        try {
          window.localStorage.setItem(PROMPT_LOG_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      setActivePrompt(prompt);
      const reply = await sendCommand("set_prompt", { prompt });
      const unwrapped = reply ? unwrapOrbisMessage(reply) : null;
      if (unwrapped?.type === "command_error") {
        pushError(`set_prompt: ${unwrapped.reason ?? "rejected"}`);
      }
      return unwrapped;
    },
    [pushError, sendCommand],
  );

  // ---- lifecycle -----------------------------------------------------------
  seedRef.current = seed;
  breathBpmRef.current = breathBpm;

  const warm = (thenStart = false) =>
    runAction("connect", async () => {
      autoStart.current = thenStart;
      intentionalDisconnect.current = false;
      setFrozenCredits(null);
      setPhase("connecting");
      setFirstFrameAt(null);
      setSessionChunk(null);
      setFramesEmitted(null);
      chunkRef.current = null;
      await connect();
    });

  /** Arms the model (seed, audio bed, opening prompt) and starts generating. */
  const startRun = () =>
    runAction("start", async () => {
      setPhase("arming");
      // Read once at start; must be set before start to make a run reproducible.
      await sendCommand("set_seed", { seed: seedRef.current });
      await sendCommand("set_audio_prompt", { prompt: AUDIO_PROMPT });

      // Deliberately no set_resolution. The 2k default is what we want, and
      // sending a tier we guessed is the documented way to get it rejected.

      const ready = waitForConditionsReady();
      currentPromptRef.current = OPENING_PROMPT;
      lastRestateChunk.current = null;
      await sendPrompt(OPENING_PROMPT, "opening");
      setPhase("waiting for conditions_ready");
      await ready.promise;

      setPhase("starting");
      await sendCommand("start", {});
      setRunStarted(true);
      setGeneratingAt((current) => current ?? Date.now());
    });

  startRunRef.current = startRun;
  sendPromptRef.current = sendPrompt;

  /** Prominent, deliberate, and the only path that suppresses auto-reconnect. */
  const killSession = async () => {
    intentionalDisconnect.current = true;

    setRunStarted(false);
    setPaused(false);
    setPhase("killing");

    // Unmount ReactorView before the WebRTC tracks it is playing are closed.
    setViewMounted(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await runAction("disconnect", () => disconnect());

    // Belt and braces: the SDK only deletes the session while it still holds
    // the token that created it. Reap server-side with the API key so a kill is
    // always a real kill, never a session left billing in the dark.
    await runAction("reap", async () => {
      const response = await fetch("/api/sessions", { method: "DELETE" });
      const body = (await response.json()) as {
        deleted?: string[];
        failed?: unknown[];
        error?: string;
      };
      if (body.error) throw new Error(body.error);
      if (body.deleted?.length) {
        pushEvent(`reaped ${body.deleted.length} session(s)`);
      }
      if (body.failed?.length) {
        pushError(`reap could not delete: ${JSON.stringify(body.failed)}`);
      }
    });

    everReady.current = false;
    resetJwt();
    // Freeze the meter at the run's final total rather than zeroing it — the
    // number you want is what the run just cost, and that was being wiped the
    // instant you killed it.
    setFrozenCredits(creditsRef.current);
    setConnectedAt(null);
    setGeneratingAt(null);
    setPhase("killed");
    void refreshOpenSessions();
  };


  // ---- derived -------------------------------------------------------------
  const connectedSeconds = connectedAt ? (now - connectedAt) / 1000 : 0;
  const generatingSeconds = generatingAt ? (now - generatingAt) / 1000 : 0;
  const liveCredits = Math.round(connectedSeconds * CREDITS_PER_SECOND);
  creditsRef.current = liveCredits || creditsRef.current;
  const creditsBurned = connectedAt ? liveCredits : (frozenCredits ?? 0);

  return {
    // connection
    status,
    connected,
    phase,
    recoveryAttempt,
    viewMounted,
    openSessions,
    // model state
    sessionChunk,
    framesEmitted,
    firstFrameAt,
    activePrompt,
    availableResolutions,
    runStarted,
    paused,
    muted,
    busy,
    // logs
    promptLog,
    errorLog,
    events,
    transportLog,
    // meter
    connectedAt,
    connectedSeconds,
    generatingSeconds,
    creditsBurned,
    // actions
    seed,
    setSeed,
    // entrainment
    breathBpm,
    setBreathBpm,
    arcRunning,
    arcElapsed,
    targetBpm,
    phaseIndex,
    startArc: beginArc,
    stopArc: () => {
      arcRunningRef.current = false;
      setArcRunning(false);
      setPhase("arc stopped");
    },
    restating,
    toggleRestate: () => {
      restateRef.current = !restateRef.current;
      lastRestateChunk.current = null;
      setRestating(restateRef.current);
    },
    warm,
    warmAndStart: () => warm(true),
    startRun,
    killSession,
    refreshOpenSessions,
    reapAll: async () => {
      await fetch("/api/sessions", { method: "DELETE" });
      void refreshOpenSessions();
    },
    sendPrompt,
    toggleMuted: () => setMuted((current) => !current),
    pause: () => runAction("pause", () => sendCommand("pause", {})),
    resume: () => runAction("resume", () => sendCommand("resume", {})),
    reset: () => runAction("reset", () => sendCommand("reset", {})),
    clearPromptLog: () => {
      setPromptLog([]);
      try {
        window.localStorage.removeItem(PROMPT_LOG_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

export type OrbisSession = ReturnType<typeof useOrbisSession>;
