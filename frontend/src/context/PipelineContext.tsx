import React, { createContext, useContext, useState } from "react";
import type { PipelineData } from "@/types/pipeline";

interface PipelineContextType {
  inputText: string;
  setInputText: (text: string) => void;
  pipelineData: PipelineData | null;
  setPipelineData: (data: PipelineData | null) => void;
}

const PipelineContext = createContext<PipelineContextType | null>(null);

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [inputText, setInputText] = useState("");
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);

  return (
    <PipelineContext.Provider value={{ inputText, setInputText, pipelineData, setPipelineData }}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline must be used within PipelineProvider");
  return ctx;
}
