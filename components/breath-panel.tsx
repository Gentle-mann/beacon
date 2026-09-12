"use client";

import { useEffect, useRef } from "react";

import type { BreathSource } from "@/hooks/use-breath";

/**
 * The audience-facing half of the demo. A number that moves when the person
 * breathes, and a trace that visibly rises and falls with them — without those
 * two things, "it follows your breath" is a claim rather than a demonstration.
 */
export function BreathPanel({
  breath,
  sliderBpm,
  setSliderBpm,
  targetBpm,
  arcRunning,
  disabled,
}: {
  breath: BreathSource;
  sliderBpm: number;
  setSliderBpm: (v: number) => void;
  targetBpm: number | null;
  arcRunning: boolean;
  disabled: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let frame: number;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const el = canvas.current;
      if (!el) return;
      const ctx = el.getContext("2d");
      if (!ctx) return;

      const w = (el.width = el.clientWidth * devicePixelRatio);
      const h = (el.height = el.clientHeight * devicePixelRatio);
      ctx.clearRect(0, 0, w, h);

      const env = breath.history.current.env;
      const base = breath.history.current.base;
      if (!env.length) {
        ctx.fillStyle = "#4a4a50";
        ctx.font = `${12 * devicePixelRatio}px ui-monospace, monospace`;
        ctx.fillText("mic off", 8 * devicePixelRatio, h / 2);
        return;
      }

      // Scale to the visible window so a quiet room still shows a trace.
      const peak = Math.max(...env, ...base, 1e-6);
      const y = (v: number) => h - (v / (peak * 1.15)) * h;
      const x = (i: number) => (i / (env.length - 1 || 1)) * w;

      // baseline = the threshold a breath has to cross
      ctx.strokeStyle = "#4a4636";
      ctx.lineWidth = devicePixelRatio;
      ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
      ctx.beginPath();
      base.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = breath.rising ? "#6fd38a" : "#8d8a84";
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      env.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.stroke();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [breath.history, breath.rising]);

  const shown = breath.usingDetected ? breath.detectedBpm : sliderBpm;

  return (
    <section className="breath">
      <div className="breath-head">
        <div className="breath-readout">
          <strong className={breath.rising ? "inhale" : undefined}>
            {shown === null ? "--" : shown.toFixed(1)}
          </strong>
          <span>bpm {breath.usingDetected ? "detected" : "set"}</span>
        </div>
        {arcRunning && targetBpm !== null ? (
          <div className="breath-target">
            <strong>{targetBpm.toFixed(1)}</strong>
            <span>bpm target</span>
          </div>
        ) : null}
      </div>

      <canvas ref={canvas} className="breath-wave" />

      <div className="breath-controls">
        <button
          type="button"
          className={`btn btn-src${breath.kind === "mic" ? " btn-src-on" : ""}`}
          onClick={breath.useMic}
        >
          {breath.listening ? "◉ MIC" : "○ use mic"}
        </button>
        <button
          type="button"
          className={`btn btn-src${breath.kind === "slider" ? " btn-src-on" : ""}`}
          onClick={breath.useSlider}
        >
          {breath.kind === "slider" ? "◉ SLIDER" : "○ use slider"}
        </button>
      </div>

      <label className="arc-row">
        <span>slider</span>
        <input
          type="range"
          min={4}
          max={24}
          step={0.5}
          value={sliderBpm}
          disabled={disabled}
          onChange={(e) => setSliderBpm(Number(e.target.value))}
        />
        <strong>{sliderBpm.toFixed(1)}</strong>
      </label>

      <p className="breath-note">
        {breath.micError ? (
          <span className="alert">mic: {breath.micError}</span>
        ) : breath.kind === "mic" && breath.listening ? (
          breath.detectedBpm === null ? (
            `listening — ${breath.cycles} breath(s) seen, need 2 clean ones`
          ) : (
            `${breath.cycles} breaths · level ${breath.level.toFixed(4)}`
          )
        ) : (
          "slider drives the arc — always works"
        )}
      </p>
    </section>
  );
}
