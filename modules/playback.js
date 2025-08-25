// modules/playback.js (PATCHED SECTION ONLY)
import { alignAndCorrect } from './align_correct.js';
import { getMappedRefText } from './chapters_map_ui.js';
import { addLog, setStatus } from './ui.js';
import { sliceChapterToWav } from './slicer.js';
import { transcribeWavBlobExact } from './transcription_exact.js';
import { renderExactDisplays } from './render_exact.js';
import { bindTokensAfterRender } from './highlight_runtime.js';
import { saveTranscriptFiles, saveTranscriptFilesAC, loadTranscriptIfExists, wordsToText } from './saving.js';
import { state } from './app_state.js';
import { loadExistingTranscript } from './transcript_cache.js';
import { refreshChapterStatuses, setActiveChapterVisual } from './chapters_ui.js';

function ensureStateArrays(){
  if (!Array.isArray(state.WORDS)) state.WORDS = [];
  if (!Array.isArray(state.PLAIN_TEXT)) state.PLAIN_TEXT = [];
}

export async function transcribeRenderThenSave(idx){
  // Concurrency guard: one run per chapter at a time
  const runs = (window.__transcribeRunsMap ||= new Map());
  if (runs.has(idx)) return runs.get(idx);

  const job = (async () => {
    ensureStateArrays();

    const ch = state.AUDIO_CH?.[idx];
    if (!ch){ addLog('error','No chapter at index',{idx}); return; }
    const chapterTitle = ch.title || `Chapter ${idx+1}`;

    // Slice to WAV first (turn chapter line light-blue)
    const wavBlob = await sliceChapterToWav(state, idx);
    try { await refreshChapterStatuses(); } catch {}

    // Transcribe — returns only after the quiet drain completes
    const { words, plain } = await transcribeWavBlobExact({
      idx,
      wavBlob,
      chapterStartSec: +ch.start || 0,
      chapterTitle,
      refText: state.REF_TEXT || ''
    });

    // Keep in memory
    state.WORDS[idx] = Array.isArray(words) ? words : [];
    state.PLAIN_TEXT[idx] = typeof plain === 'string' ? plain : wordsToText(state.WORDS[idx]);

    // Render
    state.LAST_WORDS = state.WORDS[idx];
    state.PLAY_WORDS = state.WORDS[idx];
    renderExactDisplays(state.WORDS[idx]);
    try { bindTokensAfterRender(state.WORDS[idx]); } catch {}

    // Save only if we actually have something
    if (state.WORDS[idx].length || (state.PLAIN_TEXT[idx] && state.PLAIN_TEXT[idx].trim().length)){
      await saveTranscriptFiles(idx, chapterTitle, state.WORDS[idx], state.PLAIN_TEXT[idx]);
      addLog('info','Saved transcript files',{ idx, words:state.WORDS[idx].length, chars: state.PLAIN_TEXT[idx].length });
      try { await refreshChapterStatuses(); } catch {}
    } else {
      addLog('warn','Skipping save: empty transcript',{idx});
    }

    setStatus(`<span class="accent">Done</span> ${state.WORDS[idx].length} words — ${chapterTitle}`);
  })().finally(()=>runs.delete(idx));

  runs.set(idx, job);
  return job;
}

/**
 * Set player to chapter and ensure transcript is prepared (render before save).
 */
export async function setPlayerToChapter(stateObj, player, idx, autoPlay = false) {
  if (!stateObj || !player) return;
  if (!Array.isArray(stateObj.AUDIO_CH) || idx < 0 || idx >= stateObj.AUDIO_CH.length) return;

  ensureStateArrays();
  stateObj.CURRENT_IDX = idx;

  // Sync chapter list highlight
  try { setActiveChapterVisual(idx); } catch {}

  // Was the player already playing? (used to decide auto-play)
  const wasPlaying = (!player.paused && !player.ended && isFinite(player.duration));

  // Prepare audio for this chapter
  const wavBlob = await sliceChapterToWav(stateObj, idx);
  const url = URL.createObjectURL(wavBlob);
  player.src = url;
  player.currentTime = 0;

  // Only auto-play if it was already playing when the user clicked
  if (wasPlaying) {
    try { await player.play(); } catch {}
  }

  await maybeLoadExistingOrTranscribe(stateObj, idx);
}

/**
 * Prepare next chapter and start playback (transcribe → render → save).
 */
