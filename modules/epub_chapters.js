// modules/epub_chapters.js
// Parse EPUB chapters to plain text per chapter.
// Returns [{ title, text, idx }]. Auto-loads JSZip if needed.

async function ensureJSZip(){
  if (window.JSZip) return window.JSZip;
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.async=true; s.onload=()=>res(); s.onerror=()=>rej(new Error('JSZip load failed'));
    document.head.appendChild(s);
  });
  if (!window.JSZip) throw new Error('JSZip not available after load');
  return window.JSZip;
}

export async function parseEpubChapters(file){
  const JSZip = await ensureJSZip();
  const zip = await JSZip.loadAsync(file);

  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if(!containerXml) return [];

  const dp = new DOMParser();
  const containerDoc = dp.parseFromString(containerXml,'application/xml');
  const rootfile = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if(!rootfile) return [];

  const opfText = await zip.file(rootfile)?.async('text');
  if(!opfText) return [];
  const opfDoc = dp.parseFromString(opfText,'application/xml');
  const opfDir = rootfile.split('/').slice(0,-1).join('/');
  const resolveHref = (href)=> (opfDir?opfDir+'/':'') + href;

  const manifest = {};
  opfDoc.querySelectorAll('manifest > item').forEach(it=>{
    manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') };
  });
  const spineIds = Array.from(opfDoc.querySelectorAll('spine > itemref')).map(n=>n.getAttribute('idref')).filter(Boolean);

  async function extractFromNav(item){
    const href = resolveHref(item.href);
    const navHtml = await zip.file(href)?.async('text');
    if(!navHtml) return [];
    const doc = dp.parseFromString(navHtml,'text/html');
    const tocNav = doc.querySelector('nav[epub\\:type="toc"], nav[type="toc"], nav[role="doc-toc"]') || doc.querySelector('nav');
    if(!tocNav) return [];
    const items=[];
    tocNav.querySelectorAll('li > a').forEach((a,i)=>{
      const title=(a.textContent||`Chapter ${i+1}`).trim();
      const link=a.getAttribute('href')||'';
      items.push({title, href: link});
    });
    return items;
  }
  async function extractFromNCX(ncxItem){
    const href = resolveHref(ncxItem.href);
    const ncxXml = await zip.file(href)?.async('text'); if(!ncxXml) return [];
    const doc = dp.parseFromString(ncxXml,'application/xml');
    const items=[];
    doc.querySelectorAll('navMap navPoint').forEach((np,i)=>{
      const title = (np.querySelector('navLabel text')?.textContent || `Chapter ${i+1}`).trim();
      const src = np.querySelector('content')?.getAttribute('src') || '';
      items.push({title, href: src});
    });
    return items;
  }

  let tocEntries=[];
  const navEntry = Object.values(manifest).find(m => (/xhtml|html/i.test(m.type)&&/nav/i.test(m.type)) || /nav\.x?html$/i.test(m.href));
  if(navEntry) tocEntries = await extractFromNav(navEntry);
  if(!tocEntries.length){
    const ncxEntry = Object.values(manifest).find(m => /application\/x-dtbncx\+xml/i.test(m.type) || /\.ncx$/i.test(m.href));
    if(ncxEntry) tocEntries = await extractFromNCX(ncxEntry);
  }
  if(!tocEntries.length){
    tocEntries = spineIds.map((id,idx)=>({ title:`Chapter ${idx+1}`, href: manifest[id]?.href || '' }));
  }

  async function readContent(hrefRaw){
    if(!hrefRaw) return '';
    const href = resolveHref(hrefRaw.split('#')[0]);
    const html = await zip.file(href)?.async('text'); if(!html) return '';
    const doc = dp.parseFromString(html,'text/html');
    doc.querySelectorAll('script,style,noscript').forEach(n=>n.remove());
    return (doc.body?.textContent||'').replace(/\s+/g,' ').trim();
  }

  const out=[];
  for(let i=0;i<tocEntries.length;i++){
    const it=tocEntries[i];
    const text=await readContent(it.href);
    if(text && text.length>0) out.push({ title: it.title, text, idx: i });
  }
  return out;
}
