/** Browser-safe policy shared by the guided experience and its API routes. */
export const EXPERIENCE_ARC_DURATION_MS = 90_000 as const;
export const EXPERIENCE_MAX_SESSION_DURATION_SECONDS = 120 as const;

export type ExperienceConfig = {
  liveEnabled: boolean;
  lockedSeed: number | null;
  arcDurationMs: typeof EXPERIENCE_ARC_DURATION_MS;
  maxSessionDurationSeconds: typeof EXPERIENCE_MAX_SESSION_DURATION_SECONDS;
  unavailableReason: string | null;
};

export type ExperienceToken = {
  jwt: string;
  lockedSeed: number;
  arcDurationMs: typeof EXPERIENCE_ARC_DURATION_MS;
  maxSessionDurationSeconds: typeof EXPERIENCE_MAX_SESSION_DURATION_SECONDS;
};
