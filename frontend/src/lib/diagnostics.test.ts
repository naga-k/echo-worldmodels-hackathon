import { describe, expect, it } from "vitest";

import { selectSceneSpz } from "@/lib/diagnostics";

describe("selectSceneSpz", () => {
  it("prefers the requested tier when present", () => {
    const selection = selectSceneSpz(
      {
        id: "scene_1",
        title: "Scene",
        source_ref: "",
        marble_prompt: "",
        narration_text: "",
        time_start: 0,
        time_end: 1,
        camera_direction: "forward",
        mood: "noir",
        spz_urls: {
          full_res: "https://example.com/full.spz",
          "500k": "https://example.com/500k.spz",
        },
      },
      "full_res",
    );

    expect(selection.tier).toBe("full_res");
    expect(selection.url).toBe("https://example.com/full.spz");
  });

  it("falls back deterministically when the preferred tier is missing", () => {
    const selection = selectSceneSpz(
      {
        id: "scene_2",
        title: "Scene",
        source_ref: "",
        marble_prompt: "",
        narration_text: "",
        time_start: 0,
        time_end: 1,
        camera_direction: "forward",
        mood: "noir",
        spz_urls: {
          "500k": "https://example.com/500k.spz",
        },
      },
      "full_res",
    );

    expect(selection.tier).toBe("500k");
    expect(selection.url).toBe("https://example.com/500k.spz");
  });
});
