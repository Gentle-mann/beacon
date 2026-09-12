import Link from "next/link";
import { OrbisDemo } from "@/components/orbis-demo";

export default function OperatorPage() {
  return <main><p className="offline-link"><Link href="/" prefetch={false}>← Return to Beacon</Link> · <Link href="/breath" prefetch={false}>Breathing workbench</Link></p><OrbisDemo /></main>;
}
