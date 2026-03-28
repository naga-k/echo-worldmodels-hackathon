"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";

const SceneViewer = dynamic(() => import("@/components/SceneViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-gray-400">
      Loading 3D viewer...
    </div>
  ),
});

type Stage =
  | "input"
  | "extracting"
  | "extracted"
  | "generating"
  | "polling"
  | "viewing";

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [spatialDescription, setSpatialDescription] = useState("");
  const [spzUrl, setSpzUrl] = useState("");
  const [stage, setStage] = useState<Stage>("input");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const extractDescription = useCallback(async () => {
    if (!inputText.trim()) return;
    setError("");
    setStage("extracting");
    setStatusMessage("Extracting spatial description with Claude...");

    try {
      const res = await fetch("/api/extract-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to extract description");
      }

      const data = await res.json();
      setSpatialDescription(data.description);
      setStage("extracted");
      setStatusMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStage("input");
      setStatusMessage("");
    }
  }, [inputText]);

  const generateWorld = useCallback(async () => {
    if (!spatialDescription) return;
    setError("");
    setStage("generating");
    setStatusMessage("Sending to World Labs API...");

    try {
      // Step 1: Start generation
      const genRes = await fetch("/api/generate-world", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: spatialDescription }),
      });

      if (!genRes.ok) {
        const data = await genRes.json();
        throw new Error(data.error || "Failed to start world generation");
      }

      const genData = await genRes.json();
      const operationId = genData.name || genData.operation_id || genData.id;

      if (!operationId) {
        throw new Error("No operation ID returned from World Labs API");
      }

      // Step 2: Poll until done
      setStage("polling");
      setStatusMessage("Generating 3D world... This may take a few minutes.");

      let attempts = 0;
      const maxAttempts = 120; // 10 minutes at 5s intervals

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;

        const pollRes = await fetch(
          `/api/poll-operation?operationId=${encodeURIComponent(operationId)}`
        );

        if (!pollRes.ok) {
          const data = await pollRes.json();
          throw new Error(data.error || "Polling failed");
        }

        const pollData = await pollRes.json();

        if (pollData.done || pollData.status === "SUCCEEDED") {
          // Extract SPZ URL from the response
          const result = pollData.response || pollData.result || pollData;
          const url =
            result.spz_url ||
            result.world?.spz_url ||
            result.output?.spz_url ||
            result.response?.spz_url;

          if (!url) {
            console.log("Full poll response:", JSON.stringify(pollData));
            throw new Error(
              "World generation completed but no SPZ URL found in response"
            );
          }

          setSpzUrl(url);
          setStage("viewing");
          setStatusMessage("");
          return;
        }

        if (pollData.error || pollData.status === "FAILED") {
          throw new Error(
            pollData.error?.message ||
              "World generation failed: " + JSON.stringify(pollData)
          );
        }

        setStatusMessage(
          `Generating 3D world... (${attempts * 5}s elapsed)`
        );
      }

      throw new Error("World generation timed out after 10 minutes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStage("extracted");
      setStatusMessage("");
    }
  }, [spatialDescription]);

  const reset = () => {
    setInputText("");
    setSpatialDescription("");
    setSpzUrl("");
    setStage("input");
    setError("");
    setStatusMessage("");
  };

  // Full-screen viewer mode
  if (stage === "viewing" && spzUrl) {
    return (
      <div className="fixed inset-0">
        <SceneViewer spzUrl={spzUrl} />
        <div className="absolute top-4 left-4 z-10 flex gap-2">
          <button
            onClick={reset}
            className="bg-gray-800/80 hover:bg-gray-700 text-white px-4 py-2 rounded-lg backdrop-blur-sm text-sm"
          >
            New Scene
          </button>
        </div>
        <div className="absolute bottom-4 left-4 z-10 text-xs text-gray-400 bg-gray-900/70 px-3 py-2 rounded-lg backdrop-blur-sm">
          Drag to orbit | Scroll to zoom | WASD to fly | Q/E up/down
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">3D Scene Generator</h1>
          <p className="text-gray-400 text-sm">
            Paste a text description of a physical space and generate a 3D scene
          </p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {statusMessage && (
          <div className="bg-blue-900/50 border border-blue-700 text-blue-200 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <svg
              className="animate-spin h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {statusMessage}
          </div>
        )}

        {/* Input stage */}
        {(stage === "input" || stage === "extracting") && (
          <div className="space-y-4">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste a description of a room, scene, or physical space here... (e.g., a paragraph from a podcast transcript describing a studio, a living room, an outdoor garden)"
              className="w-full h-48 bg-gray-900 border border-gray-700 rounded-lg p-4 text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={stage === "extracting"}
            />
            <button
              onClick={extractDescription}
              disabled={!inputText.trim() || stage === "extracting"}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-3 rounded-lg transition-colors"
            >
              {stage === "extracting"
                ? "Extracting..."
                : "Extract Spatial Description"}
            </button>
          </div>
        )}

        {/* Extracted description stage */}
        {(stage === "extracted" ||
          stage === "generating" ||
          stage === "polling") && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Extracted Spatial Description
              </label>
              <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 text-gray-200 text-sm leading-relaxed">
                {spatialDescription}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={reset}
                disabled={stage === "generating" || stage === "polling"}
                className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white font-medium py-3 rounded-lg transition-colors"
              >
                Start Over
              </button>
              <button
                onClick={generateWorld}
                disabled={stage === "generating" || stage === "polling"}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium py-3 rounded-lg transition-colors"
              >
                {stage === "generating" || stage === "polling"
                  ? "Generating..."
                  : "Generate 3D World"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
