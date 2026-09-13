"use client";

import { useBreathSource } from "@/hooks/use-breath-source";
import { BreathWaveform } from "@/components/breath-waveform";

export type BreathControls = ReturnType<typeof useBreathSource>;

export function WorkbenchBreathPanel({ breath }: { breath: BreathControls }) {
  const { snapshot, micStatus, reading, waveform } = breath;

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
      <BreathWaveform waveform={waveform} listening={listening} className="breath-waveform" ariaLabel="Live microphone amplitude envelope over the last thirty seconds. Flat when microphone is off." />
      <p className="muted">Audio is processed in this browser. Sound-based estimate only: speech, noise, or two audible bursts per breath can fool it. Check the trace and use the slider when needed.</p>
    </section>
  );
}
