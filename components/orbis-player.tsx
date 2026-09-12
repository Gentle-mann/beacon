"use client";

import { ReactorView } from "@reactor-team/js-sdk";

type OrbisPlayerProps = {
  /**
   * Mount the view for the whole life of the connection, not just while
   * `runStarted` is true. The starter gated ReactorView on runStarted, which
   * meant a generation_complete or a rejected start tore the video element out
   * of the DOM mid-demo. The session hook lowers this flag only right before it
   * closes the tracks the view is playing.
   */
  mounted: boolean;
  connected: boolean;
  muted: boolean;
  status: string;
  phase: string;
  runStarted: boolean;
  framesEmitted: number | null;
  busy: boolean;
};

/**
 * Plain language for whoever is standing in front of the screen. A black
 * rectangle looks identical whether the model is warming, waiting to be told
 * to start, or broken — so it has to say which, and say what to press next.
 */
function describe({
  status,
  phase,
  connected,
  runStarted,
  framesEmitted,
  busy,
}: Omit<OrbisPlayerProps, "mounted" | "muted">) {
  if (runStarted && (framesEmitted ?? 0) > 0) return null; // picture is live
  if (runStarted) {
    return { head: "Generating…", sub: "First picture lands a few seconds in." };
  }
  if (status === "connecting" || status === "waiting") {
    return { head: "Warming the session…", sub: "About 9 seconds." };
  }
  if (status === "disconnected") {
    if (phase === "killed") {
      return { head: "Session killed", sub: "Press WARM + START to run again." };
    }
    if (phase.startsWith("reconnecting")) {
      return { head: "Connection lost — reconnecting…", sub: phase };
    }
    return { head: "No session", sub: "Press WARM + START." };
  }
  if (connected && busy) {
    return { head: "Starting generation…", sub: "Arming the model." };
  }
  if (connected) {
    return {
      head: "Warm and idle — not generating",
      sub: "Press Start. This is costing credits already.",
    };
  }
  return { head: status, sub: phase };
}

export function OrbisPlayer(props: OrbisPlayerProps) {
  const { mounted, muted, status, phase } = props;
  const overlay = describe(props);

  return (
    <div className="player">
      {mounted ? (
        <ReactorView
          track="main_video"
          audioTrack="main_audio"
          muted={muted}
          videoObjectFit="cover"
        />
      ) : null}

      {overlay ? (
        <div className={`player-overlay${mounted ? " player-overlay-on" : ""}`}>
          <strong>{overlay.head}</strong>
          <span>{overlay.sub}</span>
        </div>
      ) : null}

      <span className={`status status-${status}`}>
        {status} · {phase}
      </span>
    </div>
  );
}
