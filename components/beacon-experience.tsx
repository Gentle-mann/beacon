"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExperienceScreen } from "@/components/experience-screen";
import { useBreathSource } from "@/hooks/use-breath-source";
import { createExperienceController, type ExperienceController, type ExperienceMode } from "@/lib/experience-controller";
import { createExperienceTransport } from "@/lib/experience-transport";
import type { ExperienceConfig } from "@/lib/experience-config";
import { PATIENT_SIGNALS, patientSignalForBpm, type PatientSignalId } from "@/lib/sceneries";

const DEFAULT_CONFIG: ExperienceConfig = { liveEnabled: false, lockedSeed: null, arcDurationMs: 90_000, maxSessionDurationSeconds: 120, unavailableReason: "Checking live scene availability…" };

export function BeaconExperience() {
  const breath = useBreathSource();
  const video = useRef<HTMLVideoElement>(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const configRef = useRef(config);
  configRef.current = config;
  const [muted, setMuted] = useState(true);
  const [mediaPlaying, setMediaPlaying] = useState(false);
  const [runtime] = useState(() => {
    let controller: ExperienceController;
    const transport = createExperienceTransport({
      getMode: () => controller.getSnapshot().mode,
      getSeed: () => configRef.current.lockedSeed,
      events: {
        onTransportStatus: (status) => controller.onTransportStatus(status),
        onMessage: (message) => controller.onMessage(message),
        onError: (message) => controller.onError(message),
      },
      onMedia: (stream) => {
        if (!stream) setMediaPlaying(false);
        if (video.current) {
          if (video.current.srcObject !== stream) video.current.srcObject = stream;
          if (stream && video.current.paused) void video.current.play().catch((error: unknown) => {
            if (video.current?.srcObject !== stream) return;
            if (error instanceof DOMException && error.name === "AbortError") return;
            controller.onError("Video playback could not start. Try the preview or restart the session.");
          });
        }
      },
    });
    controller = createExperienceController(transport);
    return { controller, transport };
  });
  const state = useSyncExternalStore(runtime.controller.subscribe, runtime.controller.getSnapshot, runtime.controller.getSnapshot);

  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/experience/config", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Configuration unavailable");
        setConfig(await response.json() as ExperienceConfig);
      }).catch(() => {
        if (!abort.signal.aborted) setConfig({ ...DEFAULT_CONFIG, unavailableReason: "Live scenery is unavailable. The preview works without a connection." });
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const stop = () => { if (document.hidden) { breath.stopMic(); void runtime.controller.stop(); } };
    const leave = () => { runtime.transport.pageHide(); runtime.controller.dispose(); };
    document.addEventListener("visibilitychange", stop);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", stop);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [runtime, breath.stopMic]);

  useEffect(() => {
    if (["completed", "stopped", "fallback"].includes(state.status)) breath.stopMic();
  }, [state.status, breath.stopMic]);

  useEffect(() => {
    if (state.status !== "running" || breath.micStatus !== "listening" || breath.snapshot.mode !== "mic") return;
    const response = patientSignalForBpm(breath.snapshot.bpm);
    runtime.controller.setMotion(response.motion);
    runtime.controller.setScene(response.sceneId);
  }, [state.status, breath.micStatus, breath.snapshot.mode, breath.snapshot.bpm, runtime]);

  function start(mode: ExperienceMode) {
    if (mode === "live" && !config.liveEnabled) return;
    const startBpm = breath.source.getStableBpm();
    const response = patientSignalForBpm(startBpm);
    runtime.controller.setScene(response.sceneId);
    runtime.controller.setMotion(response.motion);
    if (breath.micStatus === "off") void breath.startMic();
    setMediaPlaying(false);
    void runtime.controller.start({ mode, seed: mode === "live" ? config.lockedSeed : null, startBpm, sceneId: response.sceneId });
  }
  function setPatientSignal(signalId: PatientSignalId) {
    const signal = PATIENT_SIGNALS.find((option) => option.id === signalId) ?? PATIENT_SIGNALS[1];
    breath.setManualBpm(signal.bpm);
    runtime.controller.setMotion(signal.motion);
    runtime.controller.setScene(signal.sceneId);
  }
  function setManualBpm(bpm: number) {
    breath.setManualBpm(bpm);
    const response = patientSignalForBpm(bpm);
    runtime.controller.setMotion(response.motion);
    runtime.controller.setScene(response.sceneId);
  }
  return <ExperienceScreen
    state={state.mode === "live" ? { ...state, framesSeen: state.framesSeen && mediaPlaying } : state}
    liveEnabled={config.liveEnabled}
    liveUnavailableReason={config.unavailableReason}
    sourceBpm={breath.snapshot.bpm}
    sourceMode={breath.snapshot.mode}
    micStatus={breath.micStatus}
    micMessage={breath.message || (breath.micStatus === "listening" ? breath.snapshot.mode === "mic" ? `${breath.snapshot.bpm.toFixed(1)} BPM detected. The scene responds as your pace changes.` : "Listening for steady breaths. The current scene stays in place until there is a usable estimate." : "")}
    onStart={start}
    onStop={() => { breath.stopMic(); void runtime.controller.stop(); }}
    onGuide={runtime.controller.setGuide}
    onMotion={runtime.controller.setMotion}
    onPatientSignal={setPatientSignal}
    onManualBpm={setManualBpm}
    onMicStart={() => {
      const current = runtime.controller.getSnapshot();
      if (!current.cleanupPending && !["connecting", "preparing", "stopping"].includes(current.status)) void breath.startMic();
    }}
    onMicStop={breath.stopMic}
    muted={muted}
    onToggleMuted={() => setMuted((current) => !current)}
    video={<video ref={video} autoPlay playsInline muted={muted} onPlaying={() => setMediaPlaying(true)} onWaiting={() => setMediaPlaying(false)} onStalled={() => {
      setMediaPlaying(false);
      const current = runtime.controller.getSnapshot();
      if (current.mode === "live" && current.status === "running") runtime.controller.onTransportStatus("waiting");
    }} onError={() => {
      if (runtime.controller.getSnapshot().mode === "live") runtime.controller.onError("The video could not play. The calm preview is still available.");
    }} aria-label={`Live ${state.sceneId} video`} />}
  />;
}
