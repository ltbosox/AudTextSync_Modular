// modules/transcript_cache.js
// Load existing transcript files for a chapter using the SAME scheme as saving.js:
//
//   stem = `${pad3(idx+1)} - ${safeFileStem(chapterTitle)}`
//
// Files we look for in the workspace's transcripts folder:
//   - `${stem}.words.csv`  (per-word timings; written by saving.js)
//   - `${stem}.txt`        (plain text; written by saving.js)
//
// If .words.csv exists and contains at least 1 word, we treat it as a cache hit.
// If .txt exists, we use it for the plain text pane; otherwise we synthesize from words.

import { addLog } from './ui.js';
import { getWorkspace, readTextIfExists } from './workspace.js';
import { pad3, safeFileStem } from './leftover.js';
import { loadTranscriptIfExists } from './saving.js';

// Build the exact stem used by saving.js so filenames match 1:1
function buildStem(idx, chapterTitle){
  return `${pad3(idx+1)} - ${safeFileStem(chapterTitle || `Chapter ${idx+1}`)}`;
}

/**
 * Returns { words, plain } if a usable cached transcript exists for this chapter; otherwise null.
 */
export async function loadExistingTranscript(idx, chTitle) {
  const dir = await getTranscriptsDir();
  const parts = candidateNameParts(idx, chTitle);

  let wordsAC = null, plainAC = null;
  let wordsBase = null, plainBase = null;

  function isACName(nLower){
    // Match “… AC.txt”, “… AC.json”, “… AC.words.csv” (allow space/_/- before AC)
    return /(?:[\s_-]|^)(ac)(?:\.words\.csv|\.csv|\.json|\.txt)$/i.test(nLower);
  }

  try {
    for await (const [name, handle] of dir.entries()) {
      const nLower = name.toLowerCase();

      // Only consider files that contain one of the candidate parts
      const matches = [...parts].some(p => nLower.includes(p));
      if (!matches) continue;

      const ac = isACName(nLower);

      // TXT
      if (nLower.endsWith('.txt')) {
        try {
          const txt = await readFileText(handle);
          if (txt && /\w/.test(txt)) {
            if (ac) plainAC = txt; else plainBase = txt;
          }
        } catch {}
      }

      // JSON (array of words)
      else if (nLower.endsWith('.json')) {
        try {
          const txt = await readFileText(handle);
          const data = JSON.parse(txt);
          if (Array.isArray(data) && data.length && typeof data[0] === 'object') {
            const parsed = data.map(row => ({
              word: String(row.word ?? row.token ?? row.text ?? '').trim(),
              start: Number(row.start ?? row.ts ?? row.begin ?? 0),
              end: Number(row.end ?? row.te ?? row.finish ?? row.stop ?? 0),
              conf: Number(row.conf ?? row.confidence ?? row.p ?? row.score ?? NaN)
            })).filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
            if (parsed.length) { if (ac) wordsAC = parsed; else wordsBase = parsed; }
          }
        } catch {}
      }

      // CSV = words
      else if (nLower.endsWith('.csv')) {
        try {
          const csv = await readFileText(handle);
          const parsed = parseCSVWords(csv);
          if (parsed.length) { if (ac) wordsAC = parsed; else wordsBase = parsed; }
        } catch {}
      }
    }

    // Prefer AC if present
    let words = wordsAC || wordsBase || null;
    let plain = (plainAC || plainBase || '');

    if (!plain && Array.isArray(words) && words.length) {
      plain = wordsToPlain(words);
    }

    if (Array.isArray(words) && words.length) {
      addLog('info', words === wordsAC ? 'Loaded cached transcript (AC)' : 'Loaded cached transcript', { idx, words: words.length, hasPlain: !!plain });
      return { words, plain: plain || '' };
    }

    if (plain && /\w/.test(plain)) {
      const rough = plain.split(/\s+/).filter(Boolean).map((w,i)=>({ word:w, start:i, end:i+0.01, conf:NaN }));
      addLog('warn', 'Cached plain text only (no timings); highlights will be approximate', { idx });
      return { words: rough, plain };
    }

    return null;
  } catch (err) {
    addLog('error', 'Cache scan failed', { err: String(err) });
    return null;
  }
}

async function getTranscriptsDir() {
  // Use the directory created by ensureSubdirs(file.name)
  try {
    const ws = typeof getWorkspace === 'function' ? getWorkspace() : null;
    if (ws && ws.trans) {
      if (!state.DIRS) state.DIRS = {};
      state.DIRS.transcripts = ws.trans; // remember for later
      return ws.trans;
    }
  } catch {}

  // Legacy fallback (rare): try a top-level "transcripts" at the picked root
  const root = getLikelyWorkspaceRoot();
  if (!root) {
    throw new Error('Workspace transcripts dir not ready. Pick a workspace and open an audio file first.');
  }
  await ensurePerm(root);
  const dir = await root.getDirectoryHandle('transcripts', { create: true });
  if (!state.DIRS) state.DIRS = {};
  state.DIRS.transcripts = dir;
  return dir;
}
