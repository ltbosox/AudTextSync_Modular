// MP4 Boxes Scanning & QuickTime Text-Track Chapters (2d2)
function readBoxes(dv, start, end){
  const boxes=[]; let off=start;
  while(off+8<=end){
    let size=dv.getUint32(off);
    const type=String.fromCharCode(dv.getUint8(off+4),dv.getUint8(off+5),dv.getUint8(off+6),dv.getUint8(off+7));
    let header=8;
    if(size===1){ const hi=dv.getUint32(off+8), lo=dv.getUint32(off+12); size=Number((BigInt(hi)<<32n)+BigInt(lo)); header=16; }
    else if(size===0){ size=end-off; }
    if(size<header || off+size>end) break;
    boxes.push({type,start:off,size,header,end:off+size,children:null});
    off+=size||8;
  }
  return boxes;
}
function parseTree(dv, start, end){
  const top=readBoxes(dv,start,end);
  const walk=(box)=>{
    const container=["moov","trak","mdia","minf","stbl","edts","udta","meta","ilst"].includes(box.type);
    if(box.type==="meta"){
      const payloadStart = box.start + box.header + 4;
      box.children = readBoxes(dv, payloadStart, box.end).map(b=>walk(b));
    }else if(container){
      box.children = readBoxes(dv, box.start+box.header, box.end).map(b=>walk(b));
    }else{ box.children=[]; }
    return box;
  };
  return top.map(walk);
}
function findPath(root, path){
  let cur=root, last=null;
  for (const p of path){ last=(cur||[]).find(b=>b.type===p); if(!last) return null; cur=last.children||[]; }
  return last;
}
function getDurationSeconds(dv, root){
  const mvhd=findPath(root,["moov","mvhd"]); if(!mvhd) return null;
  let off=mvhd.start+mvhd.header; const ver=dv.getUint8(off); off+=1; off+=3;
  if(ver===1){ off+=8; off+=8; const timescale=dv.getUint32(off); off+=4; const hi=dv.getUint32(off), lo=dv.getUint32(off+4); off+=8; const dur=Number((BigInt(hi)<<32n)+BigInt(lo)); return timescale?dur/timescale:null; }
  else { off+=4; off+=4; const timescale=dv.getUint32(off); off+=4; const dur=dv.getUint32(off); off+=4; return timescale?dur/timescale:null; }
}
function parseTextTrack(dv, root){
  const moov=root.find(b=>b.type==='moov'); if(!moov) return {entries:[],debug:"no moov"};
  const traks=moov.children.filter(b=>b.type==='trak');
  for (const trak of traks){
    const mdia=trak.children.find(b=>b.type==='mdia'); if(!mdia) continue;
    const hdlr=mdia.children.find(b=>b.type==='hdlr'); if(!hdlr) continue;
    const hOff=hdlr.start+hdlr.header;
    const handler=String.fromCharCode(dv.getUint8(hOff+8),dv.getUint8(hOff+9),dv.getUint8(hOff+10),dv.getUint8(hOff+11));
    if(!["text","sbtl","subt"].includes(handler)) continue;

    const mdhd=mdia.children.find(b=>b.type==='mdhd'); if(!mdhd) continue;
    let mOff=mdhd.start+mdhd.header; const ver=dv.getUint8(mOff); mOff+=1; mOff+=3;
    let timescale; if(ver===1){ mOff+=8; mOff+=8; timescale=dv.getUint32(mOff); } else { mOff+=4; mOff+=4; timescale=dv.getUint32(mOff); }

    const minf=mdia.children.find(b=>b.type==='minf'); if(!minf) continue;
    const stbl=minf.children.find(b=>b.type==='stbl'); if(!stbl) continue;

    const stts=stbl.children.find(b=>b.type==='stts'); if(!stts) continue;
    let tOff=stts.start+stts.header; tOff+=4; const n=dv.getUint32(tOff); tOff+=4;
    const dts=[]; let t=0;
    for (let i=0;i<n;i++){ const count=dv.getUint32(tOff); tOff+=4; const delta=dv.getUint32(tOff); tOff+=4; for(let j=0;j<count;j++){ dts.push(t); t+=delta; } }

    const stsz=stbl.children.find(b=>b.type==='stsz'); if(!stsz) continue;
    let zOff=stsz.start+stsz.header; zOff+=4; const sampleSize=dv.getUint32(zOff); zOff+=4; const sampleCount=dv.getUint32(zOff); zOff+=4;
    const sizes = sampleSize ? Array(sampleCount).fill(sampleSize) : Array.from({length:sampleCount},(_,i)=>dv.getUint32(zOff+i*4));

    const stsc=stbl.children.find(b=>b.type==='stsc'); if(!stsc) continue;
    let cOff=stsc.start+stsc.header; cOff+=4; const cCount=dv.getUint32(cOff); cOff+=4; const stscEntries=[];
    for (let i=0;i<cCount;i++){ stscEntries.push([dv.getUint32(cOff),dv.getUint32(cOff+4),dv.getUint32(cOff+8)]); cOff+=12; }

    const stco=stbl.children.find(b=>b.type==='stco'); const co64=stbl.children.find(b=>b.type==='co64');
    let offs=[];
    if(stco){ let oOff=stco.start+stco.header; oOff+=4; const oCount=dv.getUint32(oOff); oOff+=4; for(let i=0;i<oCount;i++) offs.push(dv.getUint32(oOff+i*4)); }
    else if(co64){ let oOff=co64.start+co64.header; oOff+=4; const oCount=dv.getUint32(oOff); oOff+=4; for(let i=0;i<oCount;i++){ const hi=dv.getUint32(oOff+i*8),lo=dv.getUint32(oOff+i*8+4); offs.push(Number((BigInt(hi)<<32n)+BigInt(lo))); } }
    else continue;

    const chunkSampleCounts = Array(offs.length).fill(0);
    for (let i=0;i<stscEntries.length;i++){
      const first=stscEntries[i][0]-1;
      const nextFirst=(i+1<stscEntries.length?stscEntries[i+1][0]-2:offs.length-1);
      const spc=stscEntries[i][1];
      for (let ch=first; ch<=nextFirst; ch++){ if(ch>=0 && ch<chunkSampleCounts.length) chunkSampleCounts[ch]=spc; }
    }
    const sampleOffsets=[]; let sizeIdx=0;
    for (let ch=0; ch<offs.length; ch++){
      const base=offs[ch], spc=chunkSampleCounts[ch]||0;
      let cur=base;
      for (let k=0;k<spc;k++){
        if(sizeIdx>=sizes.length) break;
        const sz=sizes[sizeIdx++]; sampleOffsets.push([cur,sz]); cur+=sz;
      }
      if(sizeIdx>=sizes.length) break;
    }

    const nSamples=Math.min(dts.length,sampleOffsets.length), entries=[];
    for (let i=0;i<nSamples;i++){
      const [soff,sz]=sampleOffsets[i];
      const bytes=new Uint8Array(dv.buffer, soff, sz);
      let title="";
      if(sz>=2){
        const L=(bytes[0]<<8)|bytes[1];
        if(L>0 && 2+L<=bytes.length){ title=new TextDecoder().decode(bytes.slice(2,2+L)); }
      }
      if(!title){
        try{ title=new TextDecoder().decode(bytes); }catch{ try{ title=new TextDecoder('utf-16be').decode(bytes); }catch{ title=""; } }
      }
      entries.push({index:i+1,startSeconds:timescale? dts[i]/timescale:0,title:(title||'').trim()});
    }
    if(entries.length) return {entries,debug:`text-track samples=${entries.length}`};
  }
  return {entries:[],debug:'no text-track'};
}
function parseChpl(dv, chplBox, fileDurationSec){
  const start = chplBox.start + chplBox.header, end = chplBox.end;
  if (end - start < 6) return { entries:[], debug:"too small" };
  let off = start;
  const units=[["us",1/1e6],["ms",1/1e3],["sec",1],["cs",1/100],["90k",1/90000]];
  const margin=600;
  function parseLen(base){
    const out=[]; let p=base;
    while(p+9<=end){
      const hi=dv.getUint32(p), lo=dv.getUint32(p+4); p+=8;
      const L=dv.getUint8(p); p+=1;
      if(p+L>end) break;
      const bytes=new Uint8Array(dv.buffer, dv.byteOffset+p, L); p+=L;
      const title=new TextDecoder().decode(bytes);
      const raw=Number((BigInt(hi)<<32n)+BigInt(lo));
      out.push({raw,title});
      if(L===0 && out.length>4096) break;
    }
    return out;
  }
  function parseCStr(base){
    const out=[]; let p=base;
    while(p+9<=end){
      const hi=dv.getUint32(p), lo=dv.getUint32(p+4); p+=8;
      let q=p, found=-1, scanned=0;
      while(q<end && scanned<2048){ if(dv.getUint8(q)===0){found=q;break;} q++; scanned++; }
      if(found<0) break;
      const bytes=new Uint8Array(dv.buffer, dv.byteOffset+p, found-p); p=found+1;
      const raw=Number((BigInt(hi)<<32n)+BigInt(lo));
      const title=new TextDecoder().decode(bytes);
      out.push({raw,title});
      if(out.length>4096) break;
    }
    return out;
  }
  const atts=[];
  for (const layout of ["len","cstr"]){
    for (const skip of [false,true]){
      for (let shift=0; shift<=64; shift++){
        const base=off+(skip?1:0)+shift; if(base>=end) break;
        const raw = (layout==="len") ? parseLen(base) : parseCStr(base);
        if(!raw.length) continue;
        atts.push({layout,skip,shift,raw});
      }
    }
  }
  if(!atts.length) return {entries:[],debug:'no candidates'};
  let bestUnit="us", bestScale=1/1e6, bestCount=-1;
  for (const [uname,scale] of units){
    let c=0;
    for (const a of atts){
      for (const r of a.raw){
        const t=r.raw*scale;
        if(t>=0 && (!fileDurationSec || t<=fileDurationSec+margin)) c++;
      }
    }
    if(c>bestCount){ bestCount=c; bestUnit=uname; bestScale=scale; }
  }
  atts.forEach(a=>{
    a.seq=a.raw.map(r=>({t:r.raw*bestScale,title:r.title}));
    a.inRange=a.seq.filter(e=>e.t>=0 && (!fileDurationSec || e.t<=fileDurationSec+margin));
    a.score=a.inRange.length;
  });
  atts.sort((a,b)=>b.score-a.score);
  const primary=atts[0];
  const merged=[...primary.inRange];
  for (let i=1;i<atts.length;i++){
    for (const e of atts[i].inRange){
      if(!merged.some(m=>Math.abs(m.t-e.t)<=0.2)) merged.push(e);
    }
  }
  merged.sort((a,b)=>a.t-b.t);
  return { entries: merged.map((e,i)=>({index:i+1,startSeconds:e.t,title:e.title})),
           debug:`chpl: unit=${bestUnit}, primary=${primary.layout}/${primary.skip}/${primary.shift}, inRange=${primary.inRange.length}, merged=${merged.length}` };
}
function withStops(list, durationSec){
  const out=list.map(c=>({...c}));
  for (let i=0;i<out.length;i++){
    const thisStart=out[i].startSeconds ?? out[i].start ?? 0;
    const nextStart=(i+1<out.length) ? (out[i+1].startSeconds ?? out[i+1].start ?? thisStart) :
                    (Number.isFinite(durationSec)? durationSec : thisStart);
    out[i].start = thisStart;
    out[i].end = Math.max(thisStart, nextStart);
    out[i].title = out[i].title || `Chapter ${String(i+1).padStart(2,'0')}`;
  }
  return out.map(({index,...c},i)=>({title:c.title,start:c.start,end:c.end,idx:i}));
}
export async function parseM4BChapters(file){
  const buf=await file.arrayBuffer();
  const dv=new DataView(buf);
  const root=parseTree(dv,0,buf.byteLength);
  const mvhd=(function(root){
    let cur=root, last=null;
    for (const p of ["moov","mvhd"]){ last=(cur||[]).find(b=>b.type===p); if(!last) return null; cur=last.children||[]; }
    return last;
  })(root);
  const dur = (function(dv, mvhd){
    if(!mvhd) return null;
    let off=mvhd.start+mvhd.header; const ver=dv.getUint8(off); off+=1; off+=3;
    if(ver===1){ off+=8; off+=8; const timescale=dv.getUint32(off); off+=4; const hi=dv.getUint32(off), lo=dv.getUint32(off+4); off+=8; const dur=Number((BigInt(hi)<<32n)+BigInt(lo)); return timescale?dur/timescale:null; }
    else { off+=4; off+=4; const timescale=dv.getUint32(off); off+=4; const dur=dv.getUint32(off); off+=4; return timescale?dur/timescale:null; }
  })(dv, mvhd);

  const textRes = parseTextTrack(dv,root);
  if (textRes.entries?.length){
    const chapters = withStops(textRes.entries.sort((a,b)=>a.startSeconds-b.startSeconds), dur);
    return chapters;
  }
  const udta=(function(root){ const moov=root.find(b=>b.type==='moov'); return moov?moov.children.find(b=>b.type==='udta'):null; })(root);
  const chpl=udta?.children?.find(b=>b.type==='chpl');
  if (chpl){
    const chplRes=parseChpl(dv,chpl,dur||null);
    if (chplRes.entries?.length){
      const chapters = withStops(chplRes.entries.sort((a,b)=>a.startSeconds-b.startSeconds), dur);
      return chapters;
    }
  }
  return [{ title: file.name.replace(/\.[^.]+$/,''), start: 0, end: dur||0, idx: 0 }];
}
