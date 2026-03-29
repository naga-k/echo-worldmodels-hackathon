import { useRef, useCallback } from "react";

const BGM_VOLUME = 0.15;
const BGM_DUCKED_VOLUME = 0.05;
const VOICE_VOLUME = 1.0;
const RAMP_DURATION = 0.2; // 200ms

/**
 * Shared AudioContext with two gain nodes (BGM + voice) and ducking helpers.
 *
 * The AudioContext is created lazily on `resume()`, which MUST be called
 * inside a user-gesture handler (e.g. the "Enter World" button click)
 * to satisfy browser autoplay policy.
 */
export function useAudioMixer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const bgmGainRef = useRef<GainNode | null>(null);
  const voiceGainRef = useRef<GainNode | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgmSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  /** Ensure the AudioContext + gain nodes exist. Idempotent. */
  const ensureContext = useCallback(() => {
    if (ctxRef.current) return;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const bgmGain = ctx.createGain();
    bgmGain.gain.value = BGM_VOLUME;
    bgmGain.connect(ctx.destination);
    bgmGainRef.current = bgmGain;

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = VOICE_VOLUME;
    voiceGain.connect(ctx.destination);
    voiceGainRef.current = voiceGain;
  }, []);

  /** Resume the AudioContext (must be called from a user gesture). */
  const resume = useCallback(async () => {
    ensureContext();
    if (ctxRef.current?.state === "suspended") {
      await ctxRef.current.resume();
    }
  }, [ensureContext]);

  /**
   * Start playing background music from the given URL.
   * Creates an <audio> element, routes it through bgmGain via
   * createMediaElementSource (can only be called once per element).
   */
  const startBgm = useCallback(
    (url: string) => {
      ensureContext();
      const ctx = ctxRef.current!;
      const bgmGain = bgmGainRef.current!;

      // Stop any existing BGM first
      if (bgmAudioRef.current) {
        bgmAudioRef.current.pause();
        bgmAudioRef.current.src = "";
        bgmAudioRef.current = null;
        bgmSourceRef.current?.disconnect();
        bgmSourceRef.current = null;
      }

      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.loop = true;
      audio.src = url;
      bgmAudioRef.current = audio;

      // createMediaElementSource can only be called once per <audio> element
      const source = ctx.createMediaElementSource(audio);
      source.connect(bgmGain);
      bgmSourceRef.current = source;

      // Fade in from 0
      bgmGain.gain.setValueAtTime(0, ctx.currentTime);
      bgmGain.gain.linearRampToValueAtTime(BGM_VOLUME, ctx.currentTime + 1.0);

      audio.play().catch(() => {
        // Autoplay blocked — will play once user interacts (resume() should prevent this)
      });
    },
    [ensureContext],
  );

  /** Stop BGM playback and release the audio element. */
  const stopBgm = useCallback(() => {
    if (bgmAudioRef.current) {
      bgmAudioRef.current.pause();
      bgmAudioRef.current.src = "";
      bgmAudioRef.current = null;
    }
    if (bgmSourceRef.current) {
      bgmSourceRef.current.disconnect();
      bgmSourceRef.current = null;
    }
  }, []);

  /** Duck BGM volume down while voice guide is speaking. */
  const duckBgm = useCallback(() => {
    const ctx = ctxRef.current;
    const bgmGain = bgmGainRef.current;
    if (!ctx || !bgmGain) return;
    bgmGain.gain.linearRampToValueAtTime(
      BGM_DUCKED_VOLUME,
      ctx.currentTime + RAMP_DURATION,
    );
  }, []);

  /** Restore BGM volume after voice guide stops speaking. */
  const unduckBgm = useCallback(() => {
    const ctx = ctxRef.current;
    const bgmGain = bgmGainRef.current;
    if (!ctx || !bgmGain) return;
    bgmGain.gain.linearRampToValueAtTime(
      BGM_VOLUME,
      ctx.currentTime + RAMP_DURATION,
    );
  }, []);

  /** Tear down everything: stop BGM, close AudioContext. */
  const cleanup = useCallback(() => {
    stopBgm();
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    bgmGainRef.current = null;
    voiceGainRef.current = null;
  }, [stopBgm]);

  return {
    /** The shared AudioContext (null until resume() is called). */
    get audioContext() {
      return ctxRef.current;
    },
    /** BGM gain node. */
    get bgmGain() {
      return bgmGainRef.current;
    },
    /** Voice output gain node. */
    get voiceGain() {
      return voiceGainRef.current;
    },
    resume,
    startBgm,
    stopBgm,
    duckBgm,
    unduckBgm,
    cleanup,
  };
}
