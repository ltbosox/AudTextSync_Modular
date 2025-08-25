// Leftover helpers / shared small utils (2k)
export function safeFileStem(s){ return String(s||'chapter').replace(/[^a-z0-9]+/gi,' ').trim().replace(/\s+/g,' ').slice(0,120); }
export function pad3(n){ return String(n).padStart(3,'0'); }
