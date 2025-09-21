(function(){
  // Theme
  const darkToggle = document.getElementById('darkToggle');
  darkToggle?.addEventListener('click', ()=>{
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('fdc-dark', document.documentElement.classList.contains('dark') ? '1':'0');
  });
  if(localStorage.getItem('fdc-dark')==='1'){
    document.documentElement.classList.add('dark');
  }

  // Presets
  function pillsSetup(){
    const setTarget = (v)=>{ document.getElementById('calTarget').value = v; localStorage.setItem('fdc-cal', v); };
    document.getElementById('presetCut').onclick = ()=> setTarget(600);
    document.getElementById('presetMaintain').onclick = ()=> setTarget(750);
    document.getElementById('presetHighP').onclick = ()=> setTarget(650);
    const savedCal = localStorage.getItem('fdc-cal'); if(savedCal) setTarget(savedCal);
  }
  pillsSetup();

  // iframe auto-resize
  function postHeight(){
    const h = document.body.scrollHeight;
    parent.postMessage({type:"fdc-resize", height:h}, "*");
  }
  setInterval(postHeight, 700);

  // Toast
  function toast(msg){
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(()=>{ el.remove(); }, 2800);
  }

  // Skeleton renderer
  function skeletonRestaurants(target, n=3){
    target.innerHTML = '';
    for(let i=0;i<n;i++){
      const s = document.createElement('div');
      s.className = 'card';
      s.innerHTML = `
        <div class="flex items-center gap-2">
          <div class="skel h-6 w-32"></div>
          <div class="skel h-4 w-12 ml-auto"></div>
        </div>
        <div class="mt-2 grid gap-2">
          <div class="skel-line"></div>
          <div class="skel-line w-2/3"></div>
        </div>`;
      target.appendChild(s);
    }
  }

  // Shared flag collector
  function collectFlags(suffix=''){
    const low = document.getElementById('lowCarb'+suffix)?.checked ? ['low_carb']:[];
    const nf  = document.getElementById('noFried'+suffix)?.checked ? ['no_fried']:[];
    return [...low, ...nf];
  }

  // ZIP search
  document.getElementById('zipForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const zip = document.getElementById('zip').value.trim();
    const radius = parseFloat(document.getElementById('radius').value||'3');
    const onlyChains = document.getElementById('onlyChains').checked;
    const calTarget = parseInt(document.getElementById('calTarget').value||'600',10);
    const flags = collectFlags('');
    const el = document.getElementById('zipResults');
    skeletonRestaurants(el, 3);
    try{
      const res = await fetch(`${ORIGIN}/nearby-by-zip`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({zip, radius_miles: radius, only_chains: onlyChains, calorie_target: calTarget, flags, prioritize_protein: document.getElementById('prioritizeProtein').checked})
      });
      const data = await res.json();
      if(data.error){ el.innerHTML = `<p class="text-sm">${data.error}</p>`; return; }
      renderZipResults(data);
      toast(`Found ${data.restaurants?.length||0} restaurants`);
    }catch(err){
      el.innerHTML = `<p class="text-sm">Error loading results.</p>`;
    }
  });

  function renderZipResults(data){
    const wrap = document.getElementById('zipResults');
    wrap.innerHTML='';
    const items = data.restaurants||[];
    if(items.length===0){
      wrap.innerHTML = '<p class="text-sm opacity-80">No restaurants found. Try increasing the radius.</p>';
      return;
    }
    items.forEach(r=> wrap.appendChild(renderRestaurantCard(r)));
  }

  function proteinBar(kcal, protein, target){
    const closeness = Math.max(0, 1 - Math.abs(kcal-target)/Math.max(target,200));
    const pct = Math.min(100, Math.round((protein/60)*100));
    return `<div class="mt-2">
      <div class="text-[11px] opacity-70">Target fit: ${(closeness*100|0)}% • Protein: ${protein}g</div>
      <div class="h-2 w-full bg-zinc-800 rounded-full mt-1 overflow-hidden">
        <div class="h-full bg-gradient-to-r from-indigo-500 to-emerald-500" style="width:${pct}%"></div>
      </div>
    </div>`;
  }

  function renderRestaurantCard(r){
    const card = document.createElement('div');
    card.className = 'card hover-lift';
    const picks = (r.picks||[]).map(p=>`
      <div class="mt-2 p-3 rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div class="flex items-center gap-2">
          <span class="badge">${p.confidence||'low'}</span>
          <span class="text-sm font-semibold">${p.item_name||p.name||'Item'}</span>
          <span class="text-xs opacity-70 ml-auto">${p.est_kcal||'—'} kcal • ${p.est_protein_g||'—'} g</span>
        </div>
        <div class="text-[12px] mt-1 opacity-80">${(p.modifiers||[]).join(' • ')}</div>
        ${proteinBar(p.est_kcal||0, p.est_protein_g||0, parseInt(document.getElementById('calTarget').value||'600',10))}
        <div class="mt-2 flex items-center gap-2">
          <button class="btn-ghost text-xs" onclick="navigator.clipboard.writeText('${(p.server_script||'').replace(/'/g,\"\\'\")}')">Copy server ask</button>
          ${p.qr_data_uri ? `<img src="${p.qr_data_uri}" alt="qr" class="h-10 w-10 rounded-lg border border-zinc-800 ml-auto">` : ''}
        </div>
        <details class="mt-2">
          <summary class="text-xs underline">Evidence</summary>
          <pre class="code mt-1">${JSON.stringify(p.evidence||{}, null, 2)}</pre>
        </details>
      </div>
    `).join('');
    card.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="text-base font-semibold">${r.name}</div>
        <span class="badge">${r.source}</span>
        <span class="text-xs opacity-70">${r.distance_mi ?? ''} mi</span>
        ${r.website?`<a class="text-xs underline ml-auto" href="${r.website}" target="_blank">Website</a>`:''}
      </div>
      <div class="text-xs opacity-70">${(r.cuisine||[]).join(', ')}</div>
      ${picks || '<div class="text-xs mt-2">No picks yet.</div>'}
    `;
    return card;
  }

  // Analyze URL (uses its own flags so the ZIP flags don't override)
  document.getElementById('analyzeUrlForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const url = document.getElementById('menuUrl').value.trim();
    const params = {
      calorie_target: parseInt(document.getElementById('calTarget').value||'600',10),
      prioritize_protein: document.getElementById('prioritizeProteinURL').checked,
      flags: collectFlags('URL')
    };
    const el = document.getElementById('zipResults');
    skeletonRestaurants(el, 1);
    const res = await fetch(`${ORIGIN}/analyze-url`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url, params})});
    const data = await res.json();
    if(data.error){ el.innerHTML = `<p class="text-sm">${data.error}</p>`; return; }
    // Show result using same renderer
    const picks = data.restaurants?.[0]?.picks || data.picks || data.alternates || [];
    const card = renderRestaurantCard({name:data.context?.restaurant_name||'Menu', distance_mi:null, cuisine:[], website:url, source:'menu', picks});
    el.innerHTML='';
    el.appendChild(card);
    toast('Menu analyzed');
  });

  // Analyze PDF
  document.getElementById('pdfForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = document.getElementById('pdfFile').files[0];
    if(!f) return;
    const fd = new FormData();
    fd.append('pdf', f);
    fd.append('ocr', document.getElementById('enableOCR').checked ? '1':'0');
    fd.append('params', JSON.stringify({
      calorie_target: parseInt(document.getElementById('calTarget').value||'600',10),
      prioritize_protein: document.getElementById('prioritizeProtein').checked,
      flags: collectFlags('')
    }));
    const el = document.getElementById('zipResults');
    skeletonRestaurants(el, 1);
    const res = await fetch(`${ORIGIN}/analyze-pdf`, {method:'POST', body: fd});
    const data = await res.json();
    if(data.error){ el.innerHTML = `<p class="text-sm">${data.error}</p>`; return; }
    const picks = data.restaurants?.[0]?.picks || data.picks || data.alternates || [];
    const card = renderRestaurantCard({name:data.context?.restaurant_name||'PDF Menu', distance_mi:null, cuisine:[], website:null, source:'menu', picks});
    el.innerHTML='';
    el.appendChild(card);
    toast('PDF analyzed');
  });

  // OFF
  document.getElementById('offBtn').addEventListener('click', async ()=>{
    const q = document.getElementById('offQuery').value.trim();
    if(!q) return;
    const r = await fetch(`${ORIGIN}/openfoodfacts?q=`+encodeURIComponent(q));
    const data = await r.json();
    const el = document.getElementById('offResults');
    el.innerHTML = (data.items||[]).map(i=>`<div class="card">
      <div class="font-semibold">${i.name||'Unknown'} <span class="opacity-60">${i.brand||''}</span></div>
      <div class="text-xs">${i.energy_kcal_per_100g ?? '—'} kcal/100g • ${i.protein_per_100g ?? '—'} g protein/100g</div>
      <div class="text-xs opacity-70 mt-1">Serving: ${i.serving_size||'n/a'}</div>
    </div>`).join('');
  });
})();