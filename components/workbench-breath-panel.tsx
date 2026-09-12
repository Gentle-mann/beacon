"use client";

import { useEffect, useRef } from "react";
import { useBreathSource } from "@/hooks/use-breath-source";

export type BreathControls = ReturnType<typeof useBreathSource>;

export function WorkbenchBreathPanel({ breath }: { breath: BreathControls }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { snapshot, micStatus, reading, waveform } = breath;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    let frame = 0;
    const draw = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      const scale = window.devicePixelRatio || 1;
      if (element.width !== Math.round(width * scale) || element.height !== Math.round(height * scale)) {
        element.width = Math.round(width * scale);
        element.height = Math.round(height * scale);
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = "#26262a";
      context.lineWidth = 1;
      for (let i = 1; i <= 5; i++) {
        context.beginPath(); context.moveTo(width * i / 6, 0); context.lineTo(width * i / 6, height); context.stroke();
      }
      const points = waveform.current;
      const max = Math.max(0.01, ...points.map((point) => point.value));
      const now = performance.now();
      context.strokeStyle = "#6fd38a";
      context.lineWidth = 2;
      context.beginPath();
      if (!points.length) { context.moveTo(0, height - 12); context.lineTo(width, height - 12); }
      points.forEach((point, i) => {
        const x = width * (1 - (now - point.at) / 30_000);
        const y = height - 12 - (point.value / max) * (height - 24);
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
      if (micStatus === "listening") frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [waveform, micStatus]);

  const listening = micStatus === "listening";
  const statuses = {
    calibrating: "Calibrating the sound level…",
    quiet: "Low signal. Move closer to the microphone; the slider stays active.",
    listening: "Listening for repeatable breaths. Allow 20–30 seconds; slow rates need longer.",
    tracking: "Rough microphone estimate is active.",
  };
  return (
    <section className="breath-card" aria-labelledby="breath-title">
      <div className="breath-heading"><span className="eyebrow">Gate 3 · breathing input</span><span className="source-badge">{snapshot.mode === "mic" ? "Microphone estimate" : "Manual slider"}</span></div>
      <h2 id="breath-title">Find your starting rhythm</h2>
      <div className="bpm-readout"><output aria-label="Current source BPM">{snapshot.bpm.toFixed(1)}</output><span>breaths / min</span></div>
      <label className="slider-label" htmlFor="manual-bpm"><span>Manual BPM · always available</span><strong>{snapshot.manualBpm}</strong></label>
      <input id="manual-bpm" type="range" min="4" max="20" step="0.5" value={snapshot.manualBpm} onChange={(event) => breath.setManualBpm(Number(event.target.value))} />
      <div className="range-labels"><span>4 · slower</span><span>20 · faster</span></div>
      <p className="muted">Moving the slider switches off the mic and takes over immediately.</p>
      <div className="breath-actions">
        <button className="btn btn-start" onClick={() => void breath.startMic()} disabled={micStatus === "requesting" || listening}>Use microphone</button>
        {(micStatus === "requesting" || listening) && <button className="btn" onClick={breath.stopMic}>{micStatus === "requesting" ? "Cancel microphone" : "Stop microphone"}</button>}
      </div>
      <p className={micStatus === "error" ? "mic-status alert" : "mic-status"} role="status">{breath.message || (micStatus === "requesting" ? "Waiting for microphone permission. You can cancel or use the slider." : listening ? statuses[reading.quality] : "Microphone off. The slider is ready.")}</p>
      <div className="waveform-heading"><span>Live sound envelope · last 30s</span><span>Detected: {listening && reading.bpm !== null ? `${reading.bpm.toFixed(1)} BPM` : "—"}</span></div>
      <canvas ref={canvas} className="breath-waveform" role="img" aria-label="Live microphone amplitude envelope over the last thirty seconds. Flat when microphone is off." />
      <p className="muted">Audio is processed in this browser. Sound-based estimate only: speech, noise, or two audible bursts per breath can fool it. Check the trace and use the slider when needed.</p>
    </section>
  );
}
