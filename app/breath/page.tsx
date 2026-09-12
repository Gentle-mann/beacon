import Link from "next/link";
import { BreathLab } from "@/components/breath-lab";

export const metadata = { title: "Beacon | Breathing workbench" };

export default function BreathPage() {
  return (
    <main className="breath-page">
      <header className="breath-page-header">
        <div><span className="eyebrow">Beacon · offline workbench</span><h1>A world that follows your rhythm.</h1><p>Build and rehearse the breathing input without an Orbis session.</p></div>
        <Link className="btn" href="/operator" prefetch={false}>Session harness ↗</Link>
      </header>
      <BreathLab />
    </main>
  );
}
