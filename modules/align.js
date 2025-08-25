// modules/align.js
// Purpose: wrap align & correct and refresh render + highlight in-place.

import { alignAndCorrect } from './alignment_exact.js';
import { state } from './app_state.js';
import { renderExactDisplays } from './render_exact.js';
import { addLog, setStatus, setProg } from './ui.js';
import { bindTokensAfterRender } from './highlight_runtime.js';

export async function alignAndCorrectCurrent() {
  // PRECONDITIONS
  if (!state.LAST_WORDS || !state.LAST_WORDS.length) {
    alert('Transcribe first.');
    return;
  }
  const refText = state.REF_TEXT || '';
  if (!refText.trim()) {
    alert('Load a TXT or EPUB to align against.');
    return;
  }

  try {
    setStatus('Aligning & correcting…');
    setProg && setProg(12);

    // Do not modify the algorithm/values — pass through as-is
    const corrected = alignAndCorrect(state.LAST_WORDS, refText);

    addLog('info', 'Alignment complete', {
      orig: state.LAST_WORDS.length,
      corrected: corrected.length
    });

    // Update state
    state.LAST_WORDS = corrected;
    state.PLAY_WORDS = corrected; // renderExact handles normalization internally, keep behavior

    // Re-render with the existing renderer
    renderExactDisplays(state.PLAY_WORDS);

    // Rebind highlight to the just-rendered tokens and words
    bindTokensAfterRender(state.PLAY_WORDS);

    setProg && setProg(100);
    setStatus('Done — alignment applied');
  } catch (e) {
    addLog('error', 'Align failed', String(e));
    alert('Align failed — see log.');
  }
}
