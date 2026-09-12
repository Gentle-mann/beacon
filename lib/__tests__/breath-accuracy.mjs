import { BreathDetector, BREATH } from "../breath.ts";

function run(trueBpm, { noise = 0, drift = 0, seconds = 120, duty = 0.45 } = {}) {
  const d = new BreathDetector();
  const period = 60 / trueBpm;
  let last = null;
  let rng = 12345;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  for (let t = 0; t < seconds * 1000; t += BREATH.sampleMs) {
    const ph = ((t / 1000) % period) / period;
    // breath = a noise burst over part of the cycle, quiet the rest
    const burst = ph < duty ? Math.sin((ph / duty) * Math.PI) : 0;
    const level = 0.02 + 0.10 * burst + drift * (t / 1000 / seconds) + noise * rand();
    last = d.push(Math.max(0, level), t);
  }
  return { trueBpm, got: last.bpm, cycles: last.cycles };
}

const cases = [
  ["clean 12 bpm", run(12)],
  ["clean 6 bpm", run(6)],
  ["clean 20 bpm", run(20)],
  ["clean 8 bpm", run(8)],
  ["noisy 12 bpm (room)", run(12, { noise: 0.035 })],
  ["noisy 6 bpm (room)", run(6, { noise: 0.035 })],
  ["drifting baseline 10 bpm", run(10, { drift: 0.08 })],
  ["very noisy 14 bpm", run(14, { noise: 0.07 })],
];
let pass = 0;
for (const [name, r] of cases) {
  const err = r.got === null ? null : Math.abs(r.got - r.trueBpm) / r.trueBpm * 100;
  const ok = err !== null && err < 15;
  if (ok) pass++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(26)} true=${String(r.trueBpm).padStart(2)}  got=${r.got === null ? "null" : r.got.toFixed(1).padStart(5)}  err=${err === null ? "  n/a" : err.toFixed(1).padStart(5) + "%"}  cycles=${r.cycles}`
  );
}
console.log(`\n${pass}/${cases.length} within 15%`);
