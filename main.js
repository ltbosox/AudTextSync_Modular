import { addLog, setStatus } from './modules/ui.js';
import { state } from './modules/app_state.js';
import { initPickers } from './modules/file_pickers.js';
import { ensureNextReadyThenPlay, setPlayerToChapter } from './modules/playback.js';
import { alignAndCorrectCurrent } from './modules/align.js';

// Initial status
setStatus('Ready. Select an M4B to begin — the app will extract chapters to WAVs (local ffmpeg), transcribe (Vosk CDN), and save files into <b>chapters/</b> and <b>transcriptions/</b>.');

const player = document.getElementById('player');
player.addEventListener('ratechange', ()=>{ document.getElementById('rate').value = player.playbackRate.toFixed(2); });
document.getElementById('rate').addEventListener('change', ()=>{ player.playbackRate = Math.max(.5, Math.min(2.5, +document.getElementById('rate').value || 1)); });

player.addEventListener('ended', async ()=>{
  setStatus('Chapter ended.');
  const next = state.CURRENT_IDX + 1;
  if(next < state.AUDIO_CH.length){
    await ensureNextReadyThenPlay(state, player, next);
  }
});

initPickers(player);
