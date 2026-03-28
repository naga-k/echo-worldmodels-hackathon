/**
 * AudioWorklet processor for microphone capture.
 * Converts Float32 samples (Web Audio API's native format) to Int16 PCM
 * (what Gemini Live API expects: 16-bit, 16kHz, little-endian).
 */
class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const float32 = input[0];
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      // Clamp to [-1, 1], then scale to Int16 range
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 32768 : s * 32767;
    }
    // Transfer ownership of the buffer to avoid a copy
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);
