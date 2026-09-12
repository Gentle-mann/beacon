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
