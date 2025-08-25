// modules/chapters_map_ui.js
// Text-chapter UI + audio↔text mapping (offset). Works alongside your existing #chapterSel (audio).

import { state } from './app_state.js';
import { addLog } from './ui.js';

function el(id){ return document.getElementById(id); }

function ensureMount(){
  // Create the UI block once if missing; place it near #chapterSel
  if (el('textChapterSel')) return; // already present

  const audioSel = el('chapterSel');
  const host = audioSel?.parentElement || document.body;

  const wrap = document.createElement('div');
  wrap.id = 'textMapWrap';
  wrap.style.marginTop = '10px';
  wrap.innerHTML = `
    <div class="lbl">Text chapters (.epub)</div>
    <select id="textChapterSel" size="6" style="width:100%"></select>
    <small id="textChMeta" style="display:block;margin-top:4px;opacity:.8">(no text chapters)</small>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
      <label class="lbl">Start at audio:</label>
      <input id="mapAudioIdx" type="number" min="0" step="1" value="0" style="width:80px">
      <label class="lbl">maps to text:</label>
      <input id="mapTextIdx" type="number" min="0" step="1" value="0" style="width:80px">
      <button id="applyMap">Apply</button>
    </div>
    <small id="mapInfo" style="display:block;margin-top:4px;opacity:.8">Offset = textStart - audioStart = 0</small>
  `;
  host.appendChild(wrap);

  // Wire listeners
  el('textChapterSel').addEventListener('change', ()=>{
    el('mapTextIdx').value = String(el('textChapterSel').selectedIndex >= 0 ? el('textChapterSel').selectedIndex : 0);
    updateMapInfo();
  });
  el('applyMap').addEventListener('click', updateMapInfo);
}

export function mountAlignUI(){
  ensureMount();
  if (typeof state.MAP_OFFSET !== 'number') state.MAP_OFFSET = 0;
  if (!Array.isArray(state.TEXT_CH)) state.TEXT_CH = [];
  updateMapInfo();
}

export function populateTextChapterUI(){
  ensureMount();
  const sel = el('textChapterSel');
  const meta = el('textChMeta');
  sel.innerHTML = '';
  const list = Array.isArray(state.TEXT_CH) ? state.TEXT_CH : [];
  if(!list.length){ meta.textContent='(no text chapters)'; return; }
  list.forEach((c,i)=>{
    const o=document.createElement('option');
    o.value=String(i); o.textContent=`${String(i+1).padStart(3,'0')}  ${c.title}`;
    sel.appendChild(o);
  });
  meta.textContent = `${list.length} text chapters`;
  if (sel.selectedIndex === -1) sel.selectedIndex = 0;
  el('mapTextIdx').value = String(sel.selectedIndex);
  updateMapInfo();
}

export function updateMapInfo(){
  ensureMount();
  const a = Math.max(0, (+el('mapAudioIdx').value|0));
  const t = Math.max(0, (+el('mapTextIdx').value|0));
  state.MAP_OFFSET = t - a;
  const info = `Offset = textStart - audioStart = ${state.MAP_OFFSET}`;
  el('mapInfo').textContent = info;
  try { addLog('info', 'Mapping set', { audioStart:a, textStart:t, offset:state.MAP_OFFSET }); } catch {}
}

export function getMappedRefText(audioIdx, fallbackText=''){
  // Prefer EPUB chapter with applied offset; else fallback to plain REF_TEXT
  const list = Array.isArray(state.TEXT_CH) ? state.TEXT_CH : [];
  const tIdx = (audioIdx|0) + (state.MAP_OFFSET|0);
  const hit = (tIdx>=0 && tIdx<list.length) ? (list[tIdx]?.text || '') : '';
  return hit && hit.trim() ? hit : String(fallbackText||'');
}
