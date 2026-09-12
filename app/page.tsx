import { OrbisDemo } from "@/components/orbis-demo";
import Link from "next/link";

export default function Home() {
  return (
    <main>
      <p className="offline-link"><Link href="/breath">Open breathing workbench · no session needed →</Link></p>
      <OrbisDemo />
    </main>
  );
}
