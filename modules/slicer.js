// Chapter Splitting / Slicing (2d)
import { m4bSliceToWavUsingFFmpeg } from './ffmpeg_loader.js';
import { addLog, setStatus } from './ui.js';
import { pad3, safeFileStem } from './leftover.js';
import { getWorkspace, readBlobIfExists, writeFile } from './workspace.js';

export async function sliceChapterToWav(state, idx){
  const ch = state.AUDIO_CH[idx];
  if(!ch) throw new Error('Invalid chapter');
  if(state.SLICED_WAVS.has(idx)) return state.SLICED_WAVS.get(idx).blob;

  const wavNameOnDisk = `${pad3(idx+1)} - ${safeFileStem(ch.title)}.wav`;

  const ws = getWorkspace();
  if (ws.chapters) {
    try {
      const existing = await readBlobIfExists(ws.chapters, wavNameOnDisk);
      if (existing && existing.size > 0) {
        addLog('info','Chapter WAV exists — skipping slice',{ idx, name:wavNameOnDisk });
        const entry = { blob: existing, name: wavNameOnDisk };
        state.SLICED_WAVS.set(idx, entry);
        return existing;
      }
    } catch {}
  }

  setStatus(`Slicing WAV — ${ch.title}`);
  const wavBlob = await m4bSliceToWavUsingFFmpeg(state.AUDIO_FILE, ch.start, ch.end);
  const entry = { blob: wavBlob, name: wavNameOnDisk };
  state.SLICED_WAVS.set(idx, entry);

  if (ws.chapters) {
    try { await writeFile(ws.chapters, entry.name, wavBlob);
      addLog('info','Saved chapter WAV', { idx, name: entry.name });
    } catch(e) { addLog('warn','Save WAV failed', String(e)); }
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(wavBlob); a.download = entry.name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 30000);
  }
  return wavBlob;
}
