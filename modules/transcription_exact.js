// modules/transcription_exact.js
// EXACT extraction of your single-file transcription logic, adapted to a wavBlob input.
// No timing constants altered.

import { addLog, setStatus } from './ui.js';

// --- Vosk globals (unchanged) ---
if (window.Vosk && Vosk.setWasmPrefix) Vosk.setWasmPrefix("https://unpkg.com/vosk-browser@0.0.8/dist/");
if (window.Vosk && Vosk.setLogLevel) { Vosk.setLogLevel(0); }

let MODEL = null;
let RECOG = null;

async function headCheck(url){
  try { const r = await fetch(url, { method: "HEAD" }); return { ok:r.ok, status:r.status }; }
  catch(e){ return { ok:false, error:String(e) }; }
}

function isMobileUA(){
  const ua=navigator.userAgent||'';
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua)
      || (window.matchMedia && matchMedia('(pointer:coarse)').matches)
      || window.innerWidth<=768;
}

const IS_MOBILE = isMobileUA();
const BASE = new URL('.', location.href);
const MOBILE_MODEL_URL  = new URL('models/en-us-mobile.tar.gz', BASE).href;
const DESKTOP_MODEL_URL = new URL('models/en-us-desktop.zip', BASE).href;
const MODEL_URL = IS_MOBILE ? MOBILE_MODEL_URL : DESKTOP_MODEL_URL;
// ---- Drain timing knobs ----
const QUIET_MS = 2500;           // stop after this long with no new results
const MAX_TAIL_CAP_MS = 1800000; // hard ceiling: 30 min (tune if you like)
const MAX_TAIL_PER_SEC = 2500;   // ms of tail per second of audio
const MIN_TAIL_MS = 10000;       // never wait less than this overall

function withTimeout(promise, ms, label="operation"){
  let t; const timer=new Promise((_,rej)=>t=setTimeout(()=>rej(new Error(label+" timed out")),ms));
  return Promise.race([promise.finally(()=>clearTimeout(t)), timer]);
}

function destroyRecognizer(){
  if(RECOG){ try{ RECOG.remove && RECOG.remove(); }catch{} RECOG=null; }
}

function createRecognizerWithLogs(model, sr){
  destroyRecognizer();
  let rec = null;
  try{
    rec = model.KaldiRecognizer ? new model.KaldiRecognizer(sr) : new model.Recognizer(sr);
  }catch(e){
    addLog('error','Recognizer create failed', String(e));
    alert('Recognizer create failed — see log');
    return null;
  }
  rec.setWords && rec.setWords(true);
  const feed =
    rec.acceptWaveformFloat ? 'acceptWaveformFloat(Float32,sr)' :
    (rec.acceptWaveform && rec.acceptWaveform.length===2 ? 'acceptWaveform(Int16,sr)' : 'acceptWaveform(Int16)');
  addLog('info','Recognizer method',{feed});
  addLog('info','Recognizer ready',{sampleRate:sr});
  return rec;
}

export async function ensureModelExact(){
  if (typeof Vosk==='undefined'){ addLog('error','Vosk not loaded'); alert('Vosk failed to load'); return null; }
  if (MODEL) return MODEL;

  setStatus(`Loading Vosk model… (${IS_MOBILE?'mobile':'desktop'})`);

  const head = await headCheck(MODEL_URL);
  if(!head.ok){
    addLog('error','Model URL not reachable',{url:MODEL_URL,...head});
    alert(`Model URL not reachable (${head.status || head.error}). Check the /models path & CORS.`);
    return null;
  }

  try{
    MODEL = await withTimeout(Vosk.createModel(MODEL_URL), IS_MOBILE?150000:90000, "createModel");
    addLog('info','Model created via URL',{url:MODEL_URL});
  }catch(e){
    addLog('error','createModel(URL) failed', String(e));
    const fallback = MODEL_URL.replace(/\.(zip|tar\.gz|tgz)$/i,'/model.json');
    if (fallback!==MODEL_URL) {
      try { MODEL = await withTimeout(Vosk.createModel(fallback), 60000, "createModel(model.json)"); }
      catch(e2){ addLog('error','Fallback model.json failed', String(e2)); }
    }
  }

  if(!MODEL){ setStatus('Model load failed'); alert('Model load failed — see Log for details.'); return null; }
  return MODEL;
}

