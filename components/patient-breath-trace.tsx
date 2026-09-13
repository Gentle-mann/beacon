"use client";

import type { RefObject } from "react";
import { BreathWaveform, type BreathWaveformPoint } from "@/components/breath-waveform";
import type { BreathReading } from "@/lib/breath-detector";

export function PatientBreathTrace({
  bpm,
  sourceMode,
  micStatus,
  reading,
  waveform,
}: {
  bpm: number;
  sourceMode: "mic" | "slider";
  micStatus: "off" | "requesting" | "listening" | "error";
  reading: BreathReading;
  waveform: RefObject<BreathWaveformPoint[]>;
}) {
  const detected = micStatus === "listening" && sourceMode === "mic";
  const status = micStatus === "requesting"
    ? "Waiting for microphone"
    : micStatus === "error"
      ? "Microphone unavailable"
      : detected
        ? reading.airflow === "rising" ? "Breath rising" : "Breath settling"
        : micStatus === "listening" ? "Finding your rhythm" : "Mic starts with session";

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
