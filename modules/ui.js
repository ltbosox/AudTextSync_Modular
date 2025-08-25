// UI helpers (2a)
export const el = (id)=>document.getElementById(id);
export const NL='\n';

let LOG = [];
export function addLog(level, msg, obj){
  const logEl = el('log');
  const now = new Date().toLocaleTimeString();
  const payload = (obj===undefined) ? '' : '\n' + (typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  const line = `[${now}] ${level.toUpperCase()}: ${msg}${payload}`;
  LOG.push(line); if (LOG.length > 5000) LOG.shift();
  if (logEl){
    logEl.textContent += (logEl.textContent ? '\n' : '') + line;
    logEl.scrollTop = logEl.scrollHeight;
  }
  console[level==='error'?'error':(level==='warn'?'warn':'log')](msg, obj||'');
}

export function setStatus(html){ el('status').innerHTML = html; }
export function setProg(v){ el('prog').value = Math.max(0, Math.min(100, v|0)); }