// ---- Audio utils (unchanged algorithms) ----
async function wavBlobToMonoF32(wavBlob, targetRate = 16000){
  const arrayBuf = await wavBlob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const cx = new AC();
  const decoded = await cx.decodeAudioData(arrayBuf);
  const chs=decoded.numberOfChannels, sr=decoded.sampleRate, frames=decoded.length;
  addLog('info','Audio decoded',{sr,chs,frames,secs:decoded.duration.toFixed(3)});
  const mono=new Float32Array(frames);
  for (let c=0;c<chs;c++){ const data=decoded.getChannelData(c); for(let i=0;i<frames;i++) mono[i]+=data[i]/chs; }
  const res = resampleF32(mono, sr, targetRate);
  addLog('info','Resampled',{from:sr,to:targetRate,samples:res.length});
  await cx.close();
  return { f32:res, sr: targetRate };
}

function resampleF32(input, src, dst){
  if (src===dst) return input;
  const ratio = dst/src, outLen = Math.round(input.length*ratio), out = new Float32Array(outLen);
  for (let i=0;i<outLen;i++){ const x=i/ratio, xi=Math.floor(x), t=x-xi;
    const a=input[xi]||0, b=input[xi+1]||0; out[i]=a+(b-a)*t;
  }
  return out;
}

function floatToInt16(f32){
  const i16 = new Int16Array(f32.length);
  for (let i=0;i<f32.length;i++){
    let s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s<0 ? Math.round(s*32768) : Math.round(s*32767);
  }
  return i16;
}

