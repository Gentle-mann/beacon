import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

/**
 * Sink for breath-detection telemetry.
 *
 * The run that matters happens in the operator's own browser, not in any
 * tooling, so the samples have to land somewhere on disk that can be read back
 * afterwards. The page posts a rolling snapshot; the newest POST wins.
 *
 * Diagnostics only — nothing in the demo path reads this.
 */

const DIR = path.join(process.cwd(), ".breathlog");

/**
 * One file per client. Two tabs on this app are two independent posters, and a
 * single shared file means whichever posted last silently destroys the other's
 * run — which is exactly what happened the first time this was used.
 */
function fileFor(clientId: string) {
  const safe = clientId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "anon";
  return path.join(DIR, `run-${safe}.json`);
}

export type BreathSample = {
  /** ms since the run started */
  t: number;
  detected: number | null;
  effective: number;
  target: number | null;
  arcElapsed: number | null;
  level: number;
  envelope: number;
  cycles: number;
  rising: boolean;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      label?: string;
      clientId?: string;
      samples?: BreathSample[];
    };
    await mkdir(DIR, { recursive: true });
    await writeFile(
      fileFor(body.clientId ?? "anon"),
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          clientId: body.clientId ?? "anon",
          label: body.label ?? "",
          count: body.samples?.length ?? 0,
          samples: body.samples ?? [],
        },
        null,
        2,
      ),
      "utf8",
    );
    return NextResponse.json({ ok: true, count: body.samples?.length ?? 0 });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : String(caught) },
      { status: 500 },
    );
  }
}

/** Returns every client's run, richest first, so the real one is easy to pick. */
export async function GET() {
  try {
    const names = await readdir(DIR);
    const runs = [];
    for (const name of names) {
      if (!name.startsWith("run-")) continue;
      try {
        runs.push(JSON.parse(await readFile(path.join(DIR, name), "utf8")));
      } catch {
        /* skip a half-written file */
      }
    }
    runs.sort(
      (a, b) =>
        (b.samples?.filter((s: BreathSample) => s.detected !== null).length ?? 0) -
        (a.samples?.filter((s: BreathSample) => s.detected !== null).length ?? 0),
    );
    return NextResponse.json(
      { runs: runs.length, data: runs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ runs: 0, data: [], note: "no log yet" });
  }
}
