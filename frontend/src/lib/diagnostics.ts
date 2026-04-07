import type { Scene, SpzTier } from "@/types/pipeline";

const TIER_ORDER: SpzTier[] = ["full_res", "500k", "100k", "legacy"];

export function selectSceneSpz(scene: Scene | undefined, preferredTier: SpzTier): { url?: string; tier?: SpzTier } {
  if (!scene) return {};

  if (scene.spz_urls?.[preferredTier]) {
    return { url: scene.spz_urls[preferredTier], tier: preferredTier };
  }

  for (const tier of TIER_ORDER) {
    const url = scene.spz_urls?.[tier];
    if (url) {
      return { url, tier };
    }
  }

  return {
    url: scene.spz_url,
    tier: scene.selected_spz_tier,
  };
}

export function downloadCanvas(canvas: HTMLCanvasElement | null, filename: string) {
  if (!canvas) return;
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  link.click();
}
