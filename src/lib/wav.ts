const HEADER_SIZE = 44;

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

export function encodeWav(chunks: Int16Array[], sampleRate = 16000): Blob {
  let sampleCount = 0;
  for (const chunk of chunks) sampleCount += chunk.length;
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const parts: BlobPart[] = [buffer];
  for (const chunk of chunks) {
    parts.push(new Uint8Array(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.byteLength));
  }
  return new Blob(parts, { type: 'audio/wav' });
}

export function float32ToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function decodeWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12) throw new Error('WAV inválido');
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Formato WAV no reconocido');

  let offset = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bits = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.byteLength) {
    const id =
      String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(size, buffer.byteLength - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error('El WAV no contiene audio');
  if (bits !== 16) throw new Error('Solo se admite PCM de 16 bits');

  const frameCount = Math.floor(dataLength / (2 * channels));
  const pcm = new Int16Array(buffer, dataOffset, frameCount * channels);
  const samples = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += pcm[i * channels + c];
    samples[i] = sum / channels / 32768;
  }
  return { samples, sampleRate };
}

export function computePeaks(samples: Int16Array | Float32Array, buckets = 96): number[] {
  if (samples.length === 0) return new Array(buckets).fill(0.05);
  const size = Math.max(1, Math.floor(samples.length / buckets));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * size;
    const end = Math.min(samples.length, start + size);
    let peak = 0;
    for (let i = start; i < end; i += 1) {
      const value = typeof samples[i] === 'number' ? Math.abs(samples[i]) : 0;
      if (value > peak) peak = value;
    }
    peaks.push(Math.min(1, peak));
  }
  return peaks;
}
