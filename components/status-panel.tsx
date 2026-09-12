"use client";

import { ARC } from "@/lib/scene";
import { CREDIT_BUDGET, USD_PER_CREDIT, formatClock } from "@/lib/orbis";
import type { OrbisSession } from "@/hooks/use-orbis-session";

export function StatusPanel({ session }: { session: OrbisSession }) {
  const budgetPercent = (session.creditsBurned / CREDIT_BUDGET) * 100;
  const usd = session.creditsBurned * USD_PER_CREDIT;
  const warmSeconds =
    session.connectedAt && session.firstFrameAt
      ? (session.firstFrameAt - session.connectedAt) / 1000
      : null;

  return (
    <aside className="panel">
      <div className="panel-row panel-lifecycle">
        {/* One button that does the whole thing. The two-step flow left a black
            screen with a greyed-out Start and no way to tell it apart from a
            failure. Warm-only is still here for pre-warming ahead of a demo. */}
        <button
          type="button"
          className="btn btn-go"
          disabled={session.runStarted || session.busy}
          onClick={() => void session.warmAndStart()}
        >
          ▶ WARM + START
        </button>
        <button
          type="button"
          className="btn btn-warm"
          disabled={session.connected || session.busy}
          onClick={() => void session.warm()}
        >
          Warm only
        </button>
        <button
          type="button"
          className="btn btn-start"
          disabled={!session.connected || session.runStarted || session.busy}
          onClick={() => void session.startRun()}
        >
          Start
        </button>
        <button
          type="button"
          className="btn btn-kill"
          disabled={session.status === "disconnected"}
          onClick={session.killSession}
        >
          ■ KILL SESSION
        </button>
      </div>

      {(session.openSessions ?? 0) > 0 && session.status === "disconnected" ? (
        <button type="button" className="btn btn-kill" onClick={session.reapAll}>
          reap {session.openSessions} orphaned session(s) — still billing
        </button>
      ) : null}

      <button
        type="button"
        className={`btn btn-arc${session.arcRunning ? " btn-arc-on" : ""}`}
        disabled={!session.runStarted}
        onClick={session.arcRunning ? session.stopArc : session.startArc}
      >
        {session.arcRunning
          ? `◉ ARC ${session.arcElapsed.toFixed(0)}s / ${ARC.durationS}s · target ${session.targetBpm?.toFixed(1) ?? "—"} bpm`
          : `▶ run ${ARC.durationS}s arc → ${ARC.targetBpm} bpm`}
      </button>
      <div className="arc-bar">
        <span
          style={{
            width: `${Math.min(100, (session.arcElapsed / ARC.durationS) * 100)}%`,
          }}
        />
      </div>

      <label className="seed-row">
        <span>seed</span>
        <input
          className="seed-input"
          type="number"
          min={0}
          value={session.seed}
          disabled={session.runStarted || session.connected}
          onChange={(event) => session.setSeed(Number(event.target.value) || 0)}
        />
        <em>read once at start</em>
      </label>

      <button
        type="button"
        className={`btn btn-restate${session.restating ? " btn-restate-on" : ""}`}
        disabled={!session.runStarted}
        onClick={session.toggleRestate}
      >
        {session.restating
          ? "◉ HOLDING — restating every 2 chunks"
          : "○ hold scene (restate every 2 chunks)"}
      </button>

      <dl className="stats">
        <Stat label="status" value={session.status} mono />
        <Stat label="phase" value={session.phase} mono />
        <Stat
          label="session_chunk"
          value={session.sessionChunk === null ? "—" : String(session.sessionChunk)}
          mono
        />
        <Stat
          label="frames_emitted"
          value={
            session.framesEmitted === null ? "—" : String(session.framesEmitted)
          }
          mono
        />
        <Stat
          label="recoveries"
          value={String(session.recoveryAttempt)}
          mono
          alert={session.recoveryAttempt > 0}
        />
        <Stat
          label="open sessions (acct)"
          value={
            session.openSessions === null ? "?" : String(session.openSessions)
          }
          mono
          alert={(session.openSessions ?? 0) > 1}
        />
        <Stat
          label="available_resolutions"
          value={session.availableResolutions.join(", ") || "— (awaiting state)"}
          mono
        />
      </dl>

      <div className="meter">
        <div className="meter-head">
          <span>credit burn</span>
          <strong className={budgetPercent > 25 ? "alert" : undefined}>
            {session.creditsBurned.toLocaleString()} cr
          </strong>
        </div>
        <div className="meter-bar">
          <span style={{ width: `${Math.min(100, budgetPercent)}%` }} />
        </div>
        <div className="meter-foot">
          <span>
            connected {formatClock(session.connectedSeconds)} · generating{" "}
            {formatClock(session.generatingSeconds)}
          </span>
          <span>
            {budgetPercent.toFixed(2)}% of 2.6M · ${usd.toFixed(2)}
          </span>
        </div>
        {warmSeconds !== null ? (
          <p className="meter-note">
            first frame {warmSeconds.toFixed(1)}s after connect
          </p>
        ) : null}
      </div>

      <section className="block">
        <h3>active_prompt</h3>
        <p className="prompt-active">{session.activePrompt || "—"}</p>
      </section>

      <section className="block">
        <h3>
          command_error <span className="count">{session.errorLog.length}</span>
        </h3>
        {session.errorLog.length === 0 ? (
          <p className="muted">none</p>
        ) : (
          <ul className="log log-error">
            {session.errorLog.map((entry) => (
              <li key={`${entry.at}-${entry.text}`}>
                <span className="clock">{entry.clock}</span>
                <span className="verbatim">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block">
        <h3>
          prompt log <span className="count">{session.promptLog.length}</span>
          {session.promptLog.length > 0 ? (
            <button
              type="button"
              className="link"
              onClick={session.clearPromptLog}
            >
              clear
            </button>
          ) : null}
        </h3>
        {session.promptLog.length === 0 ? (
          <p className="muted">none</p>
        ) : (
          <ul className="log">
            {session.promptLog.slice(0, 12).map((entry) => (
              <li key={entry.at}>
                <span className="clock">{entry.clock}</span>
                <span>
                  <em>{entry.source}</em>
                  {entry.sentAtChunk !== null ? (
                    <span className="chunkref">
                      {" "}
                      chunk {entry.sentAtChunk}
                      {entry.acceptedAtChunk !== null
                        ? ` → ack ${entry.acceptedAtChunk}`
                        : " → …"}
                    </span>
                  ) : null}
                  <br />
                  {entry.prompt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block">
        <h3>
          transport{" "}
          <span className="count">{session.transportLog.length}</span>
        </h3>
        <ul className="log log-events">
          {session.transportLog.length === 0 ? (
            <li className="muted">no transitions</li>
          ) : (
            session.transportLog.slice(0, 12).map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))
          )}
        </ul>
      </section>

      <section className="block">
        <h3>events</h3>
        <ul className="log log-events">
          {session.events.length === 0 ? (
            <li className="muted">none</li>
          ) : (
            session.events.slice(0, 10).map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))
          )}
        </ul>
      </section>
    </aside>
  );
}

function Stat({
  label,
  value,
  mono,
  alert,
}: {
  label: string;
  value: string;
  mono?: boolean;
  alert?: boolean;
}) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className={`${mono ? "mono" : ""} ${alert ? "alert" : ""}`.trim()}>
        {value}
      </dd>
    </div>
  );
}
