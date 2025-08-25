// modules/render_exact.js
import { addLog } from './ui.js';

function fmt(t){
  if(!isFinite(t))return'';
  const s=t|0, ms=Math.round((t-(t|0))*1e3).toString().padStart(3,'0');
  const m=(s/60|0).toString().padStart(2,'0'), ss=(s%60).toString().padStart(2,'0');
  return `${m}:${ss}.${ms}`;
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;"," >":"&gt;","\"":"&quot;"}[c]))}

export function renderExactDisplays(words){
  const textCont = document.getElementById('transcript');
  const tb = document.querySelector('#wordTable tbody');
  if (textCont){ textCont.innerHTML=''; }
  if (tb){ tb.innerHTML=''; }

  if (!words || !words.length){
    if (textCont) textCont.textContent='(empty)';
    addLog('info','Rendered',{words:0});
    return;
  }

  // Transcript tokens (desktop)
  if (textCont){
    const frag=document.createDocumentFragment();
    words.forEach((w,i)=>{ if(i) frag.append(' ');
      const sp=document.createElement('span');
      sp.className='token';
      sp.dataset.idx=String(i);
      sp.textContent=w.word;
      sp.title=`${fmt(w.start)} → ${fmt(w.end)} (conf ${(w.conf??0).toFixed(2)}) — click to play`;
      frag.append(sp);
    });
    textCont.append(frag);
  }

  // Word table (desktop)
  if (tb){
    const rows=document.createDocumentFragment();
    words.forEach((w,i)=>{
      const tr=document.createElement('tr');
      tr.dataset.idx=String(i);
      tr.innerHTML =
        `<td class="play"><button class="playbtn" data-idx="${i}" title="Play word">▶</button></td>`+
        `<td>${i+1}</td>`+
        `<td>${escapeHtml(w.word)}</td>`+
        `<td class="mobile-hide">${fmt(w.start)}</td>`+
        `<td class="mobile-hide">${fmt(w.end)}</td>`+
        `<td class="mobile-hide">${(w.conf??0).toFixed(2)}</td>`;
      rows.append(tr);
    });
    tb.append(rows);
  }

  addLog('info','Rendered',{words:words.length});
}
