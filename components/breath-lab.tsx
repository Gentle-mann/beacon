"use client";

import { WorkbenchBreathPanel } from "@/components/workbench-breath-panel";
import { EntrainmentPanel } from "@/components/entrainment-panel";
import { useBreathSource } from "@/hooks/use-breath-source";

export function BreathLab() {
  const breath = useBreathSource();
  return <div className="breath-grid"><WorkbenchBreathPanel breath={breath} /><EntrainmentPanel source={breath.source} /></div>;
}
