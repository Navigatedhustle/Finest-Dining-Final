// minimal Alpine-like helpers not required since Alpine loaded
(function(){
  const darkToggle = document.getElementById('darkToggle');
  darkToggle?.addEventListener('click', ()=>{
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('fdc-dark', document.documentElement.classList.contains('dark') ? '1':'0');
  });
  if(localStorage.getItem('fdc-dark')==='1'){
    document.documentElement.classList.add('dark');
  }

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
  setInterval(postHeight, 800);

  // ZIP search
  document.getElementById('zipForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const zip = document.getElementById('zip').value.trim();
    const radius = parseFloat(document.getElementById('radius').value||'3');
    const onlyChains = document.getElementById('onlyChains').checked;
    const calTarget = parseInt(document.getElementById('calTarget').value||'600',10);
    const flags = [];
    if(document.getElementById('lowCarb').checked) flags.push('low_carb');
    if(document.getElementById('noFried').checked) flags.push('no_fried');
    const res = await fetch('/nearby-by-zip', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({zip, radius_miles: radius, only_chains: onlyChains, calorie_target: calTarget, flags, prioritize_protein: document.getElementById('prioritizeProtein').checked})
    });
    const data = await res.json();
    renderZipResults(data);
  });

  function renderZipResults(data){
    const el = document.getElementById('zipResults');
    el.innerHTML='';
    if(!data.restaurants || data.restaurants.length===0){
      el.innerHTML = '<p class="text-sm">No restaurants found. Try a bigger radius.</p>';
      return;
    }
    data.restaurants.forEach(r=>{
      const card = document.createElement('div');
      card.className='card';
      const picksHtml = (r.picks||[]).map(p=>`
        <div class="mt-2 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-900">
          <div class="flex items-center gap-2">
            <span class="badge">${p.confidence}</span>
            <span class="text-sm font-semibold">${p.item_name}</span>
            <span class="text-xs opacity-70 ml-auto">${p.est_kcal} kcal • ${p.est_protein_g} g protein</span>
          </div>
          <div class="text-xs mt-1">${(p.modifiers||[]).join(' • ')}</div>
          <div class="text-xs mt-1 opacity-80">${p.why_it_works||''}</div>
          <button class="text-xs underline mt-1" onclick="navigator.clipboard.writeText('${(p.server_script||'').replace(/'/g,\"\\'\")}')">Copy server ask</button>
          <details class="mt-1"><summary class="text-xs underline">Evidence</summary><pre class="code">${JSON.stringify(p.evidence||{}, null, 2)}</pre></details>
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
        ${picksHtml || '<div class="text-xs mt-2">No picks yet.</div>'}
      `;
      el.appendChild(card);
    });
  }

  // Analyze URL
  document.getElementById('analyzeUrlForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const url = document.getElementById('menuUrl').value.trim();
    const body = {
      url,
      params: {
        calorie_target: parseInt(document.getElementById('calTarget').value||'600',10),
        prioritize_protein: document.getElementById('prioritizeProtein').checked,
        flags: [
          ...(document.getElementById('lowCarb').checked?['low_carb']:[]),
          ...(document.getElementById('noFried').checked?['no_fried']:[])
        ]
      }
    };
    const res = await fetch('/analyze-url', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    const data = await res.json();
    renderZipResults({restaurants:[{name:data.context.restaurant_name||'Menu', distance_mi:null, cuisine:[], website:url, source:data.context.source==='html'?'menu':'menu', picks:data.restaurants?.[0]?.picks || data.picks || data.alternates || []}]});
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
      flags: [
        ...(document.getElementById('lowCarb').checked?['low_carb']:[]),
        ...(document.getElementById('noFried').checked?['no_fried']:[])
      ]
    }));
    const res = await fetch('/analyze-pdf', {method:'POST', body: fd});
    const data = await res.json();
    renderZipResults({restaurants:[{name:data.context.restaurant_name||'PDF Menu', distance_mi:null, cuisine:[], website:null, source:'menu', picks:data.restaurants?.[0]?.picks || data.picks || data.alternates || []}]});
  });

  // OFF
  document.getElementById('offBtn').addEventListener('click', async ()=>{
    const q = document.getElementById('offQuery').value.trim();
    const r = await fetch('/openfoodfacts?q='+encodeURIComponent(q));
    const data = await r.json();
    const el = document.getElementById('offResults');
    el.innerHTML = (data.items||[]).map(i=>`<div class="text-xs p-2 rounded bg-zinc-50 dark:bg-zinc-900">
      <div class="font-semibold">${i.name||'Unknown'} <span class="opacity-60">${i.brand||''}</span></div>
      <div>${i.energy_kcal_per_100g ?? '—'} kcal/100g • ${i.protein_per_100g ?? '—'} g protein/100g</div>
      <div class="opacity-70">Serving: ${i.serving_size||'n/a'}</div>
    </div>`).join('');
  });
})();
