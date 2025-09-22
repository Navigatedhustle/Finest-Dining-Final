
function qs(sel, el=document){ return el.querySelector(sel); }
function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2200); }
function getFlags(){ const f=[]; if(qs('#flag_lowcarb')?.checked) f.push('low_carb'); if(qs('#flag_nofried')?.checked) f.push('no_fried'); return f; }
function getTarget(){ return +(qs('#calTarget')?.value || 600); }
function getPP(){ return !!qs('#pp')?.checked; }
function humanDist(mi){ return `${(+mi).toFixed(2)} mi`; }
function setStatus(ok){ const s=qs('[data-status]'); if(!s) return; if(ok){ s.setAttribute('data-status','ok'); s.textContent='Ready'; } }
async function api(path, opts){ const res=await fetch(path, opts); if(!res.ok) throw new Error(`HTTP ${res.status}`); return await res.json(); }

function renderRestaurants(list, mount){
  mount.innerHTML='';
  (list||[]).forEach(r=>{
    const card=document.createElement('div'); card.className='rest-card';
    const tags=(r.cuisine||[]).map(c=>`<span class='mod'>${c}</span>`).join(' ');
    card.innerHTML = `
      <div class="rest-head">
        <div>
          <div class="text-lg font-semibold">${r.name||'Restaurant'}</div>
          <div class="rest-meta">
            ${r.distance_mi!=null?`<span>${humanDist(r.distance_mi)}</span>`:''}
            ${tags}
            ${r.website?`<a class="text-emerald-600 underline" href="${r.website}" target="_blank" rel="noopener">Website</a>`:''}
            <span class="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">${r.source==='menu'?'Parsed from Menu':'Playbook'}</span>
          </div>
        </div>
      </div>`;
    (r.picks||[]).forEach(p=>{
      const k1=`<span class="kpi">${p.est_kcal??'—'} kcal</span>`;
      const k2=`<span class="kpi pro">${p.est_protein_g??'—'} g protein</span>`;
      const mods=(p.modifiers||[]).map(m=>`<span class="mod">${m}</span>`).join(' ');
      const ev=p.evidence?`<div class="evidence"><b>Why:</b> ${(p.evidence.signals||[]).join(', ')} · score ${(p.evidence.final_score??'').toFixed?p.evidence.final_score.toFixed(2):p.evidence.final_score}</div>`:'';
      const id='c'+Math.random().toString(36).slice(2);
      const pick=document.createElement('div'); pick.className='pick';
      pick.innerHTML=`
        <div class="flex items-start justify-between gap-3">
          <div>
            <h5>${p.item_name||'Recommended pick'}</h5>
            <div class="text-sm opacity-90">${p.why_it_works||''}</div>
            <div class="flex items-center gap-2 mt-1">${k1}${k2}<span class="text-xs ml-2 opacity-70">${p.confidence||''}</span></div>
            <div class="flex flex-wrap gap-2 mt-1">${mods}</div>
            ${ev}
          </div>
          <button id="${id}" class="copy-btn shrink-0">Copy Ask</button>
        </div>`;
      card.appendChild(pick);
      setTimeout(()=>{
        const b=qs('#'+id);
        b?.addEventListener('click',async()=>{
          try{ await navigator.clipboard.writeText(p.server_script||''); toast('Copied ask'); }catch(e){ toast('Copy failed'); }
        });
      },0);
    });
    mount.appendChild(card);
  });
}

qs('#zipSearchBtn')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  const zip=qs('#zip')?.value?.trim();
  const radius=+(qs('#radius')?.value||3);
  if(!/^[0-9]{5}$/.test(zip||'')) return toast('Enter a valid 5-digit ZIP');
  toast('Searching…');
  try{
    const payload={zip, radius_miles:radius, calorie_target:getTarget(), flags:getFlags(), prioritize_protein:getPP()};
    const data=await api('/nearby-by-zip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    setStatus(true);
    renderRestaurants(data.restaurants||[], qs('#zipResults'));
    renderRestaurants(data.restaurants||[], qs('#combinedResults'));
    window.parent?.postMessage({type:'fdc-height', height: document.body.scrollHeight}, '*');
  }catch(err){ toast('Could not search right now.'); console.error(err); }
});

qs('#analyzeUrlBtn')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  const url=qs('#menu_url')?.value?.trim();
  if(!url) return toast('Paste a menu URL first');
  toast('Analyzing URL…');
  try{
    const payload={url, calorie_target:getTarget(), flags:getFlags(), prioritize_protein:getPP()};
    const data=await api('/analyze-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    setStatus(true);
    renderRestaurants(data.restaurants||[], qs('#analyzeResults'));
    renderRestaurants(data.restaurants||[], qs('#combinedResults'));
    window.parent?.postMessage({type:'fdc-height', height: document.body.scrollHeight}, '*');
  }catch(err){ toast('Could not analyze that link. Try PDF upload.'); console.error(err); }
});

qs('#analyzePdfBtn')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  const file=qs('#menu_pdf')?.files?.[0];
  if(!file) return toast('Choose a PDF first');
  const fd=new FormData();
  fd.append('pdf', file);
  fd.append('use_ocr', qs('#use_ocr')?.checked ? '1':'0');
  fd.append('calorie_target', getTarget());
  fd.append('prioritize_protein', getPP() ? '1':'0');
  getFlags().forEach(f=>fd.append('flags', f));
  toast('Analyzing PDF…');
  try{
    const res=await fetch('/analyze-pdf',{method:'POST',body:fd});
    const data=await res.json();
    setStatus(true);
    renderRestaurants(data.restaurants||[], qs('#analyzeResults'));
    renderRestaurants(data.restaurants||[], qs('#combinedResults'));
    window.parent?.postMessage({type:'fdc-height', height: document.body.scrollHeight}, '*');
  }catch(err){ toast('PDF analysis failed.'); console.error(err); }
});

// Open Food Facts
qs('#offBtn')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  const q=qs('#offQuery')?.value?.trim();
  if(!q) return toast('Type something like "keto tortilla"');
  try{
    const data=await api('/openfoodfacts?q='+encodeURIComponent(q),{method:'GET'});
    const mount=qs('#analyzeResults');
    const box=document.createElement('div'); box.className='card mt-4';
    box.innerHTML='<div class="font-semibold mb-2">Packaged items</div>' + (data.items||[]).slice(0,6).map(it=>{
      const kcal=it.energy_kcal_per_serving ?? it.energy_kcal_100g ?? '—';
      const pro=it.protein_g_per_serving ?? it.protein_g_100g ?? '—';
      return `<div class="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-800">
        <div><div class="font-medium">${it.product_name||'Item'}</div><div class="text-xs opacity-75">${it.brand||''}</div></div>
        <div class="text-sm flex items-center gap-2"><span class="kpi">${kcal} kcal</span><span class="kpi pro">${pro} g</span></div>
      </div>`;
    }).join('');
    mount.prepend(box);
    toast('Open Food Facts: done');
  }catch(err){ toast('Could not fetch packaged items'); }
});

// Mark ready soon if embedded
setTimeout(()=>{ const s=qs('[data-status]'); if(s && s.getAttribute('data-status')!=='ok'){ s.setAttribute('data-status','ok'); s.textContent='Ready'; } }, 2000);
setInterval(()=>{ try{ window.parent?.postMessage({type:'fdc-height', height: document.body.scrollHeight}, '*'); }catch(_){ } }, 800);
