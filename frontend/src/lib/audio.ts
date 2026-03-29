/**
 * Audio utilities for Gemini Live integration.
 *
 * Gemini Live API audio specs:
 *   Input:  16-bit PCM, 16kHz, mono, little-endian
 *   Output: 16-bit PCM, 24kHz, mono, little-endian
 *
 * Web Audio API works in Float32, so we convert at both ends.
 */

/**
 * Convert raw 16-bit PCM (Int16, little-endian) to Float32Array for Web Audio playback.
 * Each Int16 sample divides by 32768 to normalize to [-1.0, 1.0].
 */
export function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

/**
 * PCM player that schedules back-to-back AudioBufferSourceNodes for gapless playback.
 *
 * Accepts an external AudioContext and GainNode so audio can be routed through
 * a shared mixer (e.g. useAudioMixer's voiceGain) instead of straight to destination.
 */
export function createPCMPlayer(sampleRate: number, ctx: AudioContext, gainNode: GainNode) {
  // nextPlayTime tracks when the last scheduled buffer ends, so we chain them.
  let nextPlayTime = 0;

  function play(float32: Float32Array) {
    if (float32.length === 0) return;
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);
    const now = ctx.currentTime;
    // Start immediately if we've fallen behind, otherwise chain after last buffer
    const startAt = Math.max(now, nextPlayTime);
    source.start(startAt);
    nextPlayTime = startAt + buffer.duration;
  }

  function close() {
    // Don't close the shared AudioContext — the mixer owns it
  }

  return { play, close };
}

/**
 * Start microphone capture using an AudioWorklet (mic-processor.js).
 * Calls onChunk with each batch of raw Int16 PCM bytes.
 * Returns a cleanup function that stops the stream.
 */
export async function createMicrophoneStream(
  onChunk: (pcm: ArrayBuffer) => void
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  // AudioContext must match the target sample rate — browser will resample if needed.
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule("/mic-processor.js");

  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, "mic-processor");

  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    onChunk(e.data);
  };

  source.connect(worklet);

  return () => {
    worklet.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  };
}
