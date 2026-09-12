"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BREATH, BreathDetector, median, rmsOf } from "@/lib/breath";

export type BreathSourceKind = "mic" | "slider";

export type BpmLogEntry = { t: number; bpm: number | null; source: BreathSourceKind };

/**
 * BreathSource. Two paths, one number out.
 *
 * The mic path is the demo; the slider is the path that always works. Switching
 * is a toggle with no reload and no teardown of the Orbis session, because the
 * room being loud is not a reason to lose a warmed session.
 */
export function useBreathSource(sliderBpm: number) {
  const [kind, setKind] = useState<BreathSourceKind>("slider");
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const [envelope, setEnvelope] = useState(0);
  const [rising, setRising] = useState(false);
  const [speechSuspect, setSpeechSuspect] = useState(false);
  /**
   * Rolling recent readings, for the median the arc starts from. The arc reads
   * the rate at the instant Start is pressed — which in practice is right after
   * the presenter has been TALKING to introduce the demo, and talking is
   * exactly what spikes the instantaneous read. The spike and the trigger
   * moment share a cause, so a single-instant read is the wrong sample.
   */
  const recent = useRef<{ t: number; bpm: number; speech: boolean }[]>([]);
  const [cycles, setCycles] = useState(0);
  const [level, setLevel] = useState(0);
  /** Sampled once a second so we can see whether the mic is stable or jumpy. */
  const [bpmLog, setBpmLog] = useState<BpmLogEntry[]>([]);

  const detector = useRef(new BreathDetector());
  const history = useRef<{ env: number[]; base: number[] }>({ env: [], base: [] });
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const sampler = useRef<ReturnType<typeof setInterval> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSample = useRef(0);

  const stopMic = useCallback(() => {
    if (sampler.current) clearInterval(sampler.current);
    sampler.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    setListening(false);
  }, []);

  const startMic = useCallback(async () => {
    setMicError("");
    try {
      // Echo cancellation and noise suppression are tuned to remove exactly the
      // kind of broadband non-speech sound a breath is, so they stay off.
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      stream.current = media;
      const audio = new AudioContext();
      ctx.current = audio;
      if (audio.state === "suspended") await audio.resume();

      const source = audio.createMediaStreamSource(media);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      detector.current.reset();
      history.current = { env: [], base: [] };

      // setInterval rather than requestAnimationFrame. rAF is tied to frame
      // production, so anything that stops compositing stops detection; a timer
      // is throttled when hidden but not stopped, and the detector is driven by
      // real timestamps, so a slower sample rate degrades the estimate instead
      // of freezing it.
      const tick = () => {
        const now = performance.now();
        lastSample.current = now;

        analyser.getFloatTimeDomainData(buffer);
        const rms = rmsOf(buffer);
        const state = detector.current.push(rms, now);

        history.current = {
          env: state.history,
          base: state.baselineHistory,
        };
        setLevel(rms);
        setEnvelope(state.envelope);
        setRising(state.rising);
        setSpeechSuspect(state.speechSuspect);
        setCycles(state.cycles);
        setDetectedBpm(state.bpm);

        if (state.bpm !== null && !state.stalled) {
          recent.current.push({
            t: now,
            bpm: state.bpm,
            speech: state.speechSuspect,
          });
          const cutoff = now - 15000;
          while (recent.current.length && recent.current[0].t < cutoff) {
            recent.current.shift();
          }
        }
      };
      sampler.current = setInterval(tick, BREATH.sampleMs);

      timer.current = setInterval(() => {
        setBpmLog((current) =>
          [
            { t: Date.now(), bpm: detector.current.bpm(), source: "mic" as const },
            ...current,
          ].slice(0, 400),
        );
      }, 1000);

      setListening(true);
      setKind("mic");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setMicError(message);
      setListening(false);
      setKind("slider");
    }
  }, []);

  useEffect(() => stopMic, [stopMic]);

  /**
   * The number the arc actually uses. Falls back to the slider whenever the mic
   * is off or has not yet seen two clean breaths, so there is never a moment
   * where the loop has no rate to work with.
   */
  const effectiveBpm =
    kind === "mic" && listening && detectedBpm !== null ? detectedBpm : sliderBpm;

  const usingDetected = kind === "mic" && listening && detectedBpm !== null;

  /**
   * The rate the ARC starts from: the median of the last few seconds, with
   * readings taken during sustained speech thrown away. Falls back to all
   * recent readings if speech covered the whole window, then to the
   * instantaneous value, then to the slider — so there is always a number.
   */
  const stableBpm = useCallback(
    (windowMs = 5000) => {
      if (kind !== "mic" || !listening) return sliderBpm;
      const now = performance.now();
      const inWindow = recent.current.filter((r) => now - r.t <= windowMs);
      const clean = inWindow.filter((r) => !r.speech);
      return (
        median(clean.map((r) => r.bpm)) ??
        median(inWindow.map((r) => r.bpm)) ??
        detectedBpm ??
        sliderBpm
      );
    },
    [detectedBpm, kind, listening, sliderBpm],
  );

  return {
    kind,
    listening,
    micError,
    detectedBpm,
    effectiveBpm,
    usingDetected,
    envelope,
    level,
    rising,
    speechSuspect,
    cycles,
    stableBpm,
    bpmLog,
    history,
    startMic,
    stopMic,
    useSlider: () => {
      setKind("slider");
    },
    useMic: () => {
      if (listening) setKind("mic");
      else void startMic();
    },
    clearBpmLog: () => setBpmLog([]),
  };
}

export type BreathSource = ReturnType<typeof useBreathSource>;
