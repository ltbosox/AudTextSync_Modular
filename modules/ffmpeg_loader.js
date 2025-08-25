// FFmpeg loader + slice (2d1)
import { addLog } from './ui.js';

async function loadScript(src, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const timer = setTimeout(() => { s.remove(); reject(new Error('timeout')); }, timeoutMs);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = (e) => { clearTimeout(timer); reject(e?.error || new Error('network error')); };
    s.src = src; s.async = true;
    document.head.appendChild(s);
  });
}

const FFMPEG_UMD_CANDIDATES = [
  './ffmpeg/ffmpeg.min.js',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
  'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js'
];
const CORE_URLS = {
  umd: {
    js  : 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
    wasm: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm'
  },
  esm: {
    js  : 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
    wasm: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm'
  }
};

const ESM_INDEX = new URL('./ffmpeg/esm/index.js', location.href).toString();

function waitFor(pred, ms = 20000, step = 50) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    (function poll(){
      if (pred()) return resolve();
      if (performance.now() - t0 > ms) return reject(new Error('timeout'));
      setTimeout(poll, step);
    })();
  });
}
async function toBlobURL(url, mime) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`fetch failed ${r.status} ${url}`);
  const b = await r.arrayBuffer();
  return URL.createObjectURL(new Blob([b], { type: mime }));
}

export const FS = {
  async write(ff, path, data){ return ff.FS ? ff.FS('writeFile', path, data) : ff.writeFile(path, data); },
  async read(ff, path){ return ff.FS ? ff.FS('readFile', path) : ff.readFile(path); },
  async unlink(ff, path){
    try {
      if (ff.FS) ff.FS('unlink', path);
      else if (ff.deleteFile) await ff.deleteFile(path);
    } catch {}
  }
};

let __FFMPEG_SINGLETON = null;
export async function ensureFFmpeg(){
  if (__FFMPEG_SINGLETON) return __FFMPEG_SINGLETON;

  try {
    if (!(window.FFmpeg && window.FFmpeg.FFmpeg)) {
      for (const url of FFMPEG_UMD_CANDIDATES) {
        try { await loadScript(url, 12000); if (window.FFmpeg && window.FFmpeg.FFmpeg) break; }
        catch (err) { addLog('warn','[FFmpeg] script failed', { url, err:String(err) }); }
      }
    }
    await waitFor(() => !!(window.FFmpeg && window.FFmpeg.FFmpeg), 8000, 50);
    const FFmpegCtor = window.FFmpeg.FFmpeg;
    const ff = new FFmpegCtor();
    const coreURL = await toBlobURL(CORE_URLS.umd.js, 'text/javascript');
    const wasmURL = await toBlobURL(CORE_URLS.umd.wasm, 'application/wasm');
    await ff.load({ coreURL, wasmURL });
    __FFMPEG_SINGLETON = ff;
    addLog('info','FFmpeg ready (UMD)');
    return ff;
  } catch (e) {
    addLog('warn','FFmpeg UMD path not available — trying ESM fallback', String(e));
  }

  const mod = await import(ESM_INDEX).catch(()=>null);
  if (!mod || !mod.FFmpeg) throw new Error('FFmpeg ESM module not found');
  const ff = new mod.FFmpeg();
  const coreURL = await toBlobURL(CORE_URLS.esm.js, 'text/javascript');
  const wasmURL = await toBlobURL(CORE_URLS.esm.wasm, 'application/wasm');
  await ff.load({ coreURL, wasmURL });
  __FFMPEG_SINGLETON = ff;
  addLog('info','FFmpeg ready (ESM)');
  return ff;
}

export async function m4bSliceToWavUsingFFmpeg(file, startSec, endSec){
  const ff = await ensureFFmpeg();
  const inName  = 'in.m4b';
  const outName = 'out.wav';
  const src = new Uint8Array(await file.arrayBuffer());
  await FS.unlink(ff, inName);
  await FS.write(ff, inName, src);
  await FS.unlink(ff, outName);

  const ss = Math.max(0, startSec || 0);
  const useDur = Number.isFinite(endSec) && endSec > ss + 0.02 ? (endSec - ss) : null;

  const args = ['-hide_banner','-ss', String(ss), '-i', inName];
  if (useDur!=null) args.push('-t', String(useDur));
  args.push('-vn','-ac','1','-ar','16000','-c:a','pcm_s16le', outName);

  addLog('info','ffmpeg exec', { cmd: 'ffmpeg ' + args.join(' ') });
  await ff.exec(args);

  const wav = await FS.read(ff, outName);
  try { await FS.unlink(ff, inName); await FS.unlink(ff, outName); } catch {}
  return new Blob([wav], { type:'audio/wav' });
}