export async function ensureNextReadyThenPlay(stateObj, player, idx, autoPlay = false) {
  if (!stateObj || !player) return;
  if (idx < 0 || idx >= stateObj.AUDIO_CH.length) return;

  ensureStateArrays();
  stateObj.CURRENT_IDX = idx;

  // Keep list selection in sync
  try { setActiveChapterVisual(idx); } catch {}

  // Remember whether we were already playing
  const wasPlaying = (!player.paused && !player.ended && isFinite(player.duration));

  // Swap audio source to the new chapter
  const wavBlob = await sliceChapterToWav(stateObj, idx);
  const url = URL.createObjectURL(wavBlob);
  player.src = url;
  player.currentTime = 0;

  // Default behavior: if we were playing, keep playing; otherwise stay paused
  if (wasPlaying) {
    try { await player.play(); } catch {}
  }

  await maybeLoadExistingOrTranscribe(stateObj, idx);
}

/**
 * Kick off first chapter (render before save).
 */
export async function maybeLoadExistingOrTranscribeFirst(stateObj, player){
  const idx = stateObj?.CURRENT_IDX | 0;
  try { setActiveChapterVisual(idx); } catch {}
  await maybeLoadExistingOrTranscribe(stateObj, idx);
}

export async function alignCurrentChapter(stateObj){
  const idx = stateObj?.CURRENT_IDX | 0;
  const words = Array.isArray(stateObj?.WORDS?.[idx]) ? stateObj.WORDS[idx] : [];
  if (!words.length) {
    alert('Transcribe this chapter first.');
    return;
  }

  const refText = (getMappedRefText ? getMappedRefText(idx, stateObj.REF_TEXT || '') : (stateObj.REF_TEXT || '')) || '';
  if (!refText.trim()) {
    alert('Load a TXT or EPUB chapter to align against.');
    return;
  }

  const ch = stateObj.AUDIO_CH?.[idx];
  const chapterTitle = ch?.title || `Chapter ${idx+1}`;

  setStatus('Aligning & correcting (current chapter)…');

  const corrected = alignAndCorrect(words, refText);

  // Normalize simple timing shape
  const normalized = corrected.map(w=>({
    word: String(w.word||''),
    start: +w.start,
    end:   Math.max(+w.start, +w.end),
    conf:  +(w.conf ?? 1)
  }));

  // In-memory & re-render
  stateObj.WORDS[idx] = normalized;
  stateObj.PLAIN_TEXT = stateObj.PLAIN_TEXT || [];
  stateObj.PLAIN_TEXT[idx] = wordsToText(normalized);

  renderExactDisplays(stateObj.WORDS[idx]);
  try { bindTokensAfterRender(stateObj.WORDS[idx]); } catch {}

  // Save AC variants (do not overwrite originals)
  await saveTranscriptFilesAC(idx, chapterTitle, normalized, stateObj.PLAIN_TEXT[idx]);
  try { await refreshChapterStatuses(); } catch {}

  setStatus(`<span class="accent">Aligned</span> ${normalized.length} words — ${chapterTitle}`);
  addLog('info','Alignment complete + AC saved',{ idx, words: normalized.length });
}

export async function maybeLoadExistingOrTranscribe(stateObj, idx){
  const ch    = stateObj?.AUDIO_CH?.[idx];
  const title = ch?.title || `Chapter ${idx+1}`;

  // Helper to render & finish
  const finishWith = async (wordsArr, reason) => {
    stateObj.WORDS      = stateObj.WORDS || [];
    stateObj.PLAIN_TEXT = stateObj.PLAIN_TEXT || [];

    stateObj.WORDS[idx] = wordsArr || [];
    stateObj.PLAIN_TEXT[idx] = wordsToText(stateObj.WORDS[idx]);

    renderExactDisplays(stateObj.WORDS[idx]);
    try { bindTokensAfterRender(stateObj.WORDS[idx]); } catch {}
    setStatus(`<span class="accent">Loaded</span> cached transcript — ${title}`);
    try { await refreshChapterStatuses(); } catch {}
    addLog('info', `Using cached transcript (${reason})`, { idx, words: stateObj.WORDS[idx].length, title });
  };

  try {
    // 1) Prefer AC files
    let words = await loadTranscriptIfExists(idx, `${title} AC`);

    // 2) Fallback to non-AC
    if (!words) {
      words = await loadTranscriptIfExists(idx, title);
    }

    // 3) Loose scan of transcripts/ (handles older non-standard names). Does not strictly prefer AC,
    //    but will still pick it up if present.
    if (!words) {
      try {
        const hit = await loadExistingTranscript(idx, title);
        if (hit && Array.isArray(hit.words) && hit.words.length) {
          words = hit.words;
        }
      } catch {}
    }

    if (words && words.length){
      return await finishWith(words, 'AC preferred');
    }
  } catch (e) {
    addLog('warn','Transcript load check failed; will transcribe', String(e));
  }

  // If reach here, nothing cached — transcribe then save
  await transcribeRenderThenSave(idx);
}
