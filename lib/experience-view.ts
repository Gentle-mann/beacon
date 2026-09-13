import type { ExperienceSnapshot } from "./experience-controller";

export function shouldShowLiveMedia(
  state: Pick<ExperienceSnapshot, "mode" | "status" | "framesSeen">,
  preferLocalScene: boolean,
) {
  return state.mode === "live" && state.status === "running" && state.framesSeen && !preferLocalScene;
}
