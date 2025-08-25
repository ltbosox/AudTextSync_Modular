// modules/align_correct.js
// Ported from your reference: alignment + correction (DP grouping)
// Usage: alignAndCorrect(hypWords, refText) -> corrected words[]

function normalizeToken(s){ return String(s).toLowerCase().replace(/[^a-z]+/g,''); }
function tokenizeReference(text){
  return String(text||'').split(/\s+/).filter(Boolean)
    .map(tok => { const norm = normalizeToken(tok); return norm ? { raw: tok, norm } : null; })
    .filter(Boolean);
}
function levenshtein(a,b){
  const m=a.length,n=b.length,dp=new Array(n+1);
  for(let j=0;j<=n;j++) dp[j]=j;
  for(let i=1;i<=m;i++){
    let prev=dp[0]; dp[0]=i;
    for(let j=1;j<=n;j++){
      const ins=dp[j]+1, del=dp[j-1]+1, sub=prev+(a[i-1]===b[j-1]?0:1);
      prev=dp[j]; dp[j]=Math.min(ins,del,sub);
    }
  }
  return dp[n];
}
function sim(a,b){ if(!a.length&&!b.length) return 1; const d=levenshtein(a,b); return 1 - d / Math.max(1, Math.max(a.length,b.length)); }
function joinNorm(arr){ return arr.map(x => normalizeToken(typeof x==='string' ? x : x.word||x.raw||'')).join(''); }

/**
 * Align hypothesized words to reference text and “correct” tokens/timings.
 * hypWords: [{ word, start, end, conf }]
 * refText: string (from .txt or from an EPUB chapter)
 */
export function alignAndCorrect(hypWords, refText){
  const ref = tokenizeReference(refText);
  const hyp = (hypWords||[]).map(w=>({
    raw: w.word, norm: normalizeToken(w.word),
    start:+w.start, end:+w.end, conf:+(w.conf??1)
  }));

  const n=hyp.length, m=ref.length, H=3, R=3, BIG=1e9, PEN_GROUP=.005, PEN_SIZE=.01;
  function score(i1,i2,j1,j2){
    const hg=hyp.slice(i1,i2), rg=ref.slice(j1,j2);
    const hj=joinNorm(hg), rj=rg.map(x=>x.norm).join('');
    const base = 1 - sim(hj,rj);
    const pen  = PEN_GROUP*(hg.length+rg.length-2) + PEN_SIZE*Math.abs(hg.length-rg.length);
    return base + pen;
  }

  const dp=Array.from({length:n+1},()=>Array(m+1).fill(BIG));
  const back=Array.from({length:n+1},()=>Array(m+1).fill(null));
  dp[0][0]=0;

  for(let i=0;i<=n;i++){
    for(let j=0;j<=m;j++){
      const cur=dp[i][j];
      if(cur===BIG) continue;
      for(let hi=1;hi<=H && i+hi<=n;hi++){
        for(let rj=1;rj<=R && j+rj<=m;rj++){
          const c=score(i,i+hi,j,j+rj), nc=cur+c;
          if(nc < dp[i+hi][j+rj]){
            dp[i+hi][j+rj]=nc;
            back[i+hi][j+rj]={i0:i,j0:j,hi,rj};
          }
        }
      }
    }
  }

  const groups=[];
  if(back[n][m]==null){
    // Fallback: pairwise
    let i=0,j=0; while(i<n && j<m){ groups.push({i0:i,j0:j,hi:1,rj:1}); i++; j++; }
  }else{
    let i=n,j=m;
    while(i>0 && j>0){ const b=back[i][j]; groups.push(b); i=b.i0; j=b.j0; }
    groups.reverse();
  }

  const out=[]; let prevEnd=null;
  for(const g of groups){
    const hypG=hyp.slice(g.i0, g.i0+g.hi);
    const refG=ref.slice(g.j0, g.j0+g.rj);
    let gStart = Math.min(...hypG.map(t=>t.start));
    let gEnd   = Math.max(...hypG.map(t=>t.end));
    if(prevEnd!=null && gStart<prevEnd){ gStart=prevEnd; if(gEnd<gStart) gEnd=gStart; }

    if(g.rj===1){
      out.push({ word: refG[0].raw, start: gStart, end: gEnd, conf: 1 });
    } else if (g.hi===1){
      const total = refG.reduce((a,b)=>a+b.norm.length,0)||g.rj;
      let cur=gStart;
      for(let k=0;k<g.rj;k++){
        const rr=refG[k], frac=(rr.norm.length||1)/total;
        const next = (k===g.rj-1) ? gEnd : Math.min(gEnd, cur + frac*(gEnd-gStart));
        out.push({ word: rr.raw, start: cur, end: next, conf: 1 });
        cur = next;
      }
    } else {
      const step=(gEnd-gStart)/g.rj || 0;
      for(let k=0;k<g.rj;k++){
        const a = gStart + k*step, b = (k===g.rj-1 ? gEnd : gStart + (k+1)*step);
        out.push({ word: refG[k].raw, start:a, end:b, conf:1 });
      }
    }
    prevEnd = out[out.length-1].end;
  }

  // If reference is longer than matched groups, trail-fill short synthetic words
  const produced = groups.reduce((s,g)=>s+g.rj,0);
  if (produced < ref.length){
    let cur = prevEnd ?? 0;
    for(let j=produced;j<ref.length;j++){
      const w = ref[j];
      out.push({ word: w.raw, start:cur, end:cur+.25, conf:.5 });
      cur += .25;
    }
  }
  return out;
}
