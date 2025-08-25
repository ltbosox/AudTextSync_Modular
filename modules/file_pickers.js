// File Pickers (2b) and File Loading triggers (2c)
import { chooseWorkspace, ensureSubdirs } from './workspace.js';
import { addLog, setStatus, setProg } from './ui.js';
import { parseM4BChapters } from './mp4_chapters.js';
import { state } from './app_state.js';
import { renderWords } from './highlight.js';
import { maybeLoadExistingOrTranscribeFirst, ensureNextReadyThenPlay, setPlayerToChapter } from './playback.js';
import { sliceChapterToWav } from './slicer.js';
import { refreshChapterStatuses, setActiveChapterVisual } from './chapters_ui.js';
import { parseEpubChapters } from './epub_chapters.js';
import { mountAlignUI, populateTextChapterUI, updateMapInfo, getMappedRefText } from './chapters_map_ui.js';
import { alignCurrentChapter } from './playback.js';

export function initPickers(player){
  mountAlignUI();
  document.getElementById('pickDir').addEventListener('click', chooseWorkspace);

  document.getElementById('m4b').addEventListener('change', async ()=>{
    const f = document.getElementById('m4b').files?.[0] || null;
    if(!f) return;
    state.REF_TEXT='';
    document.getElementById('ref').value='';
    state.SLICED_WAVS = new Map();
    state.CHAPTER_CACHE = new Map();
    document.getElementById('transcript').textContent = '(no transcript yet)';
    document.querySelector('#wordTable tbody').innerHTML='';
    await startPipeline(player, f);
  });

  document.getElementById('ref').addEventListener('change', async ()=>{
    const f = document.getElementById('ref').files?.[0] || null;
    if(!f){ state.REF_TEXT=''; document.getElementById('alignBtn').disabled = true; return; }
    const name = f.name.toLowerCase();
    if(name.endsWith('.txt')){
      state.REF_TEXT = await f.text();
      addLog('info','Reference text loaded',{ chars: state.REF_TEXT.length });
      document.getElementById('alignBtn').disabled = false;
    } else if (name.endsWith('.epub')) {
	  try {
		state.REF_TEXT = '';
		state.TEXT_CH = await parseEpubChapters(f);
		populateTextChapterUI();
		updateMapInfo();
		addLog('info','EPUB chapters parsed',{ count: state.TEXT_CH.length });
		document.getElementById('alignBtn').disabled = (state.TEXT_CH.length === 0);
	  } catch (e) {
		state.TEXT_CH = [];
		populateTextChapterUI();
		document.getElementById('alignBtn').disabled = true;
		addLog('error','EPUB parse failed', String(e));
	  }
	}
  });

  document.getElementById('chapterSel').addEventListener('change', async ()=>{
    const idx = Math.max(0, +document.getElementById('chapterSel').value|0);
    await setPlayerToChapter(state, player, idx, false);
  });
  document.getElementById('prevBtn').addEventListener('click', async ()=>{
    // Only autoplay if we were playing when the button was clicked
    const wasPlaying = !player.paused && !player.ended;
    const idx = Math.max(0, state.CURRENT_IDX - 1);
    await setPlayerToChapter(state, player, idx, wasPlaying);
  });
  document.getElementById('nextBtn').addEventListener('click', async ()=>{
    // Only autoplay if we were playing when the button was clicked
    const wasPlaying = !player.paused && !player.ended;
    const idx = Math.min(state.AUDIO_CH.length - 1, state.CURRENT_IDX + 1);
    await ensureNextReadyThenPlay(state, player, idx, wasPlaying);
  });
  const alignBtn = document.getElementById('alignBtn');
  if (alignBtn) {
    alignBtn.addEventListener('click', async ()=>{
      try {
        const idx = state.CURRENT_IDX | 0;
        const hasWords = Array.isArray(state.WORDS?.[idx]) && state.WORDS[idx].length > 0;

        // prefer EPUB chapter mapping; else plain TXT
        const { getMappedRefText } = await import('./chapters_map_ui.js');
        const refText = getMappedRefText ? getMappedRefText(idx, state.REF_TEXT || '') : (state.REF_TEXT || '');

        if (!hasWords || !refText?.trim()) {
          // Build a precise message, only mentioning what’s missing
          const missing = !hasWords && !refText?.trim()
            ? 'a transcript and a reference (TXT/EPUB)'
            : !hasWords ? 'a transcript' : 'a reference (TXT/EPUB)';
          alert(`Need ${missing} first.`);
          return;
        }

        const { alignCurrentChapter } = await import('./playback.js');
        await alignCurrentChapter(state);  // will save AC files too (see Step 3)
      } catch (e) {
        addLog('error','Align failed', String(e));
        alert('Align failed — see log.');
      }
    });
  }
}

export async function startPipeline(player, file){
  state.AUDIO_FILE = file;
  addLog('info','Audio selected',{ name:file?.name, size:file?.size, type:file?.type });
  if(!file){ return; }
  const lower = (file.name||'').toLowerCase();
  if(!lower.endsWith('.m4b')){
    alert('Please select an M4B file to use Chapter Mode.');
    return;
  }
  await ensureSubdirs(file.name);
  setProg(1);

  state.AUDIO_CH = await parseM4BChapters(file);
  state.AUDIO_CH.sort((a,b)=>a.start-b.start).forEach((c,i)=>c.idx=i);

  const sel = document.getElementById('chapterSel'); sel.innerHTML='';
  state.AUDIO_CH.forEach((ch,i)=>{
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${String(i+1).padStart(3,'0')} — ${ch.title}  (${(ch.end-ch.start).toFixed(1)}s)`;
    sel.appendChild(opt);
  });
  sel.selectedIndex = 0;
  state.CURRENT_IDX = 0;

  // NEW: keep list visually in sync and color-coded
  setActiveChapterVisual(0);
  await refreshChapterStatuses();

  setStatus(`Found ${state.AUDIO_CH.length} chapters. Starting…`);

  // Load first chapter (will use cache if present)
  await maybeLoadExistingOrTranscribeFirst(state, player);
  // After first render/save, refresh colors again (in case transcript was cached/saved)
  await refreshChapterStatuses();

  // Pre-slice remaining WAVs in background and update light-blue as they appear
  (async ()=>{
    for(let i=1;i<state.AUDIO_CH.length;i++){
      try{
        // WAV ensure
        if(!state.SLICED_WAVS.has(i)) await sliceChapterToWav(state, i);
        // NEW: show light-blue for chapters that now have WAVs
        await refreshChapterStatuses();
      }catch(e){
        addLog('error','Background chapter processing failed', { i, error:String(e) });
      }
    }
    setStatus('<span class="accent">All remaining chapters processed.</span>');
  })();
}
