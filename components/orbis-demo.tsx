"use client";

import { ReactorProvider } from "@reactor-team/js-sdk";
import { useCallback, useRef, useState } from "react";

import { BreathPanel } from "@/components/breath-panel";
import { OrbisPlayer } from "@/components/orbis-player";
import { useBreathSource } from "@/hooks/use-breath";
import { StatusPanel } from "@/components/status-panel";
import { useOrbisSession } from "@/hooks/use-orbis-session";
import { ORBIS_MODEL_NAME, ORBIS_TRACKS, requestReactorJwt } from "@/lib/orbis";

export function OrbisDemo() {
  // A session-scoped token owns only the sessions IT created. The SDK calls
  // this resolver more than once per connect (create session, then GET it), so
  // every call MUST return the same token or the second request 403s against
  // the session the first one created. The starter's memoisation was
  // load-bearing, not a bug.
  //
  // It is reset only by an intentional kill, never on an unplanned drop: after
  // a network blip the reconnect has to present the token that owns the live
  // session. Tokens last 6h, so holding one for the page lifetime is fine.
  const jwtPromise = useRef<Promise<string> | null>(null);
  const getJwt = useCallback(() => {
    jwtPromise.current ??= requestReactorJwt();
    return jwtPromise.current;
  }, []);
  const resetJwt = useCallback(() => {
    jwtPromise.current = null;
  }, []);

  return (
    <section className="demo-shell">
      <ReactorProvider
        apiUrl="https://api.reactor.inc"
        modelName={ORBIS_MODEL_NAME}
        modelTracks={[...ORBIS_TRACKS]}
        connectOptions={{ autoConnect: false }}
        jwtToken={getJwt}
      >
        <SessionShell resetJwt={resetJwt} />
      </ReactorProvider>
    </section>
  );
}

function SessionShell({ resetJwt }: { resetJwt: () => void }) {
  const [sliderBpm, setSliderBpm] = useState(14);
  const breath = useBreathSource(sliderBpm);

  // A ref, not a prop: the arc reads the rate at the instant it starts, and a
  // value that changes 20x a second should not re-run the session hook.
  const breathRate = useRef(sliderBpm);
  breathRate.current = breath.effectiveBpm;

  const session = useOrbisSession(resetJwt, breathRate);

  return (
    <div className="session-grid">
      <OrbisPlayer
        mounted={session.viewMounted}
        connected={session.connected}
        muted={session.muted}
        status={session.status}
        phase={session.phase}
        runStarted={session.runStarted}
        framesEmitted={session.framesEmitted}
        busy={session.busy}
      />
      <div className="right-column">
        <BreathPanel
          breath={breath}
          sliderBpm={sliderBpm}
          setSliderBpm={setSliderBpm}
          targetBpm={session.targetBpm}
          arcRunning={session.arcRunning}
          disabled={session.arcRunning}
        />
        <StatusPanel session={session} />
      </div>
    </div>
  );
}
