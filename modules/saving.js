// modules/saving.js
// File Saving helpers for transcripts

import { addLog } from './ui.js';
import { pad3, safeFileStem } from './leftover.js';
import { writeFile, readTextIfExists, getWorkspace } from './workspace.js';

export function wordsToText(words){
  return (Array.isArray(words) ? words.map(w=>w.word).join(' ') : '')
    .replace(/\s+/g,' ')
    .trim();
}

export function wordsToCSV(words){
  const rows = [['word','start','end','conf']].concat(
    (Array.isArray(words) ? words : []).map(w=>[
      String(w.word ?? ''),
      Number(w.start ?? 0).toFixed(3),
      Number(w.end   ?? 0).toFixed(3),
      Number(w.conf  ?? 1).toFixed(3)
    ])
  );
  return rows.map(r=>r.join(',')).join('\n');
}

function buildStem(idx, chapterTitle, suffix=''){
  const base = `${pad3(idx+1)} - ${safeFileStem(chapterTitle)}`;
  return suffix ? `${base}${suffix}` : base; // e.g. "001 - Title AC"
}

/**
 * Internal save helper.
 * - Writes .txt and .words.csv to workspace /transcripts (or offers downloads if no workspace).
 * - Guard: will not write files if there are zero words AND no plain text (prevents early/incomplete saves).
 */
async function saveVariant(idx, chapterTitle, words, plainFallback, suffix=''){
  const haveWords = Array.isArray(words) && words.length > 0;
  const plain = (haveWords ? wordsToText(words) : String(plainFallback || '')).trim();

  // Safety guard: don't create files if nothing meaningful to save.
  if (!haveWords && !plain){
    addLog('warn','Skipping save — no words and no plain text', { idx, chapterTitle, suffix });
    return;
  }

  const stem = buildStem(idx, chapterTitle, suffix);
  const text = haveWords ? wordsToText(words) : plain; // prefer words→text; else use provided plain
  const csv  = haveWords ? wordsToCSV(words) : wordsToCSV([]); // if only plain exists, an empty CSV is OK

  const ws = getWorkspace();
  if (ws.trans){
    try{
      await writeFile(ws.trans, stem + '.txt',       (text + '\n'));
      await writeFile(ws.trans, stem + '.words.csv', (csv  + '\n'));
      addLog('info','Saved transcript files', { stem, words: (words?.length || 0), chars: text.length });
    }catch(e){
      addLog('warn','Saving transcript files failed', String(e));
    }
  }else{
    // Fallback to downloads if no workspace selected
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text+'\n'], { type:'text/plain' }));
    a.download = stem + '.txt';
    a.click();

    const b = document.createElement('a');
    b.href = URL.createObjectURL(new Blob([csv+'\n'], { type:'text/csv' }));
    b.download = stem + '.words.csv';
    b.click();

    setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); URL.revokeObjectURL(b.href); }catch{} }, 30000);
    addLog('info','Offered transcript files for download (no workspace)', { stem });
  }
}

/* ---------- Public API ---------- */

// Original saver (non-AC). Keeps your method/filenames.
export async function saveTranscriptFiles(idx, chapterTitle, words, plainFallback){
  return saveVariant(idx, chapterTitle, words, plainFallback, '');
}

// Aligned & Corrected saver — appends " AC" to stem (no overwrite of originals).
export async function saveTranscriptFilesAC(idx, chapterTitle, words, plainFallback){
  return saveVariant(idx, chapterTitle, words, plainFallback, ' AC');
}

/**
 * Load words for a chapter if a CSV exists.
 * Priority:
 *   1) "<stem> AC.words.csv"
 *   2) "<stem>.words.csv"
 * Returns `Array<{word,start,end,conf}>` or `null`.
 */
export async function loadTranscriptIfExists(idx, chapterTitle){
  const ws = getWorkspace();
  if(!ws?.trans) return null;

  const stemBase = buildStem(idx, chapterTitle, '');
  const stemAC   = buildStem(idx, chapterTitle, ' AC');

  // Try AC first
  let csv = await readTextIfExists(ws.trans, stemAC + '.words.csv');

  // Fallback to non-AC
  if (!csv) csv = await readTextIfExists(ws.trans, stemBase + '.words.csv');
  if (!csv) return null;

  // Parse CSV (expects header word,start,end,conf)
  const lines = String(csv).trim().split(/\r?\n/);
  if (!lines.length) return null;

  // Skip header if present
  const body = (lines[0].toLowerCase().includes('word,start,end') ? lines.slice(1) : lines);

  const words = body.map(line=>{
    const cols = line.split(',');
    if (cols.length < 3) return null;
    const w = String(cols[0] ?? '').trim();
    const s = Number(cols[1]);
    const e = Number(cols[2]);
    const c = Number(cols[3] ?? 1);
    if (!w || !Number.isFinite(s) || !Number.isFinite(e)) return null;
    return { word: w, start: s, end: e, conf: Number.isFinite(c) ? c : 1 };
  }).filter(Boolean);

  return words.length ? words : null;
}
