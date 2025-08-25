// File Type Conversion (2e) — WAV Blob -> mono Float32 @ target SR, rms()
export async function wavBlobToMonoF32(blob, targetSr = 16000) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const ab = await blob.arrayBuffer();
  const audio = await ac.decodeAudioData(ab);
  const chs = audio.numberOfChannels, sr = audio.sampleRate, frames = audio.length;
  const mono = new Float32Array(frames);
  for (let c = 0; c < chs; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < frames; i++) mono[i] += d[i] / chs;
  }
  await ac.close();
  if (sr === targetSr) return { f32: mono, sr };
  const ratio = targetSr / sr, outLen = Math.max(1, Math.round(mono.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i / ratio; const xi = Math.floor(x); const t = x - xi;
    const a = mono[xi] || 0, b = mono[xi + 1] || 0; out[i] = a + (b - a) * t;
  }
  return { f32: out, sr: targetSr };
}
export function rms(arr) {
  let s = 0, n = arr.length|0; if (!n) return 0;
  for (let i = 0; i < n; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / n);
}