// ---- EXACT transcription pipeline, taking wavBlob and chapterStart ----
export async function transcribeWavBlobExact({ idx, wavBlob, chapterStartSec = 0, chapterTitle = 'Chapter', refText = '' }){
  const model = await ensureModelExact(); if(!model) return { words:[], plain:'' };

  const { f32, sr } = await wavBlobToMonoF32(wavBlob, 16000);
  const i16 = floatToInt16(f32);

  setStatus(`Transcribing… ${chapterTitle}`);

  RECOG = createRecognizerWithLogs(model, sr);
  if(!RECOG) return { words:[], plain:'' };

  // --- Event capture (EXACT) ---
  const fromEvents = [];
  const transcriptPieces = [];
  let lastEvt = performance.now();

  const coerce = (m)=>{ if (typeof m==='string'){ try{ return JSON.parse(m) }catch{} } return m; };

  if (RECOG.on) {
    try {
      RECOG.on('result', (m)=>{
        lastEvt = performance.now();
        let r = coerce(m);
        const arr  = r?.result?.result || r?.result || [];
        const text = r?.result?.text   || r?.text   || '';
        if (text) transcriptPieces.push(text);
        if (arr.length){ fromEvents.push(...arr); addLog('info','event result', {words:arr.length}); }
      });
      RECOG.on('finalresult', (m)=>{
        lastEvt = performance.now();
        let r = coerce(m);
        const arr  = r?.result?.result || r?.result || [];
        const text = r?.result?.text   || r?.text   || '';
        if (text) transcriptPieces.push(text);
        if (arr.length){ fromEvents.push(...arr); addLog('info','final event', {words:arr.length}); }
      });
      RECOG.on('partialresult', (m)=>{
        lastEvt = performance.now();
        let p = coerce(m);
        const t = p?.result?.partial || p?.partial || '';
        if (t) addLog('info','partial — ' + t);
      });
    } catch {}
  }

  // --- Streaming (EXACT): 0.5s chunks, UI yield, same progress cadence ---
  const useFloat = !!RECOG.acceptWaveformFloat;
  const FEED = useFloat ? f32 : i16;
  const CH = Math.max(1, sr * 0.5 | 0); // ~0.5s
  let off = 0, nChunks = 0;

  while (off < FEED.length){
    const endIdx = Math.min(FEED.length, off + CH);
    const slice = FEED.subarray(off, endIdx);
    off = endIdx; nChunks++;

    try{
      if (useFloat) RECOG.acceptWaveformFloat(slice, sr);
      else if (RECOG.acceptWaveform.length === 2) RECOG.acceptWaveform(slice, sr);
      else RECOG.acceptWaveform(slice);
    }catch(e){
      addLog('error','acceptWaveform failed', String(e));
      break;
    }

    // Poll partials only if there’s no event path (unchanged)
    if (!RECOG.on && RECOG.partialResult){
      try{
        let p = RECOG.partialResult();
        if (typeof p === 'string'){ try{ p = JSON.parse(p) }catch{} }
        const t = p?.partial || p?.result?.partial || '';
        if (t) addLog('info', 'partial — ' + t);
      }catch{}
    }

    if (nChunks % 8 === 0){
      // progress update (kept minimal; your UI already logs)
    }
    await Promise.resolve(); // yield to UI exactly as before (0 delay)
  }

  // Tail of silence to flush (EXACT: 1s)
  try{
    const tail = sr * 1 | 0;
    if (useFloat) RECOG.acceptWaveformFloat(new Float32Array(tail), sr);
    else if (RECOG.acceptWaveform.length === 2) RECOG.acceptWaveform(new Int16Array(tail), sr);
    else RECOG.acceptWaveform(new Int16Array(tail));
    addLog('info','Silence tail fed',{samples:tail});
  }catch(e){ addLog('warn','Silence tail failed', String(e)); }

  // Robust drain (EXACT constants)
  const drained = [];
  const drainSync = ()=>{
    let pulled = 0;
    if (RECOG.result){
      for(;;){
        let r = RECOG.result();
        if (typeof r === 'string'){ try{ r = JSON.parse(r) }catch{} }
        const arr = r?.result || [];
        const text = r?.text || '';
        if (text) transcriptPieces.push(text);
        if (arr && arr.length){ drained.push(...arr); pulled += arr.length; } else break;
      }
    }
    if (RECOG.finalResult){
      let fr = RECOG.finalResult();
      if (typeof fr === 'string'){ try{ fr = JSON.parse(fr) }catch{} }
      const arr = fr?.result || [];
      const text = fr?.text || '';
      if (text) transcriptPieces.push(text);
      if (arr && arr.length){ drained.push(...arr); pulled += arr.length; }
    }
    return pulled;
  };

  // Initial pull + “quiet window” wait (keeps saving from happening early)
  drainSync();
  const durSec = FEED.length / sr;
  const maxTail = Math.min(
    MAX_TAIL_CAP_MS,
    Math.max(MIN_TAIL_MS, Math.round(durSec * MAX_TAIL_PER_SEC))
  );

  let reason = 'timeout';
  const t0 = performance.now();
  for (; performance.now() - t0 < maxTail;) {
    await new Promise(r=>setTimeout(r,150));
    const added = drainSync();
    if (added > 0) { lastEvt = performance.now(); continue; }
    if (performance.now() - lastEvt > QUIET_MS) { reason = 'quiet'; break; }
  }
  // Small extra pulls for safety
  for (let k=0; k<2; k++){ await new Promise(r=>setTimeout(r,100)); drainSync(); }
  
  addLog('info', `Drain complete (${reason})`, {
    waitedMs: Math.round(performance.now() - t0),
    maxTail
  });

  const baseWords = (fromEvents.length ? fromEvents : drained);

  // Shift to absolute chapter/file time (EXACT)
  const shifted = baseWords
    .filter(w => w && Number.isFinite(+w.start) && Number.isFinite(+w.end))
    .map(w => ({
      word: String(w.word||'').trim(),
      start: chapterStartSec + +w.start,
      end:   chapterStartSec + +w.end,
      conf:  +(w.conf ?? 1)
    }));

  const plain = (transcriptPieces.join(' ') || '').replace(/\s+/g,' ').trim();

  addLog('info','Transcribe done', { idx, words: shifted.length, chars: plain.length });

  return { words: shifted, plain };
}
