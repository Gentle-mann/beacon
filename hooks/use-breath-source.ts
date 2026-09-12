"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BreathDetector, rmsAmplitude, type BreathReading } from "@/lib/breath-detector";
import { createBreathSource } from "@/lib/breath-source";

type MicStatus = "off" | "requesting" | "listening" | "error";
const EMPTY: BreathReading = { envelope: 0, bpm: null, quality: "calibrating", airflow: "settling", speechSuspect: false };

export function useBreathSource() {
  const [source] = useState(() => createBreathSource());
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [micStatus, setMicStatus] = useState<MicStatus>("off");
  const [message, setMessage] = useState("");
  const [reading, setReading] = useState(EMPTY);
  const waveform = useRef<{ at: number; value: number }[]>([]);
  const requestId = useRef(0);
  const release = useRef<(() => void) | null>(null);

  const stopMic = useCallback(() => {
    requestId.current += 1;
    release.current?.();
    release.current = null;
    source.setMicBpm(null);
    waveform.current = [];
    setReading(EMPTY);
    setMicStatus("off");
    setMessage("");
  }, [source]);

  useEffect(() => {
    // Backgrounded rAF cannot provide a fresh estimate or a trustworthy trace.
    const hide = () => { if (document.hidden) stopMic(); };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      requestId.current += 1;
      release.current?.();
      release.current = null;
    };
  }, [stopMic]);

  const startMic = useCallback(async () => {
    stopMic();
    const id = requestId.current;
    setMicStatus("requesting");
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      setMicStatus("error");
      setMessage("Microphone unavailable here. Open localhost or HTTPS, or use the slider.");
      return;
    }
    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let input: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let animation = 0;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(animation);
      stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      input?.disconnect();
      analyser?.disconnect();
      if (context) {
        context.onstatechange = null;
        if (context.state !== "closed") void context.close().catch(() => {});
      }
    };
    const fail = (text: string) => {
      cleanup();
      if (id !== requestId.current) return;
      release.current = null;
      source.setMicBpm(null);
      waveform.current = [];
      setReading(EMPTY);
      setMicStatus("error");
      setMessage(text);
    };
    try {
      // Start the audio context from the click, before the permission await.
      context = new AudioContext();
      release.current = cleanup;
      const resumed = context.resume();
      void resumed.catch(() => {});
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false,
      });
      if (id !== requestId.current || closed) {
        stream.getTracks().forEach((track) => track.stop());
        cleanup();
        return;
      }
      await resumed;
      if (id !== requestId.current || closed) { cleanup(); return; }
      if (context.state !== "running") throw new Error("Audio context did not start");
      if (!stream.getAudioTracks().some((track) => track.readyState === "live")) {
        fail("Microphone disconnected before it started. The manual slider is active.");
        return;
      }
      input = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      input.connect(analyser); // Never connect the microphone to speakers.
      const samples = new Float32Array(analyser.fftSize);
      const detector = new BreathDetector();
      let lastSample = -Infinity;
      setMicStatus("listening");
      stream.getTracks().forEach((track) => {
        track.onended = () => fail("Microphone disconnected. The manual slider is active.");
      });
      context.onstatechange = () => {
        if (context?.state !== "running") fail("Microphone paused. Restart it or use the slider.");
      };
      const sample = (at: number) => {
        if (id !== requestId.current || closed) return;
        if (at - lastSample >= 50) {
          lastSample = at;
          try {
            analyser!.getFloatTimeDomainData(samples);
            const next = detector.update(rmsAmplitude(samples), at);
            waveform.current = [...waveform.current.filter((point) => at - point.at <= 30_000), { at, value: next.envelope }];
            source.setMicBpm(next.speechSuspect ? null : next.bpm);
            setReading(next);
          } catch {
            fail("Microphone analysis stopped. The manual slider is active.");
            return;
          }
        }
        animation = requestAnimationFrame(sample);
      };
      animation = requestAnimationFrame(sample);
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      fail(denied ? "Microphone permission was denied. The manual slider is active." : "Could not start the microphone. Check your input device or use the slider.");
    }
  }, [source, stopMic]);

  const setManualBpm = useCallback((bpm: number) => {
    stopMic();
    source.setManualBpm(bpm);
  }, [source, stopMic]);

  return { source, snapshot, micStatus, message, reading, waveform, startMic, stopMic, setManualBpm };
}
