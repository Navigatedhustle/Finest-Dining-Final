(function(){
  function ready(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  function $(id){ return document.getElementById(id); }
  function setStatus(ok,msg){
    var d=$('statusDot'), t=$('statusText');
    if(d){ d.style.background = ok ? '#22c55e' : '#ef4444'; }
    if(t){ t.textContent = msg; }
  }
  function toast(msg){
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.position='fixed'; el.style.bottom='16px'; el.style.left='50%'; el.style.transform='translateX(-50%)';
    el.style.padding='10px 14px'; el.style.background='#111'; el.style.color='#fff'; el.style.borderRadius='10px';
    el.style.fontSize='12px'; el.style.opacity='0.95'; el.style.zIndex='9999';
    document.body.appendChild(el); setTimeout(function(){ document.body.removeChild(el); }, 2200);
  }
  function addNet(method,url,status,ms){
    var list = $('netList'); if(!list) return;
    var d = document.createElement('div'); d.className='card';
    var u = String(url||'').replace(/^https?:\/\/[^/]+/,'');
    if(u.length>88) u = u.slice(0,88)+'...';
    d.textContent = method+' '+u+' -> '+status+' ('+ms+'ms)';
    list.insertBefore(d, list.firstChild);
    while(list.children.length>5){ list.removeChild(list.lastChild); }
  }
  function postJSON(url, payload, onOk, onErr){
    var t0 = Date.now();
    fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)})
      .then(function(r){ addNet('POST',url,r.status,Date.now()-t0); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(onOk).catch(function(e){ if(onErr) onErr(e); else { console.error(e); toast('Request failed'); setStatus(false, e.message||'Request failed'); } });
  }
  function renderResults(data){
    var wrap = $('results'); if(!wrap) return;
    wrap.innerHTML = '';
    if(!data || !data.restaurants || !data.restaurants.length){ wrap.textContent='No results.'; return; }
    for(var i=0;i<data.restaurants.length;i++){
      var r = data.restaurants[i];
      var card = document.createElement('div'); card.className='card';
      var h = document.createElement('div'); h.className='card-header';
      h.textContent = (r.name||'Restaurant') + (r.distance_mi?(' · '+Number(r.distance_mi).toFixed(2)+' mi'):'') + (r.source?(' · '+String(r.source).toUpperCase()):'');
      var c = document.createElement('div'); c.className='card-content';
      if(r.website){ var a=document.createElement('a'); a.href=r.website; a.target='_blank'; a.rel='noopener'; a.textContent='Website'; a.className='btn-ghost'; c.appendChild(a); }
      if(r.cuisine && r.cuisine.length){ var p=document.createElement('div'); p.className='pills'; p.textContent='Cuisine: '+r.cuisine.join(', '); c.appendChild(p); }
      if(r.picks && r.picks.length){
        for(var j=0;j<Math.min(2,r.picks.length);j++){
          var pk = r.picks[j] || {};
          var pc = document.createElement('div'); pc.className='pick';
          var t = document.createElement('div'); t.className='pick-title'; t.textContent = (pk.item_name||'Pick');
          var meta = []; if(pk.est_kcal) meta.push('~'+pk.est_kcal+' kcal'); if(pk.est_protein_g) meta.push(pk.est_protein_g+' g protein'); if(pk.confidence) meta.push(pk.confidence);
          var m = document.createElement('div'); m.className='pick-meta'; m.textContent = meta.join(' · ');
          var s = document.createElement('div'); s.className='pick-script'; s.textContent = pk.server_script || '';
          var b = document.createElement('button'); b.className='btn-ghost'; b.textContent='Copy ask'; b.addEventListener('click', (function(text){ return function(){ try{ navigator.clipboard.writeText(text||''); toast('Copied'); }catch(_){ } }; })(pk.server_script||''));
          pc.appendChild(t); pc.appendChild(m); pc.appendChild(s); pc.appendChild(b);
          c.appendChild(pc);
        }
      }
      card.appendChild(h); card.appendChild(c); wrap.appendChild(card);
    }
    window.scrollTo({top:wrap.offsetTop-10, behavior:'smooth'});
  }
  function collectFlags(){
    var flags=[]; var els=document.querySelectorAll('[name="flags"]'); for(var i=0;i<els.length;i++){ if(els[i].checked) flags.push(els[i].value); }
    return flags;
  }
  function getCalTarget(){ var el=document.querySelector('[name="calorie_target"]'); var v=parseInt((el && el.value)||600,10); return isNaN(v)?600:v; }
  function isProt(){ var el=document.querySelector('[name="prioritize_protein"]'); return !!(el && el.checked); }

  function triggerSearch(zip, rmi){
    var zipEl = $('zipInput'), radEl = $('radiusInput'); 
    zip = (zip || (zipEl && zipEl.value) || '').trim();
    rmi = rmi || parseFloat((radEl && radEl.value)||'3');
    if(!/^\d{5}$/.test(zip)){ setStatus(false,'Enter 5-digit ZIP'); toast('Enter 5-digit ZIP'); return; }
    var chainsEl = document.querySelector('[name="only_chains"]');
    var payload = {
      zip: zip,
      radius_miles: isNaN(rmi)?3:rmi,
      only_chains: !!(chainsEl && chainsEl.checked),
      calorie_target: getCalTarget(),
      flags: collectFlags(),
      prioritize_protein: isProt()
    };
    setStatus(true,'Searching...');
    postJSON('/nearby-by-zip', payload, function(data){ setStatus(true,'Done'); renderResults(data); });
  }

  function triggerAnalyzeUrl(url){
    var urlEl = $('menuUrl') || $('menuUrlInput');
    url = (url || (urlEl && urlEl.value) || '').trim();
    if(!/^https?:\/\//i.test(url)){ setStatus(false,'Enter a valid http(s) URL'); toast('Enter a valid http(s) URL'); return; }
    var payload = { url: url, params: { calorie_target: getCalTarget(), flags: collectFlags(), prioritize_protein: isProt() } };
    setStatus(true,'Analyzing URL...');
    postJSON('/analyze-url', payload, function(data){ setStatus(true,'Done'); renderResults(data); });
  }

  ready(function(){
    try{
      setStatus(true, 'JS loaded — ready');

      // Button clicks
      var searchBtn = $('searchBtn'); if(searchBtn){ searchBtn.addEventListener('click', function(){ triggerSearch(); }); }
      var analyzeBtn = $('analyzeUrlBtn'); if(analyzeBtn){ analyzeBtn.addEventListener('click', function(){ triggerAnalyzeUrl(); }); }

      // Prevent default form submits that cause GET ?zip=…
      var zf = $('zipForm') || document.querySelector('form[action="/"]'); 
      if(zf){ zf.addEventListener('submit', function(e){ e.preventDefault(); triggerSearch(); }); }

      var uf = $('urlForm') || document.querySelector('form[action="/"] ~ form'); 
      if(uf){ uf.addEventListener('submit', function(e){ e.preventDefault(); triggerAnalyzeUrl(); }); }

      // Deep fallback: if page loaded with ?zip=... (e.g., user hit Enter), run search client-side.
      try{
        var params = new URLSearchParams(location.search);
        var pzip = params.get('zip'); var pr = params.get('radius_miles');
        if(pzip && /^\d{5}$/.test(pzip)){ triggerSearch(pzip, parseFloat(pr||'3')); history.replaceState(null,'',location.pathname); }
      }catch(_){}

      // Test network button
      var testBtn = $('testNetworkBtn'); if(testBtn){ testBtn.addEventListener('click', function(){
        var t0=Date.now();
        fetch('/_ping').then(function(r){ addNet('GET','/_ping',r.status,Date.now()-t0); return r.text(); })
        .then(function(txt){ setStatus(true, 'Network OK: '+txt); }).catch(function(){ setStatus(false,'Ping failed'); });
      });}
    }catch(e){
      console.error(e); setStatus(false,'JS error: '+(e.message||'unknown'));
    }
  });
})();