"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { BreathSource } from "@/lib/breath-source";
import {
  advanceEntrainment, ARC_DURATION_MS, createEntrainmentState,
  integratedBreathCycles, promptAt, targetRate,
  type EntrainmentState, type TimestampedPrompt,
} from "@/lib/entrainment";

const FAKE_CHUNK_MS = 1_960;
type Preview = {
  state: EntrainmentState;
  elapsedMs: number;
  prompts: TimestampedPrompt[];
  playing: boolean;
  sourceMode: BreathSource["mode"];
};

/** The only timer-driven chunks in the app are this explicitly offline fixture. */
export const EntrainmentPanel = memo(function EntrainmentPanel({ source }: { source: BreathSource }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const playingRef = useRef<Preview | null>(null);
  const playing = preview?.playing ?? false;

  useEffect(() => {
    if (!playing) return;
    const initial = playingRef.current!;
    const monotonicStart = performance.now();
    let chunkIndex = 0;
    const chunks = setInterval(() => {
      const current = playingRef.current;
      if (!current?.playing) return;
      const elapsedMs = Math.min(ARC_DURATION_MS, performance.now() - monotonicStart);
      const result = advanceEntrainment(current.state, { chunkIndex: chunkIndex++, timestampMs: initial.state.startedAtMs + elapsedMs });
      const next = { ...current, state: result.state, elapsedMs, prompts: result.prompt ? [...current.prompts, result.prompt] : current.prompts };
      playingRef.current = next;
      setPreview(next);
    }, FAKE_CHUNK_MS);
    // Display-only clock; prompt selection happens exclusively on fake chunk events.
    const display = setInterval(() => {
      const current = playingRef.current;
      if (!current?.playing) return;
      const elapsedMs = Math.min(ARC_DURATION_MS, performance.now() - monotonicStart);
      const ended = elapsedMs >= ARC_DURATION_MS;
      const next = { ...current, elapsedMs, playing: !ended, state: ended ? { ...current.state, ended: true } : current.state };
      playingRef.current = next;
      setPreview(next);
    }, 100);
    return () => { clearInterval(chunks); clearInterval(display); };
  }, [playing]);

  function start(instant: boolean) {
    const startedAtMs = Date.now();
    let state = createEntrainmentState(source.getCurrentBpm(), startedAtMs);
    const prompts: TimestampedPrompt[] = [];
    if (instant) {
      for (let chunkIndex = 0; !state.ended; chunkIndex++) {
        const result = advanceEntrainment(state, { chunkIndex, timestampMs: startedAtMs + (chunkIndex + 1) * FAKE_CHUNK_MS });
        state = result.state;
        if (result.prompt) prompts.push(result.prompt);
      }
    }
    const next: Preview = { state, elapsedMs: instant ? ARC_DURATION_MS : 0, prompts, playing: !instant, sourceMode: source.mode };
    playingRef.current = next;
    setPreview(next);
  }

  function stop() {
    if (!preview) return;
    const next = { ...preview, playing: false };
    playingRef.current = next;
    setPreview(next);
  }

  function downloadLog() {
    if (!preview) return;
    const blob = new Blob([JSON.stringify({
      kind: "beacon-offline-entrainment", version: 1, simulated: true,
      startBpm: preview.state.startBpm, sourceMode: preview.sourceMode,
      startedAt: new Date(preview.state.startedAtMs).toISOString(),
      fakeChunkMs: FAKE_CHUNK_MS,
      prompts: preview.prompts.map((prompt) => ({ ...prompt, at: new Date(prompt.timestampMs).toISOString() })),
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "beacon-offline-prompts.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const startBpm = preview?.state.startBpm ?? 12;
  const elapsed = preview?.elapsedMs ?? 0;
  const sample = promptAt(startBpm, elapsed);
  const complete = preview?.state.ended ?? false;
  const cycle = integratedBreathCycles(startBpm, elapsed) % 1;
  const swell = (1 - Math.cos(cycle * Math.PI * 2)) / 2;
  const yFor = (bpm: number) => 108 - (bpm - 4) / 16 * 94;
  const curve = Array.from({ length: 91 }, (_, second) => `${second === 0 ? "M" : "L"}${second / 90 * 460 + 10},${yFor(targetRate(startBpm, second * 1_000))}`).join(" ");
  return (
    <section className="breath-card" aria-labelledby="ramp-title">
      <div className="breath-heading"><span className="eyebrow">Gate 4 · entrainment ramp</span><span className="source-badge">Offline simulation</span></div>
      <h2 id="ramp-title">Settle into a slower rhythm</h2>
      <p className="muted">Capture the current source, ease toward 6 BPM by 75 seconds, then hold until 90 seconds. Rates already below 6 stay there.</p>
      <div className="ramp-live">
        <div className="bpm-readout"><output aria-label="Target BPM">{preview ? sample.targetBpm.toFixed(1) : "—"}</output><span>target BPM</span></div>
        <div className="phase-cue" style={{ transform: `scale(${preview && !complete ? 0.8 + swell * 0.2 : 0.8})` }}><span>{!preview ? "Ready" : complete ? "Complete" : !playing ? "Stopped" : sample.phase === "inhale" ? "Inhale" : "Exhale"}</span></div>
      </div>
      <div className="ramp-caption"><span>{preview ? `Captured ${startBpm.toFixed(1)} BPM · ${preview.sourceMode}` : "Start a preview to capture your source"}</span><strong aria-label="Arc elapsed">{(elapsed / 1_000).toFixed(1)} / 90s</strong></div>
      <svg className="ramp-chart" viewBox="0 0 480 125" role="img" aria-label={`Rate curve from ${startBpm} BPM toward ${Math.min(startBpm, 6)} BPM by 75 seconds`}>
        <line x1="10" y1={yFor(6)} x2="470" y2={yFor(6)} stroke="#343438" strokeDasharray="4 4" />
        <line x1={10 + 460 * 75 / 90} y1="6" x2={10 + 460 * 75 / 90} y2="114" stroke="#343438" />
        <path d={curve} stroke="#6fd38a" strokeWidth="2.5" fill="none" />
        {preview && <circle cx={10 + elapsed / ARC_DURATION_MS * 460} cy={yFor(sample.targetBpm)} r="4" fill="#b8f0cb" />}
      </svg>
      <div className="range-labels"><span>0s · start</span><span>75s · hold</span><span>90s · stop</span></div>
      <div className="breath-actions">
        <button className="btn btn-start" onClick={() => start(false)} disabled={playing}>Play 90s preview</button>
        <button className="btn" onClick={() => start(true)} disabled={playing}>Simulate full 90s</button>
        {playing && <button className="btn" onClick={stop}>Stop preview</button>}
      </div>
      <p className="muted">Each preview captures its starting BPM once. Change the source, then start again to use a different rate. No model session is opened.</p>
      <div className="prompt-log-heading"><h3>Simulated prompt log <span className="count" aria-label="Prompt count">{preview?.prompts.length ?? 0}</span></h3><button className="link" onClick={downloadLog} disabled={!preview?.prompts.length}>Export JSON</button></div>
      <ol className="preview-log" aria-label="Simulated prompts">
        {[...(preview?.prompts ?? [])].reverse().map((prompt) => (
          <li key={prompt.timestampMs}><div><time dateTime={new Date(prompt.timestampMs).toISOString()}>{new Date(prompt.timestampMs).toISOString().slice(11, 23)} UTC</time><span>+{(prompt.elapsedMs / 1000).toFixed(2)}s · {prompt.targetBpm.toFixed(2)} BPM · {prompt.phase}</span></div><p>{prompt.text}</p></li>
        ))}
      </ol>
      {!preview?.prompts.length && <p className="muted">Full prompt text and timestamps appear every second fake chunk.</p>}
      <p className="ramp-note">Fake chunks arrive every 1.96s; prompts every two chunks. This cadence skips some phases at faster rates. Phase wording is provisional until Eni tunes it against the locked seed.</p>
    </section>
  );
});
