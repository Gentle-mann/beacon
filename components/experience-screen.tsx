"use client";

import Link from "next/link";
import Image from "next/image";
import { type CSSProperties, type ReactNode } from "react";
import type { ExperienceSnapshot } from "@/lib/experience-controller";
import { ARC_DURATION_MS, integratedBreathCycles, promptAt } from "@/lib/entrainment";
import { PATIENT_SIGNALS, getScenery, patientSignalForBpm, type PatientSignalId } from "@/lib/sceneries";

export type ExperienceScreenProps = {
  state: ExperienceSnapshot;
  liveEnabled: boolean;
  liveUnavailableReason: string | null;
  sourceBpm: number;
  sourceMode: "mic" | "slider";
  micStatus: "off" | "requesting" | "listening" | "error";
  micMessage: string;
  onStart(mode: "preview" | "live"): void;
  onStop(): void;
  onGuide(enabled: boolean): void;
  onMotion(motion: "gentle" | "still"): void;
  onPatientSignal(signalId: PatientSignalId): void;
  onManualBpm(bpm: number): void;
  onMicStart(): void;
  onMicStop(): void;
  muted: boolean;
  onToggleMuted(): void;
  video: ReactNode;
};

function BeaconMark() {
  return <svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M14 3v4m0 14v4M3 14h4m14 0h4M6.2 6.2l2.9 2.9m9.8 9.8 2.9 2.9M6.2 21.8l2.9-2.9m9.8-9.8 2.9-2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="14" cy="14" r="3.3" fill="currentColor" /></svg>;
}

