export const SCENERY_IDS = [
  "lagoon",
  "silk-pavilion",
  "sea-of-clouds",
  "golden-grassland",
  "living-desert",
  "aurora-horizon",
  "jellyfish-sanctuary",
  "cathedral-of-mist",
  "floating-ink-world",
] as const;

export type SceneryId = typeof SCENERY_IDS[number];
export type SceneryMotion = "gentle" | "still";
export type SceneryPhase = "inhale" | "exhale";

export type Scenery = {
  id: SceneryId;
  label: string;
  shortLabel: string;
  description: string;
  image: string | null;
  imageName: string | null;
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

const COMMON_CAMERA = "fixed wide eye-level camera with no zoom, pan, tilt, or cuts";

export const SCENERIES: readonly Scenery[] = [
  {
    id: "lagoon",
    label: "Quiet lagoon",
    shortLabel: "Lagoon",
    description: "Low water swells and a soft shoreline.",
    image: null,
    imageName: null,
    alt: "A wide quiet lagoon bordered by a soft shoreline",
    setting: "wide shallow tidal lagoon at dawn with a soft shoreline and distant low trees",
    camera: COMMON_CAMERA,
    audioPrompt: "Soft natural water lapping at a quiet shore, light air, no voices, no melody, no sudden sounds.",
    motion: {
      active: "Small smooth swells cross the lagoon at short regular intervals",
      steady: "Long low swells travel evenly across the lagoon",
      settled: "Broad slow swells cross the lagoon with long quiet pauses",
      still: "The lagoon stays almost still, with barely perceptible surface movement",
      inhale: "The water slowly rises in one broad gentle swell",
      exhale: "The water slowly recedes as the swell softens",
    },
  },
  {
    id: "silk-pavilion",
    label: "Silk pavilion",
    shortLabel: "Silk",
    description: "Translucent curtains breathe around a quiet room.",
    image: "/scenery-concepts/silk-pavilion.png",
    imageName: "silk-pavilion.png",
    alt: "A peaceful translucent silk pavilion above still water",
    setting: "translucent silk pavilion above a mirror-still floor in warm diffuse daylight",
    camera: COMMON_CAMERA,
    audioPrompt: "Soft fabric moving in a light breeze, quiet open air, no voices, no melody, no sudden sounds.",
    motion: {
      active: "Small coordinated folds travel through the curtains at short regular intervals",
      steady: "Long smooth billows move evenly through every curtain",
      settled: "Very broad slow billows pass through the silk with long quiet pauses",
      still: "The silk stays almost still, with only the faintest movement at its lower edges",
      inhale: "The curtains expand outward together in one soft breath",
      exhale: "The curtains relax inward and their folds gently settle",
    },
  },
  {
    id: "sea-of-clouds",
    label: "Sea of clouds",
    shortLabel: "Clouds",
    description: "Cloud banks rise and settle below a clear horizon.",
    image: "/scenery-concepts/sea-of-clouds.png",
    imageName: "sea-of-clouds.png",
    alt: "A calm view above broad cloud banks under a pale sky",
    setting: "vast sea of soft cloud banks below a pale open sky at sunrise",
    camera: COMMON_CAMERA,
    audioPrompt: "A quiet high-altitude breeze and soft airy ambience, no voices, no melody, no sudden sounds.",
    motion: {
      active: "Small rounded cloud forms lift and merge at short regular intervals",
      steady: "Wide cloud banks rise and spread in an even slow rhythm",
      settled: "The whole cloud sea lifts almost imperceptibly with long pauses",
      still: "The cloud banks stay almost still, with barely perceptible drifting at their edges",
      inhale: "The cloud banks lift and gently open across the horizon",
      exhale: "The clouds settle and gather into a soft continuous blanket",
    },
  },
  {
    id: "golden-grassland",
    label: "Golden grassland",
    shortLabel: "Grassland",
    description: "Warm bands move through tall meadow grass.",
    image: "/scenery-concepts/golden-grassland.png",
    imageName: "golden-grassland.png",
    alt: "A wide golden grassland with distant hills in warm light",
    setting: "wide golden grassland of tall soft grasses beneath a warm hazy sky",
    camera: COMMON_CAMERA,
    audioPrompt: "A soft breeze moving through tall dry grass, distant open air, no voices, no melody, no sudden sounds.",
    motion: {
      active: "Short soft waves travel through the grass at regular intervals",
      steady: "Long coordinated bands move evenly across the grassland",
      settled: "Very wide slow waves pass through the field with long pauses",
      still: "The grasses stay almost still, with only their tips moving faintly",
      inhale: "The grass lifts in one broad wave moving toward the horizon",
      exhale: "The wave releases and the grasses softly settle upright",
    },
  },
  {
    id: "living-desert",
    label: "Living desert",
    shortLabel: "Desert",
    description: "Sculptural dunes soften with the rhythm.",
    image: "/scenery-concepts/living-desert.png",
    imageName: "living-desert.png",
    alt: "Smooth sculptural desert dunes in warm dawn light",
    setting: "minimal sculptural desert of smooth wind-shaped dunes in warm dawn light",
    camera: COMMON_CAMERA,
    audioPrompt: "Very soft desert wind over fine sand, spacious quiet air, no voices, no melody, no sudden sounds.",
    motion: {
      active: "Fine ribbons of sand trace the dune crests at short regular intervals",
      steady: "Broad shallow ripples travel evenly along the dune faces",
      settled: "The dune surfaces soften in very slow broad waves with long pauses",
      still: "The dunes stay almost still, with barely perceptible grains moving along one crest",
      inhale: "The nearest dune gently rises and its ridge becomes rounder",
      exhale: "The ridge lowers and loose sand softly settles down its face",
    },
  },
  {
    id: "aurora-horizon",
    label: "Aurora horizon",
    shortLabel: "Aurora",
    description: "Luminous ribbons stretch across a still night.",
    image: "/scenery-concepts/aurora-horizon.png",
    imageName: "aurora-horizon.png",
    alt: "Broad green and violet aurora ribbons above a dark horizon",
    setting: "open dark northern horizon beneath broad green and violet aurora ribbons",
    camera: COMMON_CAMERA,
    audioPrompt: "A low quiet polar wind and spacious night ambience, no voices, no melody, no sudden sounds.",
    motion: {
      active: "Narrow light folds travel along the aurora at short regular intervals",
      steady: "Broad luminous ribbons sweep evenly across the sky",
      settled: "The aurora drifts in very wide slow arcs with long pauses",
      still: "The aurora stays almost still, with barely perceptible light moving along its edges",
      inhale: "The luminous ribbons stretch upward and open across the sky",
      exhale: "The ribbons fold gently toward the horizon and soften",
    },
  },
  {
    id: "jellyfish-sanctuary",
    label: "Jellyfish sanctuary",
    shortLabel: "Jellyfish",
    description: "Translucent forms pulse in deep blue water.",
    image: "/scenery-concepts/jellyfish-sanctuary.png",
    imageName: "jellyfish-sanctuary.png",
    alt: "Large translucent jellyfish floating in calm deep blue water",
    setting: "deep blue underwater sanctuary with a few large translucent jellyfish",
    camera: COMMON_CAMERA,
    audioPrompt: "Soft muffled underwater currents and distant gentle bubbles, no voices, no melody, no sudden sounds.",
    motion: {
      active: "The jellyfish pulse softly at short coordinated intervals",
      steady: "The jellyfish expand and release in a smooth shared rhythm",
      settled: "Each jellyfish makes one very slow broad pulse followed by a long pause",
      still: "The jellyfish stay almost still, with barely perceptible movement in their trailing forms",
      inhale: "The translucent bells slowly expand and gather soft light",
      exhale: "The bells release and the trailing forms gently descend",
    },
  },
  {
    id: "cathedral-of-mist",
    label: "Cathedral of mist",
    shortLabel: "Mist",
    description: "Quiet arches hold currents of colored fog.",
    image: "/scenery-concepts/cathedral-of-mist.png",
    imageName: "cathedral-of-mist.png",
    alt: "Tall simple arches containing soft colored mist",
    setting: "quiet monumental hall of simple pale arches filled with soft colored mist",
    camera: COMMON_CAMERA,
    audioPrompt: "A soft airy room tone in a large quiet hall, no footsteps, no voices, no melody, no sudden sounds.",
    motion: {
      active: "Small soft currents pass between the arches at short regular intervals",
      steady: "Wide layers of mist travel evenly through the hall",
      settled: "The mist moves in very broad slow currents with long pauses",
      still: "The mist stays almost still, with barely perceptible movement near the floor",
      inhale: "The mist gathers gently toward the center of the arches",
      exhale: "The mist spreads outward and softens into the open hall",
    },
  },
  {
    id: "floating-ink-world",
    label: "Floating ink world",
    shortLabel: "Ink",
    description: "Large color clouds bloom in clear space.",
    image: "/scenery-concepts/floating-ink-world.png",
    imageName: "floating-ink-world.png",
    alt: "Large floating clouds of blue amber and rose ink in a pale space",
    setting: "minimal pale space containing large floating clouds of blue amber and rose ink",
    camera: COMMON_CAMERA,
    audioPrompt: "Soft low liquid movement in a spacious quiet atmosphere, no voices, no melody, no sudden sounds.",
    motion: {
      active: "Small rounded blooms open through the ink at short regular intervals",
      steady: "Large color clouds expand and circulate in an even slow rhythm",
      settled: "The ink makes very broad slow blooms followed by long quiet pauses",
      still: "The ink stays almost still, with barely perceptible diffusion at its outer edges",
      inhale: "The color clouds bloom outward and their translucent edges open",
      exhale: "The clouds fold inward and their edges softly dissolve",
    },
  },
];

const BY_ID = new Map<string, Scenery>(SCENERIES.map((scenery) => [scenery.id, scenery]));

export function getScenery(id: string): Scenery {
  return BY_ID.get(id) ?? SCENERIES[0];
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
