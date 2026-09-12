"use client";

import { ReactorProvider } from "@reactor-team/js-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

import { BreathPanel } from "@/components/breath-panel";
import { OrbisPlayer } from "@/components/orbis-player";
import { useBreathSource } from "@/hooks/use-breath";
import { StatusPanel } from "@/components/status-panel";
import { useOrbisSession } from "@/hooks/use-orbis-session";
import { ORBIS_MODEL_NAME, ORBIS_TRACKS, requestReactorJwt } from "@/lib/orbis";

export function OrbisDemo() {
  // A session-scoped token owns only the sessions IT created. The SDK calls
  // this resolver more than once per connect (create session, then GET it), so
  // every call MUST return the same token or the second request 403s against
  // the session the first one created. The starter's memoisation was
  // load-bearing, not a bug.
  //
  // It is reset only by an intentional kill, never on an unplanned drop: after
  // a network blip the reconnect has to present the token that owns the live
  // session. Tokens last 6h, so holding one for the page lifetime is fine.
  const jwtPromise = useRef<Promise<string> | null>(null);
  const getJwt = useCallback(() => {
    jwtPromise.current ??= requestReactorJwt();
    return jwtPromise.current;
  }, []);
  const resetJwt = useCallback(() => {
    jwtPromise.current = null;
  }, []);

  return (
    <section className="demo-shell">
      <ReactorProvider
        apiUrl="https://api.reactor.inc"
        modelName={ORBIS_MODEL_NAME}
        modelTracks={[...ORBIS_TRACKS]}
        connectOptions={{ autoConnect: false }}
        jwtToken={getJwt}
      >
        <SessionShell resetJwt={resetJwt} />
      </ReactorProvider>
    </section>
  );
}

function SessionShell({ resetJwt }: { resetJwt: () => void }) {
  const [sliderBpm, setSliderBpm] = useState(14);
  const breath = useBreathSource(sliderBpm);

  // A ref, not a prop: the arc reads the rate at the instant it starts, and a
  // value that changes 20x a second should not re-run the session hook.
  // The arc starts from a MEDIAN of the last 5s with speech-tainted readings
  // removed, not the instantaneous value — see `stableBpm`.
  const breathRate = useRef(sliderBpm);
  breathRate.current = breath.stableBpm(5000);

  const session = useOrbisSession(resetJwt, breathRate);

  /**
   * Telemetry for stability testing. Samples once a second and ships a rolling
   * snapshot to disk every 5s, so a run done in the operator's own browser can
   * be read back and judged on numbers instead of impressions.
   *
   * The live values are read through a ref rather than captured in the effect's
   * closure. Depending on `breath`/`session` directly re-created both intervals
   * on EVERY render — and during an arc this component re-renders many times a
   * second, so the 5s shipper was destroyed long before it could fire and a
   * whole run logged nothing.
   *
   * Diagnostics only — nothing in the demo path depends on it.
   */
  const samples = useRef<object[]>([]);
  const runStart = useRef<number>(Date.now());
  /** Per-tab id, so two open tabs cannot overwrite each other's run. */
  const clientId = useRef<string>(Math.random().toString(36).slice(2, 10));
  const live = useRef({ breath, session });
  live.current = { breath, session };

  useEffect(() => {
    const tick = setInterval(() => {
      const { breath: b, session: se } = live.current;
      samples.current.push({
        t: Date.now() - runStart.current,
        detected: b.detectedBpm,
        effective: b.effectiveBpm,
        speech: b.speechSuspect,
        target: se.targetBpm,
        arcElapsed: se.arcRunning ? se.arcElapsed : null,
        level: Number(b.level.toFixed(5)),
        envelope: Number(b.envelope.toFixed(5)),
        cycles: b.cycles,
        rising: b.rising,
      });
      if (samples.current.length > 1200) samples.current.shift();
    }, 1000);

    const ship = setInterval(() => {
      if (!samples.current.length) return;
      void fetch("/api/breathlog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: live.current.breath.kind,
          clientId: clientId.current,
          samples: samples.current,
        }),
      }).catch(() => {});
    }, 5000);

    return () => {
      clearInterval(tick);
      clearInterval(ship);
    };
  }, []);

  return (
    <div className="session-grid">
      <OrbisPlayer
        mounted={session.viewMounted}
        connected={session.connected}
        muted={session.muted}
        status={session.status}
        phase={session.phase}
        runStarted={session.runStarted}
        framesEmitted={session.framesEmitted}
        busy={session.busy}
      />
      <div className="right-column">
        <BreathPanel
          breath={breath}
          sliderBpm={sliderBpm}
          setSliderBpm={setSliderBpm}
          targetBpm={session.targetBpm}
          arcRunning={session.arcRunning}
          disabled={session.arcRunning}
        />
        <StatusPanel session={session} />
      </div>
    </div>
  );
}
