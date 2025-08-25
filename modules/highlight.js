// Transcription Text Highlighting (2i)
import { el } from './ui.js';

export function renderWords(words){
  const t = el('transcript');
  const tb = el('wordTable').querySelector('tbody');
  t.textContent = words && words.length ? words.map(w=>w.word).join(' ') : '(no transcript yet)';
  tb.innerHTML = (words||[]).map(w=>`<tr><td>${w.word}</td><td>${w.start.toFixed(2)}</td><td>${w.end.toFixed(2)}</td><td>${(w.conf??1).toFixed(2)}</td></tr>`).join('');
}

// Optional: compute index of current word for a time (not auto-bound to UI to avoid behavior change)
export function findWordIndexAtTime(words, tSec){
  if(!words || !words.length) return -1;
  let lo = 0, hi = words.length - 1, ans = -1;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    if (tSec >= words[mid].start && tSec <= (words[mid].end || words[mid].start)){
      ans = mid; break;
    }
    if (tSec < words[mid].start) hi = mid - 1; else lo = mid + 1;
  }
  return ans;
}
