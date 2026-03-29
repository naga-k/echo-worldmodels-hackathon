import { useState, useRef, useEffect, useCallback } from "react";
import type { Scene } from "@/types/pipeline";
import { createMicrophoneStream, createPCMPlayer, pcm16ToFloat32 } from "@/lib/audio";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8002";
const WS_BASE = API_BASE.replace(/^http/, "ws");

export type GeminiLiveStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseGeminiLiveOptions {
  storyText: string;
  scenes: Scene[];
  currentSceneId: string;
  canvasRef: { current: HTMLCanvasElement | null };
  /** If provided, PCM player routes through this shared AudioContext + GainNode instead of creating its own. */
  audioContext?: AudioContext | null;
  voiceGain?: GainNode | null;
}

export function useGeminiLive({
  storyText,
  scenes,
  currentSceneId,
  canvasRef,
  audioContext,
  voiceGain,
}: UseGeminiLiveOptions) {
  const [status, setStatus] = useState<GeminiLiveStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const stopMicRef = useRef<(() => void) | null>(null);
  const playerRef = useRef<ReturnType<typeof createPCMPlayer> | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSpeakingRef = useRef(false);
  const micMutedRef = useRef(false);
  // Track scene changes so we can notify Gemini without restarting
  const prevSceneIdRef = useRef(currentSceneId);

  // Notify Gemini when the active scene changes mid-session
  useEffect(() => {
    if (
      prevSceneIdRef.current !== currentSceneId &&
      wsRef.current?.readyState === WebSocket.OPEN
    ) {
      wsRef.current.send(JSON.stringify({ type: "scene_change", scene_id: currentSceneId }));
    }
    prevSceneIdRef.current = currentSceneId;
  }, [currentSceneId]);

  const cleanup = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (speakingTimerRef.current) {
      clearTimeout(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
    stopMicRef.current?.();
    stopMicRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    if (wsRef.current) {
      // Null out handlers before close so they don't fire setState after unmount
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setStatus("disconnected");
    setError(null);
  }, [cleanup]);

  const start = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    // Use the shared AudioContext + voiceGain from the mixer if provided,
    // otherwise fall back to creating a standalone context (for backward compat).
    let player: ReturnType<typeof createPCMPlayer>;
    if (audioContext && voiceGain) {
      player = createPCMPlayer(24000, audioContext, voiceGain);
    } else {
      const ctx = new AudioContext({ sampleRate: 24000 });
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      player = createPCMPlayer(24000, ctx, gain);
    }
    playerRef.current = player;

    const ws = new WebSocket(`${WS_BASE}/ws/gemini-live`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    try {
      // Wait for WebSocket handshake
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), 10000);
        ws.onopen = () => { clearTimeout(timeout); resolve(); };
        ws.onerror = () => { clearTimeout(timeout); reject(new Error("WebSocket connection failed")); };
      });

      // Send story context so backend can build Gemini's system prompt
      ws.send(JSON.stringify({
        story_text: storyText,
        scenes,
        current_scene_id: prevSceneIdRef.current,
      }));

      // Wait for the backend to confirm Gemini session is open
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Gemini session timeout")), 20000);
        ws.onmessage = (event) => {
          if (typeof event.data === "string") {
            const msg = JSON.parse(event.data);
            if (msg.type === "status" && msg.message === "connected") {
              clearTimeout(timeout);
              resolve();
            } else if (msg.type === "error") {
              clearTimeout(timeout);
              reject(new Error(msg.message));
            }
          }
        };
      });

      setStatus("connected");

      // Set up permanent message handler for the live session
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary = 16-bit PCM audio response from Gemini at 24kHz
          isSpeakingRef.current = true;
          setIsSpeaking(true);
          playerRef.current?.play(pcm16ToFloat32(event.data));
          // Reset speaking flag 500ms after the last audio chunk arrives
          if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
          speakingTimerRef.current = setTimeout(() => {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
          }, 500);
        } else if (typeof event.data === "string") {
          // Handle interruption: Gemini detected user speaking, stop playback
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "interrupted" || msg.interrupted) {
              isSpeakingRef.current = false;
              setIsSpeaking(false);
              // PCM player will naturally stop when no new chunks arrive
            }
          } catch {
            // Not JSON, ignore
          }
        }
      };

      ws.onclose = () => {
        cleanup();
        setStatus("disconnected");
      };

      ws.onerror = () => {
        setError("Connection lost");
        setStatus("error");
        cleanup();
      };

      // Start microphone capture and stream PCM to backend.
      // Gemini Live handles turn-taking server-side. Mic can be muted
      // via toggleMic() without disconnecting the session.
      const stopMic = await createMicrophoneStream((pcm) => {
        if (ws.readyState === WebSocket.OPEN && !micMutedRef.current) {
          ws.send(pcm);
        }
      });
      stopMicRef.current = stopMic;

      // Capture canvas frame at 1 FPS and send to backend for Gemini to see
      frameIntervalRef.current = setInterval(() => {
        const canvas = canvasRef.current;
        if (!canvas || ws.readyState !== WebSocket.OPEN) return;
        try {
          const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
          const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
          ws.send(JSON.stringify({ type: "frame", data: base64 }));
        } catch {
          // Canvas may be tainted cross-origin; silently skip
        }
      }, 1000);

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setStatus("error");
      cleanup();
    }
  }, [storyText, scenes, canvasRef, cleanup, audioContext, voiceGain]);

  const toggleMic = useCallback(() => {
    micMutedRef.current = !micMutedRef.current;
    setMicMuted(micMutedRef.current);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => cleanup(), [cleanup]);

  return {
    status,
    error,
    start,
    stop,
    toggleMic,
    micMuted,
    isActive: status !== "disconnected",
    isSpeaking,
  };
}
