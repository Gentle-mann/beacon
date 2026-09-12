"use client";

import { BreathPanel } from "@/components/breath-panel";
import { EntrainmentPanel } from "@/components/entrainment-panel";
import { useBreathSource } from "@/hooks/use-breath-source";

export function BreathLab() {
  const breath = useBreathSource();
  return <div className="breath-grid"><BreathPanel breath={breath} /><EntrainmentPanel source={breath.source} /></div>;
}
