# Beacon session experience

`/` is the patient surface. `/breath` keeps the offline diagnostic workbench;
`/operator` preserves Eni's original harness. Opening either patient or
workbench route does not mount the operator's account-wide polling hook.

## Try it locally

Run `npm install` and `npm run dev`, then open `http://localhost:3000/`.
Start preview runs local artwork and a simulated chunk stream through the same
controller as live mode. It does not mint a token, load the Reactor SDK, create
a provider session, or produce generated video/audio. The optional microphone
processes audio locally and uploads nothing.

The scenery chooser includes the original lagoon plus eight generated 16:9
reference images. The selected card changes the honest local preview. In live
mode, the selected image is fetched from the app, uploaded through the scoped
Reactor client, passed to `set_image`, and confirmed by `image_accepted` plus
`state.has_image` before scene setup continues. An explicit
`generation_started.image_conditioned: false` falls back to the local view.

| Scenery | Breathing-driven movement |
|---|---|
| Quiet lagoon | Water swells widen and settle |
| Silk pavilion | Curtain folds become longer, slower billows |
| Sea of clouds | Cloud lifts spread into broad, quiet cycles |
| Golden grassland | Short waves grow into wide coordinated bands |
| Living desert | Fine sand ribbons soften into broad dune ripples |
| Aurora horizon | Narrow light folds become wide, slow arcs |
| Jellyfish sanctuary | Frequent pulses become slow expansion and release |
| Cathedral of mist | Small currents become broad movement through the arches |
| Floating ink world | Small blooms become broad, slowly dissolving clouds |

The guide is off by default. Starting captures the manual or estimated BPM
once, stops the microphone, and locks that pace for this run. Manual changes
during a run apply next time. The mic cannot be restarted during a run. Guide
and motion preferences can change during the run; live prompt changes wait
for the prescribed two-chunk cadence. Still is a prompt preference, not a
guarantee that a generative model will produce motionless video.
This is a timed guide based on the starting pace, not continuous feedback from
actual breathing. Successful real microphone-to-model response remains untested.

## Enable a coordinated live run

Set these server environment variables and restart the development server:

```dotenv
REACTOR_API_KEY=<your key>
BEACON_LIVE_ENABLED=true
BEACON_LOCKED_SEED=2026
```

The updated `main` (PR #4, commit `68c7be0`) selects seed 2026 in `lib/scene.ts`
and records 1234 as the calm-validated alternate. `.env.example` matches 2026
while keeping live mode disabled. The environment seed is explicit so a run
cannot silently switch seeds when scene code changes.

PR #4 reports live validation of the operator's recovery and rate-based arc.
That operator remains at `/operator` with its upstream behavior: reap, create
a new run, and restart the arc from zero. The patient controller instead
reattaches the original session, retains its deadline, and falls back locally.
The operator uses progressively slower scene clauses; the patient guide adds
optional inhale/exhale clauses. Both use the canonical scene template, but the
operator's live results do not validate the patient prompts or recovery policy.

`GET /api/experience/config` reports availability without calling Reactor.
Live Start alone calls `POST /api/experience/token`. The new JWT requests:

| Constraint | Value | Purpose |
|---|---|---|
| `model` | `reactor/visko-orbis-stable` | Restrict the model |
| `max_sessions` | `1` | One total creation per token, not a concurrency limit |
| `max_session_duration_seconds` | `120` | Provider-side session duration backstop |
| `expires_after` | `300` | Short token lifetime with time for cleanup |

The duration constraint is documented in [Reactor authentication](https://docs.reactor.inc/authentication).
Token expiry alone is not the session duration limit. The request shape is
tested with a fake provider; actual provider enforcement still needs acceptance
in the shared model slot. A 120-second cap includes startup overhead, so a slow
connection may end the generated scene before the application arc finishes.

## Lifecycle

1. Create one token/client and connect. Subscribe to events before connecting so
   early session IDs and synchronous replies are not lost.
2. Wait for transport `ready`; for a reference scene, upload and apply its image
   and wait for `state.has_image`. Then send the locked seed, scene-specific
   audio prompt and opening scene; wait for `conditions_ready` before
   dispatching `start`.
3. Start the 90-second deadline immediately before dispatch. Only model
   `generation_started`, resumed generation, or `state.started` confirms
   running. The live badge additionally requires emitted frames and browser
   playback. A command promise resolving is not proof of success.
4. Build the selected scenery prompt every second valid, forward
   `chunk_complete`. Ignore mirrored `state.current_chunk`. Preserve that
   scenery's SETTING/CAMERA/CONTINUITY while target BPM selects its active,
   steady, or settled motion clause and the optional guide adds its phase.
   Serialize prompts and retain only the latest pending one. In-memory prompt
   entries distinguish preview/live and record timestamp and acknowledgement;
   the separate workbench exports its simulated trace.
5. On loss of ready, hide the live stream and reattach the original client/JWT
   within 12 seconds, with at most three settled attempts. Never queue another
   reconnect behind a stuck one. Never restart the arc or mint a replacement
   token automatically. Use local fallback on failure.
6. Stop on the original deadline even with no chunks, on user Stop, page
   backgrounding/leaving, an early generation end/reset, or an unrecoverable
   error. Startup also has its own 30-second timeout.

Stop invalidates the run immediately and ignores its late events. SDK disconnect
and `POST /api/experience/stop` run independently, because the SDK can queue
disconnect behind an unresolved connection or command. The latter sends only
the owned session ID and JWT; Reactor verifies that capability. It never uses
the server API key or lists/deletes unrelated sessions. Pagehide additionally
uses a best-effort beacon. A confirmed close is required before a new start;
unconfirmed cleanup stays visible with Retry Stop. A browser close or lost
network cannot guarantee beacon delivery; the provider cap is the backstop.

## Checks and remaining evidence

```sh
npm test
npm run test:browser
npm run typecheck
npm run build
```

Unit tests exercise deadlines, readiness, chunk cadence, early endings, stale
prompts, cancellation during startup, blocked reconnects, session ownership,
late SDK/token arrivals and API request validation. Browser tests use a local
preview and synthetic mic denial, including 90-second completion/restart,
mobile Stop placement, keyboard controls and reduced motion. Desktop/mobile
rendering is inspected separately. These checks do not open a real model
session or the user's microphone.

Eni's live acceptance run must verify the locked seed and wording, first real
video/audio, the two motion preferences, optional guide updates, a transport
interruption, Stop during warmup and running, page exit, provider closure and
the native duration cap. Confirm the shared slot is free after each attempt.
Then test the actual laptop mic and observe real users; synthetic signals and
prompt acknowledgements are not evidence of comfort or breath synchronization.

## Hosting boundary

This is a private demo, not a public service. Same-origin request checks reduce
cross-site browser requests but provide neither authentication nor admission
control. The existing `/api/token` and `/api/sessions` still power Eni's operator
harness with its original permissions. Protect or remove those routes before
public hosting; add access/rate/concurrency controls and operational monitoring.
The experience API neither upgrades nor secures the original harness.
