"use client";

import type { RefObject } from "react";
import { BreathWaveform, type BreathWaveformPoint } from "@/components/breath-waveform";
import type { BreathActivity } from "@/lib/breath-activity";
import type { BreathReading } from "@/lib/breath-detector";

export function PatientBreathTrace({
  bpm,
  sourceMode,
  micStatus,
  reading,
  activity,
  waveform,
}: {
  bpm: number;
  sourceMode: "mic" | "slider";
  micStatus: "off" | "requesting" | "listening" | "error";
  reading: BreathReading;
  activity: BreathActivity;
  waveform: RefObject<BreathWaveformPoint[]>;
}) {
  const detected = micStatus === "listening" && sourceMode === "mic";
  let status = "Mic starts with session";
  if (micStatus === "requesting") status = "Waiting for microphone";
  else if (micStatus === "error") status = "Microphone unavailable";
  else if (activity === "active") status = "Fast breath detected · cloud scene";
  else if (detected) status = reading.airflow === "rising" ? "Breath rising" : "Breath settling";
  else if (micStatus === "listening") status = "Listening · tree scene";

  return <div className="experience-breath-monitor" aria-label="Live breathing monitor">
    <div className="experience-breath-readout">
      <span className="experience-overline">Live breathing</span>
      <strong>{detected ? bpm.toFixed(1) : "—"}<small>{detected ? " bpm" : ""}</small></strong>
    </div>
    <BreathWaveform
      waveform={waveform}
      listening={micStatus === "listening"}
      className="experience-breath-waveform"
      ariaLabel="Live breathing amplitude over the last twelve seconds"
      windowMs={12_000}
    />
    <span className="experience-breath-status" role="status">{status}</span>
  </div>;
}
