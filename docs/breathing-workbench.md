# Teammate lane: breathing workbench

Open `/breath` after `npm install && npm run dev`. This route does not mount the
Reactor provider or session hook and makes no Reactor API requests. It works
without `.env.local` or a model slot.

## Gate 3

- The manual slider is the default `BreathSource` and covers 4–20 BPM. Moving it
  stops the mic immediately, including a pending permission request.
- Mic input uses a local Web Audio RMS envelope, smoothing, hysteresis and a
  rolling 30-second history. Two consistent intervals are required before an
  estimate becomes the active source. Slow rates can need more than 30 seconds.
- Missing, stale or implausible estimates use the last manual value; the UI
  distinguishes the active source from the detected estimate.
- The canvas shows microphone energy, never simulated breathing. Nothing is
  recorded or uploaded. Backgrounding the page stops the mic. Resume manually.
- This is a rough sound heuristic. It assumes one audible swell per breath;
  speech, background noise and two audible bursts per breath can confuse it.
  An amplitude envelope does not identify physiological inhale vs exhale.

The exported contract is in `lib/breath-source.ts`; `useBreathSource()` owns the
browser lifecycle and returns the same source to the UI and future arc control.

### Verification

`npm test` covers source switching, unsubscribe, synthetic 4/6/12/20 BPM,
silence, clicks and stale samples. `npm run typecheck` checks the app types.

Before calling the mic stage-ready, breathe into the actual demo laptop mic,
check the trace for one swell per breath, compare against a manually counted
rate, deny permission once, unplug/switch inputs, then move the slider while
listening. Synthetic tests do not validate real breath-detection accuracy.

Browser API references: [getUserMedia permission and secure-context behavior](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[AnalyserNode time-domain samples](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData).

## Gate 4

The adjacent panel consumes the same `BreathSource`. **Play 90s preview** captures
its current BPM once and runs a fake chunk stream in real time. **Simulate full
90s** produces the entire trace immediately. Both use `advanceEntrainment`,
every second valid chunk, with the same canonical `buildPrompt` as the live app.
The default stream emits 22 prompts, last at 86.24s, and none at/after 90s.
**Export JSON** preserves the complete simulated prompt text and timestamps.

`npm run simulate:entrainment -- 18 1960` produces the same trace in the terminal
without opening a browser. Unit tests cover gradual rates, integrated phase,
irregular and duplicate chunks, immutable scene clauses and the hard cutoff.
`npm run test:browser` runs browser lifecycle and offline-flow checks in Chrome.

Starts below 6 BPM hold their initial rate rather than increasing. The phase
uses the integral of the changing rate; multiplying elapsed time by the current
rate would move the phase backwards. The fixed ~3.92s send interval undersamples
faster breath cycles; this demo does not establish physical synchronization.

### Live adapter and handoff to Eni (requires the live slot)

The root patient experience now implements the sequence below in
`lib/experience-controller.ts`, with its own bounded Reactor adapter. The old
operator restate loop remains at `/operator`; it is not mounted on `/` or
`/breath`. See [experience lifecycle and acceptance](experience.md).

1. Lock the seed and tune the provisional inhale/exhale wording. `lib/scene.ts`
   is untouched; SETTING/CAMERA/CONTINUITY still come from that tuning file.
2. Capture `source.getCurrentBpm()` once when the arc begins. Create state using
   `createEntrainmentState(bpm, startTimestamp)`.
3. On actual `chunk_complete`, pass `chunk_index` and event receipt time in that
   same clock to `advanceEntrainment`. Log each returned prompt and pass its
   `text` to the existing logged `sendPrompt` path.
4. Disable the existing restate loop while Gate 4 owns prompting, so the two
   loops cannot send competing prompts. Do not wire to mirrored `state` events.
5. Stop generation/session at the 90s deadline even if no more chunks arrive;
   the pure reducer prevents late prompts but does not kill a billed session.
   Recovery must preserve the original deadline. Run the integration on the
   locked seed with Eni driving the slot.

The live adapter is implemented, but no real model sessions or validation of
microphone accuracy were part of the automated offline checks.
