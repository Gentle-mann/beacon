"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BREATH, BreathDetector, rmsOf } from "@/lib/breath";

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
  const [cycles, setCycles] = useState(0);
  const [level, setLevel] = useState(0);
  /** Sampled once a second so we can see whether the mic is stable or jumpy. */
  const [bpmLog, setBpmLog] = useState<BpmLogEntry[]>([]);

  const detector = useRef(new BreathDetector());
  const history = useRef<{ env: number[]; base: number[] }>({ env: [], base: [] });
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSample = useRef(0);

  const stopMic = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
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

      const tick = () => {
        raf.current = requestAnimationFrame(tick);
        const now = performance.now();
        if (now - lastSample.current < BREATH.sampleMs) return;
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
        setCycles(state.cycles);
        setDetectedBpm(state.bpm);
      };
      raf.current = requestAnimationFrame(tick);

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
    cycles,
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
