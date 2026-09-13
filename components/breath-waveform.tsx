"use client";

import { useEffect, useRef, type RefObject } from "react";

export type BreathWaveformPoint = { at: number; value: number };

/** The reusable live trace introduced by Eni's breath telemetry work. */
export function BreathWaveform({
  waveform,
  listening,
  className,
  ariaLabel,
  windowMs = 30_000,
}: {
  waveform: RefObject<BreathWaveformPoint[]>;
  listening: boolean;
  className: string;
  ariaLabel: string;
  windowMs?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

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
      const styles = getComputedStyle(element);
      context.strokeStyle = styles.getPropertyValue("--breath-grid-color").trim() || "#ffffff1a";
      context.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        context.beginPath();
        context.moveTo(width * i / 5, 0);
        context.lineTo(width * i / 5, height);
        context.stroke();
      }
      const points = waveform.current;
      const peak = Math.max(0.01, ...points.map((point) => point.value));
      const now = performance.now();
      context.strokeStyle = styles.getPropertyValue("--breath-trace-color").trim() || "#dfe9c8";
      context.lineWidth = 2;
      context.beginPath();
      if (!points.length) {
        context.moveTo(0, height - 7);
        context.lineTo(width, height - 7);
      } else {
        points.forEach((point, index) => {
          const x = width * (1 - (now - point.at) / windowMs);
          const y = height - 7 - point.value / peak * Math.max(1, height - 14);
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
      }
      context.stroke();
      if (listening) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [waveform, listening, windowMs]);

  return <canvas ref={canvas} className={className} role="img" aria-label={ariaLabel} />;
}
