(function(){
  function ready(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  function $(id){ return document.getElementById(id); }
  function setStatus(ok,msg){
    var d=$('statusDot'), t=$('statusText');
    if(d){ d.classList.remove('dot-ok','dot-warn'); d.style.background = ok ? '#22c55e' : '#ef4444'; }
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
    console.log('[NET]', method, url, status, ms+'ms');
  }
  function postJSON(url, payload, onOk, onErr){
    var t0 = Date.now();
    fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)})
      .then(function(r){ addNet('POST',url,r.status,Date.now()-t0); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(onOk).catch(function(e){ if(onErr) onErr(e); else { console.error(e); toast('Request failed'); setStatus(false, e.message||'Request failed'); } });
  }
  function chip(text, cls){
    var s = document.createElement('span'); s.className='chip '+(cls||''); s.textContent = text; return s;
  }
  function renderResults(data){
    var wrap = $('results'); if(!wrap) return;
    wrap.innerHTML = '';
    if(!data || !data.restaurants || !data.restaurants.length){ wrap.textContent='No results.'; return; }
    for(var i=0;i<data.restaurants.length;i++){
      var r = data.restaurants[i] || {};
      var rest = document.createElement('div'); rest.className='rest';
      var head = document.createElement('div'); head.className='rest-head';
      var left = document.createElement('div');
      var title = document.createElement('div'); title.className='rest-title'; title.textContent = r.name || 'Restaurant';
      var sub = document.createElement('div'); sub.className='pills';
      var badges = document.createElement('div'); badges.className='badges';
      if(r.distance_mi!=null) badges.appendChild(chip(Number(r.distance_mi).toFixed(2)+' mi',''));
      if(r.cuisine && r.cuisine.length) badges.appendChild(chip(r.cuisine.join(', '),''));
      badges.appendChild(chip(r.source==='menu'?'Parsed from Menu':'Playbook','badge '+(r.source==='menu'?'menu':'playbook')));
      sub.appendChild(badges);
      left.appendChild(title); left.appendChild(sub);
      head.appendChild(left);
      var right = document.createElement('div'); right.className='actions';
      if(r.website){ var a=document.createElement('a'); a.href=r.website; a.target='_blank'; a.rel='noopener'; a.className='btn-ghost'; a.textContent='Open website'; right.appendChild(a); }
      head.appendChild(right);
      rest.appendChild(head);

      var content = document.createElement('div'); content.className='card-content';
      if(r.picks && r.picks.length){
        for(var j=0;j<Math.min(2,r.picks.length);j++){
          var pk = r.picks[j] || {};
          var card = document.createElement('div'); card.className='pick';
          var t = document.createElement('div'); t.className='pick-title'; t.textContent = pk.item_name || 'Pick';
          var row = document.createElement('div'); row.className='pick-row';
          if(pk.est_kcal) row.appendChild(chip('~'+pk.est_kcal+' kcal','kcal'));
          if(pk.est_protein_g) row.appendChild(chip(pk.est_protein_g+' g protein','protein'));
          if(pk.confidence){
            var conf = (pk.confidence||'').toLowerCase();
            var cls = conf==='high'?'conf-high':(conf==='medium'?'conf-med':'conf-low');
            row.appendChild(chip('confidence: '+conf,cls));
          }
          var why = document.createElement('div'); why.className='help'; why.textContent = pk.why_it_works || '';
          var script = document.createElement('div'); script.className='pick-script'; script.textContent = pk.server_script || '';
          var actions = document.createElement('div'); actions.className='actions';
          var cpy = document.createElement('button'); cpy.className='btn-ghost'; cpy.textContent='Copy ask';
          cpy.addEventListener('click', (function(text){ return function(){ navigator.clipboard.writeText(text||''); toast('Copied'); }; })(pk.server_script||''));
          actions.appendChild(cpy);
          if(pk.modifiers && pk.modifiers.length){ actions.appendChild(chip('mods: '+pk.modifiers.join(', '),'')); }
          card.appendChild(t); card.appendChild(row); if(why.textContent) card.appendChild(why); card.appendChild(script); card.appendChild(actions);
          content.appendChild(card);
        }
      }
      rest.appendChild(content);
      wrap.appendChild(rest);
    }
    window.scrollTo({top:wrap.offsetTop-10, behavior:'smooth'});
  }

  function collectFlags(){ var flags=[]; var els=document.querySelectorAll('[name="flags"]'); for(var i=0;i<els.length;i++){ if(els[i].checked) flags.push(els[i].value); } return flags; }
  function getCal(){ var el=$('calTarget'); var v=parseInt((el && el.value)||600,10); return isNaN(v)?600:v; }
  function isProt(){ var el=$('prioProtein'); return !!(el && el.checked); }

  function triggerSearch(zip, rmi){
    var zipEl=$('zipInput'), radEl=$('radiusInput'), chainsEl=$('onlyChains');
    zip = (zip || (zipEl && zipEl.value) || '').trim();
    rmi = rmi || parseFloat((radEl && radEl.value)||'3');
    if(!/^\d{5}$/.test(zip)){ setStatus(false,'Enter 5-digit ZIP'); toast('Enter 5-digit ZIP'); return; }
    var payload = { zip: zip, radius_miles: isNaN(rmi)?3:rmi, only_chains: !!(chainsEl && chainsEl.checked), calorie_target: getCal(), flags: collectFlags(), prioritize_protein: isProt() };
    setStatus(true,'Searching...');
    postJSON('/nearby-by-zip', payload, function(data){ setStatus(true,'Done'); renderResults(data); });
  }

  function triggerAnalyzeUrl(url){
    var urlEl=$('menuUrl'); url = (url || (urlEl && urlEl.value) || '').trim();
    if(!/^https?:\/\//i.test(url)){ setStatus(false,'Enter a valid http(s) URL'); toast('Enter a valid http(s) URL'); return; }
    var payload = { url: url, params: { calorie_target: getCal(), flags: collectFlags(), prioritize_protein: isProt() } };
    setStatus(true,'Analyzing URL...');
    postJSON('/analyze-url', payload, function(data){ setStatus(true,'Done'); renderResults(data); });
  }

  ready(function(){
    try{
      setStatus(true,'JS loaded — ready');
      var sbtn=$('searchBtn'); if(sbtn){ sbtn.addEventListener('click', function(e){ e.preventDefault(); triggerSearch(); }); }
      var abtn=$('analyzeUrlBtn'); if(abtn){ abtn.addEventListener('click', function(e){ e.preventDefault(); triggerAnalyzeUrl(); }); }
      var zf=$('zipForm'); if(zf){ zf.addEventListener('submit', function(e){ e.preventDefault(); triggerSearch(); }); }
      var uf=$('urlForm'); if(uf){ uf.addEventListener('submit', function(e){ e.preventDefault(); triggerAnalyzeUrl(); }); }
      try{ var qs=new URLSearchParams(location.search); var pz=qs.get('zip'); var pr=qs.get('radius_miles'); if(pz && /^\d{5}$/.test(pz)){ triggerSearch(pz, parseFloat(pr||'3')); history.replaceState(null,'',location.pathname); } }catch(_){}
      var test=$('testNetworkBtn'); if(test){ test.addEventListener('click', function(){ var t0=Date.now(); fetch('/_ping').then(function(r){ addNet('GET','/_ping',r.status,Date.now()-t0); return r.text();}).then(function(txt){ setStatus(true,'Network OK: '+txt); }).catch(function(){ setStatus(false,'Ping failed'); }); }); }
    }catch(e){ console.error(e); setStatus(false,'JS error: '+(e.message||'unknown')); }
  });
})();