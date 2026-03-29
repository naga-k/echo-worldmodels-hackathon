import type { ExtractScenesResponse, GenerateWorldsResponse, PollWorldsResponse } from "@/types/pipeline";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8002";

export async function extractScenes(text: string): Promise<ExtractScenesResponse> {
  const res = await fetch(`${API_URL}/extract-scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("Failed to extract scenes");
  return res.json();
}

export async function generateSpeech(text: string): Promise<string> {
  const res = await fetch(`${API_URL}/generate-speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: null }),
  });
  if (!res.ok) throw new Error("Failed to generate speech");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function generateWorlds(scenes: { id: string; marble_prompt: string }[], model: string = "Marble 0.1-mini"): Promise<GenerateWorldsResponse> {
  const res = await fetch(`${API_URL}/generate-worlds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenes, model }),
  });
  if (!res.ok) throw new Error("Failed to generate worlds");
  return res.json();
}

export async function pollWorlds(operationIds: string[]): Promise<PollWorldsResponse> {
  const res = await fetch(`${API_URL}/poll-worlds?operation_ids=${operationIds.join(",")}`);
  if (!res.ok) throw new Error("Failed to poll worlds");
  return res.json();
}

export interface SampleStory {
  id: string;
  title: string;
  author: string;
  description: string;
  text: string;
}

export async function fetchSamples(): Promise<SampleStory[]> {
  const res = await fetch(`${API_URL}/samples`);
  if (!res.ok) return [];
  return res.json();
}
