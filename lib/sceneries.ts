export const SCENERY_IDS = ["still-lake", "willow-breeze"] as const;

export type SceneryId = typeof SCENERY_IDS[number];
export type SceneryMotion = "gentle" | "still";
export type SceneryPhase = "inhale" | "exhale";
export type PatientSignalId = "elevated" | "baseline";

export type Scenery = {
  id: SceneryId;
  label: string;
  shortLabel: string;
  description: string;
  image: string;
  imageName: string;
  previewAudio: string;
  alt: string;
  setting: string;
  camera: string;
  audioPrompt: string;
  motion: {
    active: string;
    steady: string;
    settled: string;
    still: string;
    inhale: string;
    exhale: string;
  };
};

export type PatientSignal = {
  id: PatientSignalId;
  label: string;
  bpm: number;
  sceneId: SceneryId;
  motion: SceneryMotion;
  response: string;
  description: string;
};

const COMMON_CAMERA = "fixed wide eye-level camera with no zoom, pan, tilt, or cuts";

export const SCENERIES: readonly Scenery[] = [
  {
    id: "still-lake",
    label: "Still mist lake",
    shortLabel: "Still lake",
    description: "An almost motionless horizon for an elevated breathing signal.",
    image: "/scenery-concepts/protective-still-lake.png",
    imageName: "protective-still-lake.png",
    previewAudio: "/audio/still-lake-loop.mp3",
    alt: "A still misty lake between distant mountains at dawn",
    setting: "wide mist-covered mountain lake at quiet dawn, muted blue-grey water and soft distant hills",
    camera: COMMON_CAMERA,
    audioPrompt: "Barely audible water at a distant shore, soft open air, no voices, no melody, no sudden sounds.",
    motion: {
      active: "The lake remains nearly motionless, with one faint broad ripple far from the camera",
      steady: "The lake remains nearly motionless, with a faint ripple dissolving into the mist",
      settled: "The water is glassy and the mist drifts almost imperceptibly",
      still: "The water and mist stay almost still, with no sudden or busy movement",
      inhale: "The mist lifts almost imperceptibly from the water",
      exhale: "The mist settles softly back toward the lake",
    },
  },
  {
    id: "willow-breeze",
    label: "Willow by the water",
    shortLabel: "Willow breeze",
    description: "A gentle breeze through leaves for a baseline breathing signal.",
    image: "/scenery-concepts/willow-breeze-v2.png",
    imageName: "willow-breeze-v2.png",
    previewAudio: "/audio/willow-breeze-loop.mp3",
    alt: "A clear green willow tree beside a quiet lake in warm morning light",
    setting: "one unmistakably clear mature healthy green willow beside a quiet mountain lake in warm diffuse morning light, its readable trunk and abundant distinct leaf clusters filling the left foreground",
    camera: COMMON_CAMERA,
    audioPrompt: "Soft wind moving through willow leaves beside quiet water, with occasional distant gentle birdsong, no voices, no melody, no sudden sounds.",
    motion: {
      active: "A gentle breeze moves the bright green willow leaves in coherent rhythmic waves across the canopy while the trunk and camera remain perfectly still",
      steady: "Distinct green willow leaf clusters sway together in a slow even rhythm, rising and settling as one continuous wave",
      settled: "Only the outer willow leaves drift slowly, followed by long quiet pauses",
      still: "The willow and lake stay almost still, with only the faintest movement at the leaf tips",
      inhale: "The willow leaves lift together in one broad soft wave",
      exhale: "The leaves release and settle gently toward the water",
    },
  },
];

export const PATIENT_SIGNALS: readonly PatientSignal[] = [
  {
    id: "elevated",
    label: "Faster breathing",
    bpm: 18,
    sceneId: "still-lake",
    motion: "still",
    response: "Protective calm",
    description: "The scene simplifies and removes almost all motion.",
  },
  {
    id: "baseline",
    label: "Baseline breathing",
    bpm: 12,
    sceneId: "willow-breeze",
    motion: "gentle",
    response: "Gentle presence",
    description: "The scene can hold richer, soft movement through the leaves.",
  },
];

const BY_ID = new Map<string, Scenery>(SCENERIES.map((scenery) => [scenery.id, scenery]));

export function getScenery(id: string): Scenery {
  return BY_ID.get(id) ?? SCENERIES[1];
}

export function patientSignalForBpm(bpm: number): PatientSignal {
  return bpm >= 15 ? PATIENT_SIGNALS[0] : PATIENT_SIGNALS[1];
}

function paceClause(scenery: Scenery, targetBpm: number) {
  if (targetBpm >= 12) return scenery.motion.active;
  if (targetBpm >= 8) return scenery.motion.steady;
  return scenery.motion.settled;
}

export function buildSceneryPrompt(
  id: SceneryId,
  options: { motion: SceneryMotion; targetBpm: number; phase: SceneryPhase | null },
) {
  const scenery = getScenery(id);
  const movement = options.motion === "still" ? scenery.motion.still : paceClause(scenery, options.targetBpm);
  const phase = options.phase ? `. ${scenery.motion[options.phase]}` : "";
  return `The same ${scenery.setting}, the same ${scenery.camera}. ${movement}${phase}. Continuous slow motion, no cuts, a single unbroken take.`;
}
