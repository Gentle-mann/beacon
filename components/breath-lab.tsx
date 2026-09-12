"use client";

import { BreathPanel } from "@/components/breath-panel";
import { useBreathSource } from "@/hooks/use-breath-source";

export function BreathLab() {
  const breath = useBreathSource();
  return <div className="breath-grid"><BreathPanel breath={breath} /></div>;
}
