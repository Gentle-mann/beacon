import { BreathDetector, BREATH } from "../breath.ts";

// breathe 12bpm -> input stalls (constant) -> breathing resumes
const d = new BreathDetector();
const period = 5; // 12 bpm
let t = 0, last = null;
const feed = (secs, fn) => {
  for (let i = 0; i < secs * 1000; i += BREATH.sampleMs, t += BREATH.sampleMs) {
    last = d.push(fn(t), t);
  }
};
let rng = 987654321;
const dither = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 1e-5;
const breathing = (tm) => {
  const ph = ((tm / 1000) % period) / period;
  return 0.02 + 0.10 * (ph < 0.45 ? Math.sin((ph / 0.45) * Math.PI) : 0) + dither();
};

feed(60, breathing);
const before = { bpm: last.bpm, rising: last.rising, stalled: last.stalled };

feed(25, () => 0.031415);           // frozen input, exactly repeating
const during = { bpm: last.bpm, rising: last.rising, stalled: last.stalled };

feed(60, breathing);                 // audio returns
const after = { bpm: last.bpm, rising: last.rising, stalled: last.stalled };

console.log("before stall :", JSON.stringify(before));
console.log("during stall :", JSON.stringify(during));
console.log("after resume :", JSON.stringify(after));
const ok = during.stalled === true && during.rising === false
  && after.stalled === false && after.bpm !== null && Math.abs(after.bpm - 12) / 12 < 0.15;
console.log(ok ? "\nPASS  detector releases on stall and recovers after" : "\nFAIL  latched or did not recover");