function SoundIcon({ muted }: { muted: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />{muted ? <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : <><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>}</svg>;
}

function headingFor(state: ExperienceSnapshot, sceneryDescription: string) {
  if (state.status === "stopping") return { title: "A gentle close.", description: "Closing live session…" };
  if (state.cleanupPending) return { title: "Let’s finish closing.", description: "Session closure is not confirmed. Select Retry Stop below." };
  switch (state.status) {
    case "connecting": return { title: "A moment is on its way.", description: "Connecting your live scene. You can stop at any time." };
    case "preparing": return { title: "Finding a quiet place.", description: "Your live scene is getting ready. Rest here while it arrives." };
    case "recovering": return { title: "Stay with this quiet view.", description: "Reconnecting the live scene. Your original 90-second limit stays in place." };
    case "completed": return { title: "Take this moment with you.", description: "Your 90 seconds are complete. Stay a little, or begin again." };
    case "stopped": return { title: "At your own pace.", description: "Your session has stopped. Begin again whenever you like." };
    case "fallback": return { title: "There is still space to settle.", description: "The live scene is unavailable. This quiet local view is here for you." };
    case "running": return { title: "Nothing to do. Just be here.", description: "Breathe in whatever way feels comfortable." };
    default: return { title: "A little space\nto settle.", description: `${sceneryDescription}\nNinety seconds, entirely at your pace.` };
  }
}

/** Presentational patient surface. Session creation, cleanup and audio stay with the controller. */
export function ExperienceScreen(props: ExperienceScreenProps) {
  const { state, sourceBpm, sourceMode, micStatus } = props;
  const scenery = getScenery(state.sceneId);
  const busy = ["connecting", "preparing", "running", "recovering", "stopping"].includes(state.status);
  const closureUnconfirmed = state.cleanupPending && state.status !== "stopping";
  const running = state.status === "running";
  const canStart = !busy && !state.cleanupPending;
  const liveVisible = state.mode === "live" && running && state.framesSeen;
  const fallback = state.status === "fallback" || state.status === "recovering";
  const elapsed = Math.min(ARC_DURATION_MS, Math.max(0, state.elapsedMs));
  const remaining = Math.ceil((ARC_DURATION_MS - elapsed) / 1000);
  const heading = headingFor(state, scenery.description);
  const phase = promptAt(state.startBpm, elapsed).phase;
  const cycle = integratedBreathCycles(state.startBpm, elapsed) % 1;
  const swell = (1 - Math.cos(cycle * Math.PI * 2)) / 2;
  const guideStyle = { "--guide-scale": String(.82 + swell * .18) } as CSSProperties;
  const micActive = micStatus === "listening" || micStatus === "requesting";
  const patientSignal = PATIENT_SIGNALS.find((signal) => signal.sceneId === scenery.id) ?? patientSignalForBpm(sourceBpm);
  const badge = liveVisible ? "Live scene" : state.status === "recovering" ? "Reconnecting · local view" : fallback ? "Calm fallback" : "Local preview";
  const origin = liveVisible
    ? `${scenery.label} · live generated environment`
    : fallback
      ? `${scenery.label} · local view while live video is unavailable`
      : `${scenery.label} · local reference image`;

  return <main className={`experience-screen ${running ? "experience-is-running" : ""} ${busy || state.cleanupPending ? "experience-is-active" : ""}`} data-motion={state.motion} data-live-visible={liveVisible} data-reference-image={Boolean(scenery.image)}>
    <div className="experience-scene">
      <Image className="experience-scene-image" src={scenery.image} alt="" fill sizes="100vw" priority />
      {/* Keep the actual player mounted through preparation so it can deliver its first-frame event. */}
      <div className="experience-live-video" aria-hidden={!liveVisible} inert={!liveVisible} style={{ opacity: liveVisible ? 1 : 0 }}>{props.video}</div>
      <div className="experience-shade" />
    </div>

    <header className="experience-header">
      <div className="experience-brand"><BeaconMark /><span>beacon</span><span className="experience-brand-note">a moment for you</span></div>
      <div className="experience-header-actions">
        <span className={`experience-scene-badge ${liveVisible ? "experience-scene-badge-live" : ""}`}><span aria-hidden="true" />{badge}</span>
        <button className="experience-icon-button" type="button" aria-label={props.muted ? "Turn sound on" : "Mute sound"} aria-pressed={!props.muted} onClick={props.onToggleMuted} title={props.muted ? "Sound off" : "Sound on"}><SoundIcon muted={props.muted} /></button>
      </div>
    </header>

    <section className="experience-center" aria-label="Your moment">
      {running && state.guideEnabled ? <div className="experience-guide">
        <div className="experience-guide-orb" style={guideStyle} aria-hidden="true"><div /></div>
        <div className="experience-guide-copy"><span className="experience-overline">An optional rhythm</span><h1>{phase === "inhale" ? "Breathe in" : "Breathe out"}</h1><p>Only follow along if it feels comfortable.</p></div>
      </div> : <div className="experience-intro"><span className="experience-overline">{running ? "This time is yours" : `A quiet moment · ${scenery.label}`}</span><h1>{heading.title}</h1><p>{heading.description}</p></div>}
      {(state.cleanupPending || state.status === "connecting" || state.status === "preparing" || state.status === "recovering") ? <div className="experience-connection" role="status" data-retry={closureUnconfirmed}><span aria-hidden="true" />{closureUnconfirmed ? "Session closure not confirmed" : state.cleanupPending ? "Closing live session…" : state.status === "recovering" ? "Reconnecting" : "Preparing live scene"}</div> : null}
    </section>

    <div className="experience-bottom">
      <div className="experience-scene-caption"><span>{origin}</span><span>Stay as you are. Stop whenever you want.</span></div>
      <section className="experience-controls" aria-label="Session controls">
        <div className="experience-signal-picker">
          <div className="experience-signal-heading"><span className="experience-overline">Demo patient signal</span><span>{busy ? `${patientSignal.response} is set for this moment` : "Choose a breathing pattern to see Beacon respond."}</span></div>
          <div className="experience-signal-options" role="radiogroup" aria-label="Demo patient signal">
            {PATIENT_SIGNALS.map((signal) => <button
              key={signal.id}
              type="button"
              role="radio"
              aria-checked={signal.id === patientSignal.id}
              disabled={busy || state.cleanupPending}
              onClick={() => props.onPatientSignal(signal.id)}
              aria-label={`${signal.label}, ${signal.bpm} breaths per minute: ${signal.response}`}
            >
              <span className="experience-signal-image" aria-hidden="true"><Image src={getScenery(signal.sceneId).image} alt="" fill sizes="110px" /></span>
              <span className="experience-signal-copy"><strong>{signal.label}</strong><small>{signal.bpm} breaths / min</small></span>
              <span className="experience-signal-response"><strong>{signal.response}</strong><small>{signal.description}</small></span>
            </button>)}
          </div>
        </div>
        <div className="experience-control-main">
          <div className="experience-session-description">
            <span className="experience-overline">{running ? "Your moment is unfolding" : state.status === "completed" ? "A little pause, complete" : "Make yourself comfortable"}</span>
            <h2>{running ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} remaining` : "Ninety seconds of somewhere quieter."}</h2>
            <p>{running ? "There is nothing to get right." : "Explore the local preview, or open a live generated scene."}</p>
          </div>
          <div className="experience-start-actions">
            {busy || state.cleanupPending ? <span className="experience-active-note">{closureUnconfirmed ? "Closure not confirmed. Retry Stop below." : state.cleanupPending || state.status === "stopping" ? "Closing live session…" : "You can stop at any time."}</span> : <>
              <button type="button" className="experience-button experience-button-primary" disabled={!canStart} onClick={() => props.onStart("preview")}>Start preview<span aria-hidden="true">↗</span></button>
              <button type="button" className="experience-button experience-button-secondary" disabled={!canStart || !props.liveEnabled} onClick={() => props.onStart("live")} aria-describedby={!props.liveEnabled ? "experience-live-unavailable" : undefined}>Start live session</button>
            </>}
          </div>
        </div>
        {running || state.status === "recovering" ? <div className="experience-progress" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={90} aria-valuenow={Math.floor(elapsed / 1000)}><span style={{ width: `${elapsed / ARC_DURATION_MS * 100}%` }} /></div> : null}
        {!props.liveEnabled && canStart ? <p className="experience-unavailable" id="experience-live-unavailable">{props.liveUnavailableReason || "Live sessions are not configured yet. The local preview is ready."}</p> : null}
        {state.error ? <p className="experience-error" role="alert">{state.error}</p> : null}
        <div className="experience-preferences">
          <button type="button" className="experience-guide-toggle" role="switch" aria-checked={state.guideEnabled} onClick={() => props.onGuide(!state.guideEnabled)}><span className="experience-switch" aria-hidden="true"><span /></span><span>Breathing guide <small>optional</small></span></button>
          <div className="experience-motion"><span>Scene motion</span><div className="experience-segmented" role="group" aria-label="Scene motion"><button type="button" aria-pressed={state.motion === "gentle"} onClick={() => props.onMotion("gentle")}>Gentle</button><button type="button" aria-pressed={state.motion === "still"} onClick={() => props.onMotion("still")}>Still</button></div></div>
          <span className="experience-sound-note">{props.muted ? "Sound off" : liveVisible ? "Sound on" : "Local preview is silent"}</span>
        </div>
        <details className="experience-personalize">
          <summary>Choose a starting pace <span aria-hidden="true">+</span></summary>
          <div className="experience-personalize-content">
            <div className="experience-pace"><label htmlFor="experience-manual-bpm">Starting pace <output>{sourceBpm.toFixed(1)} <span>breaths / min</span></output></label><input id="experience-manual-bpm" type="range" min="4" max="20" step=".5" value={sourceBpm} onChange={(event) => props.onManualBpm(Number(event.target.value))} /><div className="experience-range-labels"><span>Slower · 4</span><span>20 · Faster</span></div><p>{busy ? "Changes apply to your next moment." : "The guide begins at this pace. You can always breathe naturally."}</p></div>
            <div className="experience-mic"><span className="experience-mic-label">{sourceMode === "mic" ? "Microphone estimate" : "Manual pace selected"}</span><p>{busy || state.cleanupPending ? "Set up the microphone before your next session. You can stop an active microphone at any time." : "Optionally use your microphone to estimate a starting pace. Audio stays on this device."}</p><div className="experience-mic-actions">{micActive ? <button type="button" className="experience-text-button" onClick={props.onMicStop}>{micStatus === "requesting" ? "Cancel microphone" : "Stop microphone"}</button> : <button type="button" className="experience-text-button" onClick={props.onMicStart} disabled={busy || state.cleanupPending}>Use microphone</button>}<span role="status">{props.micMessage || (micStatus === "requesting" ? "Waiting for permission…" : micStatus === "listening" ? "Listening locally" : "Microphone off")}</span></div></div>
          </div>
        </details>
      </section>
      <footer className="experience-footer"><span>A comfort experience. Follow your own breathing.</span><nav aria-label="Tools"><Link href="/breath" prefetch={false}>Breathing workbench</Link><Link href="/operator" prefetch={false}>Operator view <span aria-hidden="true">↗</span></Link></nav></footer>
    </div>
    {busy || state.cleanupPending ? <div className="experience-stop-dock"><button type="button" className="experience-button experience-button-stop" onClick={props.onStop} disabled={state.status === "stopping"} aria-label={closureUnconfirmed ? "Retry Stop" : "Stop session"}><span className="experience-stop-square" aria-hidden="true" />{closureUnconfirmed ? "Retry Stop" : state.cleanupPending || state.status === "stopping" ? "Closing session…" : "Stop session"}</button></div> : null}
  </main>;
}
