export async function splitAudioAtCutPoints(audioData: ArrayBuffer, cutTimes: number[]): Promise<Blob[]> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffer = await ctx.decodeAudioData(audioData.slice(0));
  return splitMergedBuffer(buffer, cutTimes);
}

export async function splitChunkedAudioAtCutPoints(chunksBase64: string[], cutTimes: number[]): Promise<Blob[]> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffers: AudioBuffer[] = [];
  for (const b64 of chunksBase64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const buf = await ctx.decodeAudioData(bytes.buffer);
    buffers.push(buf);
  }

  // Merge into single buffer
  const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
  const sampleRate = buffers[0].sampleRate;
  const channels = buffers[0].numberOfChannels;
  const merged = ctx.createBuffer(channels, totalLength, sampleRate);

  let offset = 0;
  for (const buf of buffers) {
    for (let ch = 0; ch < channels; ch++) {
      merged.getChannelData(ch).set(buf.getChannelData(ch), offset);
    }
    offset += buf.length;
  }

  return splitMergedBuffer(merged, cutTimes);
}

export function splitMergedBuffer(buffer: AudioBuffer, cutTimes: number[]): Blob[] {
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const blobs: Blob[] = [];
  const allTimes = [0, ...cutTimes, buffer.duration];

  for (let i = 0; i < allTimes.length - 1; i++) {
    const startSample = Math.floor(allTimes[i] * sampleRate);
    const endSample = Math.min(Math.floor(allTimes[i + 1] * sampleRate), buffer.length);
    const length = Math.max(endSample - startSample, 1);

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const slice = ctx.createBuffer(channels, length, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const source = buffer.getChannelData(ch);
      const target = slice.getChannelData(ch);
      for (let j = 0; j < length; j++) {
        target[j] = source[startSample + j] || 0;
      }
    }
    blobs.push(audioBufferToWav(slice));
  }
  return blobs;
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function createSilentWav(sampleRate = 44100, channels = 1): Blob {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffer = ctx.createBuffer(channels, sampleRate, sampleRate); // 1 second
  return audioBufferToWav(buffer);
}
