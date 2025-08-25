// Workspace & File Saving (2h)
import { addLog } from './ui.js';
export const WORKSPACE = { root:null, chapters:null, trans:null };

export async function chooseWorkspace(){
  if(!window.showDirectoryPicker){
    alert('Your browser does not support the File System Access API. Files will be offered as downloads instead.');
    return;
  }
  try{
    const root = await showDirectoryPicker({ mode:'readwrite' });
    WORKSPACE.root = root; WORKSPACE.chapters=null; WORKSPACE.trans=null;
    addLog('info','Workspace selected', { ok:true });
  }catch(e){ addLog('warn','Workspace pick canceled/failed', String(e)); }
}

export async function ensureSubdirs(m4bName) {
  if(!WORKSPACE.root) return { parent:null, chDir:null, txDir:null, stem:'' };
  const stem = (m4bName || 'audio').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 80);
  const parent = await WORKSPACE.root.getDirectoryHandle(stem, { create: true });
  const chDir  = await parent.getDirectoryHandle('chapters',     { create: true });
  const txDir  = await parent.getDirectoryHandle('transcripts',   { create: true });
  WORKSPACE.chapters = chDir; WORKSPACE.trans = txDir;
  return { parent, chDir, txDir, stem };
}

export function getWorkspace(){ return WORKSPACE; }

export async function writeFile(dirHandle, name, blobOrText){
  if(!dirHandle) return false;
  const fh = await dirHandle.getFileHandle(name, { create:true });
  const w = await fh.createWritable();
  if(blobOrText instanceof Blob){ await w.write(blobOrText); }
  else { await w.write(new Blob([blobOrText], { type:'text/plain' })); }
  await w.close();
  return true;
}

export async function readTextIfExists(dirHandle, name){
  try{ const fh = await dirHandle.getFileHandle(name); const f = await fh.getFile(); return await f.text(); }catch{ return null; }
}
export async function readBlobIfExists(dirHandle, name){
  try{ const fh = await dirHandle.getFileHandle(name); const f = await fh.getFile(); return f; }catch{ return null; }
}

export function triggerDownload(name, blob){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 30000);
}
