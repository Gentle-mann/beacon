# Beacon

A generated environment that runs for the length of a medical procedure —
continuous, no cuts, no loop — that reads a person's breathing and slowly
leads it down toward ~6 breaths/min. Built on Visko Orbis Stable (Reactor)
for the Live Models Hackathon.

The demo is a person breathing with a living world on screen. Dialysis chair,
infusion, MRI. Ambient video today is a loop that ignores the patient; a live
model can be a stimulus that meets the patient's state and stays as long as
the body needs it.

---

## READ THIS FIRST — the one rule that keeps us alive

**Only ONE person can run an Orbis session at a time.** The model quota is
`concurrent_sessions_per_model = 1`. A second session gets `429 quota_exceeded`,
and a half-connected attempt can **leak a live session that keeps billing**.

So:
- **Whoever is driving a session says so out loud** ("taking the slot" /
  "slot free"). No exceptions.
- **Kill the session between tasks.** Never leave one warm unattended. Use the
  KILL button in the status panel. If the panel shows orphaned sessions, hit
  **reap** — they're still billing.
- Billing is ~$0.58/min of session time. Budget is ~7.4 hrs total. Don't idle.

**You do NOT need a session to build Gate 3 or Gate 4.** Both are self-contained
until the final wire-in. Build and test them fully offline, then integrate when
a locked seed exists.

---

## Git rules (we already lost time to this once)

- Branch per task. **Never push straight to `main`.**
- Small PRs, merge on purpose.
- Branch names: `gate3-breath`, `gate4-ramp`.
- If you hit a squash-merge conflict, rebase onto the new `main` — do not
  force-push.

---

## Setup

```
cp .env.example .env.local     # add REACTOR_API_KEY and GEMINI_API_KEY
npm install
npm run dev                     # http://localhost:3000
```

Keys stay server-side. Node 20.9+.

---

## The model — facts that constrain everything (measured, not from docs)

The docs were wrong on several of these. These are what we actually measured:

- **Only live control surface is `set_prompt`.** No video/sensor input to the
  model. Any "reactive" behavior = signal → prompt string → `set_prompt`.
- **Steering lands at the next chunk boundary, ~1.96s observed** (not the 1.833s
  the docs imply). **Drive timing off `chunk_complete` events, never a
  wall-clock timer.**
- Generation is 832×480 @ 18fps, upscaled. **No faces, no text, no fine detail.**
  Water, light, landscape only.
- **Warm-up is ~17s** (not "minutes"). First chunk DOES emit frames.
- **`chunk_complete` field is `chunk_index`** (docs say `session_chunk` — wrong).
  `state` mirrors it as `current_chunk`.
- Commands are async; **events are the source of truth**: `state`,
  `chunk_complete`, `prompt_accepted`, `command_error`.
- **`set_seed` is reproducible** — same seed + same prompts = same video. We are
  seed-locking the demo.

### What we learned about drift (why the arc is short)

- Restating the scene does NOT hold lighting. Light oscillates on its own,
  **seed-driven** (a sun flares ~41s, recalled ~92s, identically with or
  without restating).
- **Image coherence degrades with wall-clock time** — banding visible ~92s,
  severe ~215s. Structural to the session, not caused by reprompts.
- **Therefore the arc is 90 seconds, not 4 minutes.** Reach 6 bpm by ~75s,
  before coherence rots. A short arc is also a better stage demo.
- Trajectories are reproducible per seed, so we **hunt a calm seed and lock it**.

---

## Gate status

| Gate | What | Status | Owner |
|---|---|---|---|
| 0 | Read repo + API | ✅ done | — |
| 1 | Session harness (connect/warm/start/stay-up, status panel, kill+reap, credit meter) | ✅ done | Eni |
| — | Seed hunt (8 seeds × 90s, pick calm/no-flare/least-banding, LOCK it) | 🔄 running | Eni |
| B | Recovery: on any loss of `ready` → reattach via cached JWT, fallback reap+rewarm locked seed | ⏳ next | Eni |
| 2 | Prompt wording — foreclose the sun in SETTING, tune against locked seed | ⏳ blocked on seed | Eni |
| **3** | **Breath detection** | **✅ offline implementation + tests; actual laptop mic check pending** | **teammate** |
| **4** | **Entrainment ramp** | **✅ pure logic + offline preview tested; live wire-in pending** | **teammate** |
| 5 | Clinician distress override | later, only if time | — |

**Known unsolved:** one unexplained transport drop at 58s, cause unknown,
one event in ~11 min. B auto-recovers any loss of `ready`, so B is our
*mitigation*, not a fix. We ship recoverable. Don't tell anyone it's "handled."

### Teammate build: try it now

