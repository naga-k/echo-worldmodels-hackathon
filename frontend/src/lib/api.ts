import type { ExtractScenesResponse, GenerateWorldsResponse, PollWorldsResponse, Generation, GenerationSummary } from "@/types/pipeline";

// On localhost, use Vite proxy. On any other host (tunnel, LAN), hit the backend directly.
function getApiUrl() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "/api";
  // Non-localhost: assume backend is on the same host, port 8002
  return `${window.location.protocol}//${host}:8002`;
}
const API_URL = getApiUrl();

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

// ─── Generation API ───

export async function createGeneration(text: string): Promise<{ id: string }> {
  const res = await fetch(`${API_URL}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("Failed to create generation");
  return res.json();
}

export async function getGeneration(id: string): Promise<Generation> {
  const res = await fetch(`${API_URL}/generations/${id}`);
  if (!res.ok) throw new Error("Generation not found");
  return res.json();
}

export async function listGenerations(): Promise<GenerationSummary[]> {
  const res = await fetch(`${API_URL}/generations`);
  if (!res.ok) return [];
  return res.json();
}

export function getAudioUrl(id: string): string {
  return `${API_URL}/generations/${id}/audio`;
}

export function getBgmUrl(generationId: string, sceneId: string): string {
  return `${API_URL}/generations/${generationId}/scenes/${sceneId}/bgm`;
}
