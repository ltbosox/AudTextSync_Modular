// modules/chapters_ui.js
// UI helpers for the chapter <select> list: active row + file-existence colors.

import { getWorkspace } from './workspace.js';
import { state } from './app_state.js';
import { addLog } from './ui.js';

const COLOR_WAV = '#6fc3ff';   // light blue
const COLOR_TXT = '#27ae60';   // green

function parseIdxFromName(name, ext) {
  // Matches: 001 - anything.wav / .txt / .words.csv
  const m = name.match(/^(\d{3})\s*-\s*.*\.(?:wav|txt|words\.csv)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  return n - 1; // zero-based
}

/** Highlight the currently loaded chapter in the <select> (bidirectional sync). */
export function setActiveChapterVisual(idx) {
  const sel = document.getElementById('chapterSel');
  if (!sel) return;
  const target = Math.max(0, Math.min(idx|0, sel.options.length-1));
  if (sel.selectedIndex !== target) sel.selectedIndex = target;
}

/** Scan chapters/ and transcripts/ once and color code each option. */
export async function refreshChapterStatuses() {
  try {
    const ws = getWorkspace();
    const sel = document.getElementById('chapterSel');
    if (!ws || !sel || sel.options.length === 0) return;

    // Build sets of indices that have WAV / Transcript
    const wavSet = new Set();
    const txtSet = new Set();

    if (ws.chapters) {
      for await (const [name] of ws.chapters.entries()) {
        if (!/\.wav$/i.test(name)) continue;
        const idx = parseIdxFromName(name, 'wav');
        if (idx != null) wavSet.add(idx);
      }
    }
    if (ws.trans) {
      for await (const [name] of ws.trans.entries()) {
        if (!/\.(?:txt|words\.csv)$/i.test(name)) continue;
        const idx = parseIdxFromName(name, 'txtcsv');
        if (idx != null) txtSet.add(idx);
      }
    }

    // Apply colors to each <option>
    for (let i = 0; i < sel.options.length; i++) {
      const opt = sel.options[i];
      // transcript takes precedence over wav
      if (txtSet.has(i)) {
        opt.style.color = COLOR_TXT;        // green
      } else if (wavSet.has(i)) {
        opt.style.color = COLOR_WAV;        // light blue
      } else {
        opt.style.color = '';               // default (white via your CSS)
      }
    }
  } catch (err) {
    addLog('warn', 'refreshChapterStatuses failed', { err: String(err) });
  }
}