Run `npm install && npm run dev`, then open **http://localhost:3000/breath**.
The workbench runs independently of the session harness and needs no API keys
or Orbis slot. Use the manual slider, try the optional microphone, then choose
**Play 90s preview** or **Simulate full 90s**. Export the timestamped prompt log
as JSON. All preview prompts are simulated; nothing is sent to the model.

Checks: `npm test`, `npm run test:browser` (Chrome), `npm run typecheck`,
`npm run build`. Terminal-only trace: `npm run simulate:entrainment -- 18 1960`.
See [implementation details and Eni's integration checklist](docs/breathing-workbench.md).
The mic is a sound-envelope heuristic and still needs the actual laptop breath
test. The prescribed two-chunk cadence skips some phases at faster rates;
physical synchronization is unverified.

---

## GATE 3 — Breath detection (teammate, start now)

Goal: turn a person's breathing into a `breathsPerMinute` number, live, with a
visible waveform so an audience can see it working.

**Build the slider FIRST, mic SECOND.** The manual BPM slider is the guaranteed
fallback path and must ALWAYS work.

1. **Manual BPM slider** (do first): a control that outputs a `targetBpm` number,
   range ~4–20. This is the fallback if the mic fails on stage. Wire the whole
   rest of the pipeline to consume this number first.
2. **Mic path** (do second): Web Audio API `getUserMedia` → `AnalyserNode` →
   amplitude envelope → smooth it → detect inhale/exhale transitions → estimate
   BPM over a rolling window (~20–30s). **Simple and robust, not accurate.**
3. **Live waveform** on screen — the amplitude envelope drawn to a canvas, plus
   the detected BPM as a big number. The audience needs to SEE it responding.

**No pose estimation, no PPG, no ML models.** If the mic path exceeds ~45 min,
stop and ship the slider — say so and move on.

**Interface to expose** (so Gate 4 and the main loop can consume it):
```ts
// The one thing the rest of the app needs from Gate 3:
type BreathSource = {
  getCurrentBpm(): number;      // detected (mic) or set (slider)
  subscribe(cb: (bpm: number) => void): () => void;
  mode: "mic" | "slider";
};
```
Test it by breathing into a laptop mic. Zero Orbis session required.

---

## GATE 4 — Entrainment ramp (teammate, start now as pure logic)

Goal: given the detected starting BPM and elapsed time, decide the current
**target breathing rate** and which **phase clause** to send. Build this as a
pure, testable function with NO session — wire it to `set_prompt` later.

1. **Ramp function** (pure, unit-testable):
   ```ts
   // startBpm: person's detected rate at t=0
   // elapsedMs: since arc start
   // returns the target rate to guide toward RIGHT NOW
   function targetRate(startBpm: number, elapsedMs: number): number
   ```
   - Start at `startBpm`, ramp DOWN toward **6 bpm by ~75s**, hold to 90s.
   - **Small decrements, never a jump.** Ease it (e.g. linear or ease-out).
   - Arc total = **90s**. This is a hard limit (coherence rots after).

2. **Phase clause selector** (pure): given the current point in a breath cycle
   at the target rate, return which phase text to send:
   - inhale phase → world swells / water rises / light gathers
   - exhale phase → world settles / water recedes / light softens
   - The SETTING and CAMERA clause is IDENTICAL every send — only the phase
     clause changes. Full template lives in `lib/scene.ts` (Eni owns wording).

3. **The template shape** Gate 4 fills (do not change SETTING/CAMERA):
   ```
   "The same [SETTING], the same [CAMERA]. [PHASE].
    Continuous slow motion, no cuts, a single unbroken take."
   ```

4. **Fire cadence:** every 2 chunks, driven off `chunk_complete` events — NOT a
   timer. (~2 chunks ≈ 3.9s observed.) The main loop will call your selector on
   each chunk; you just need it to return the right string.

**Test with no session:** feed your ramp+selector a fake stream of chunk ticks
and a fake BPM, assert it produces the right target curve and the right
sequence of phase clauses. Log every prompt string it would send, with a
timestamp. When the seed is locked and wording is tuned, we swap the fake
chunk stream for real `chunk_complete` events and it's live.

---

## Integration point (later, needs the slot — Eni drives)

When seed is locked + wording tuned:
`BreathSource.getCurrentBpm()` → `targetRate()` → phase selector →
`lib/scene.ts` template → `set_prompt` on every 2nd `chunk_complete`.
One person on the slot for this. Announce it.

---

## Non-negotiables (whole team)

- Working and ugly beats elegant and broken.
- Manual BPM slider must always work as a fallback to the same loop.
- Every prompt sent gets logged with a timestamp.
- No auth, no database, no design system, no landing page.
- Kill sessions between tasks. Announce the slot.
