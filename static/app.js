(function(){
  function log(){ if(window.console && console.log){ console.log.apply(console, ['[FDC]'].concat([].slice.call(arguments))); } }
  function onReady(fn){
    if(document.readyState !== 'loading'){ fn(); }
    else { document.addEventListener('DOMContentLoaded', fn); }
  }
  onReady(function(){
    // Network console
    var netList = document.getElementById('netList');
    var netClear = document.getElementById('netClearBtn');
    function addNetLog(entry){
      try{
        if(!netList) return;
        var d = document.createElement('div');
        d.className = 'card';
        var u = String(entry.url||'').replace(/^https?:\/\/[^/]+/,''); 
        if(u.length > 88) u = u.slice(0,88)+'…';
        d.textContent = (entry.method||'GET') + ' ' + u + ' → ' + (entry.status||'ERR') + ' ('+(entry.ms||0)+'ms)';
        netList.insertBefore(d, netList.firstChild);
        while(netList.children.length > 5){ netList.removeChild(netList.lastChild); }
      }catch(_e){}
    }
    if(netClear){ netClear.addEventListener('click', function(){ if(netList) netList.innerHTML=''; }); }
    if(!window.__fdcFetchPatched && window.fetch){
      window.__fdcFetchPatched = true;
      var _f = window.fetch;
      window.fetch = function(input, init){
        var method = (init && init.method) || 'GET';
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var t0 = Date.now();
        return _f(input, init).then(function(res){
          addNetLog({method:method, url:url, status:res.status, ms: Date.now()-t0});
          return res;
        }).catch(function(err){
          addNetLog({method:method, url:url, status:'ERR', ms: Date.now()-t0});
          throw err;
        });
      };
    }

    var ORIGIN = window.location.origin;

    // Theme toggle (no optional chaining)
    var darkToggle = document.getElementById('darkToggle');
    if(darkToggle){
      darkToggle.addEventListener('click', function(){
        var c = document.documentElement.classList;
        if(c.contains('dark')){ c.remove('dark'); localStorage.setItem('fdc-dark','0'); }
        else { c.add('dark'); localStorage.setItem('fdc-dark','1'); }
      });
    }
    if(localStorage.getItem('fdc-dark')==='1'){ document.documentElement.classList.add('dark'); }

    // Presets
    function setTarget(v){
      var cal = document.getElementById('calTarget');
      if(cal){ cal.value = v; localStorage.setItem('fdc-cal', v); }
    }
    var savedCal = localStorage.getItem('fdc-cal');
    if(savedCal){ setTarget(savedCal); }
    var pc=document.getElementById('presetCut'), pm=document.getElementById('presetMaintain'), ph=document.getElementById('presetHighP');
    if(pc) pc.onclick=function(){ setTarget(600); };
    if(pm) pm.onclick=function(){ setTarget(750); };
    if(ph) ph.onclick=function(){ setTarget(650); };

    // Status ribbon
    var statusDot = document.getElementById('statusDot');
    var statusText = document.getElementById('statusText');
    function setStatus(ok, msg){
      if(statusDot){ statusDot.style.background = ok ? '#22c55e' : '#ef4444'; }
      if(statusText){ statusText.textContent = msg; }
    }
    if(statusDot || statusText){ setStatus(true, 'JS loaded — ready'); }

    var testBtn = document.getElementById('testNetworkBtn');
    if(testBtn){
      testBtn.addEventListener('click', function(){
        fetch(ORIGIN + '/_ping').then(function(r){ return r.json(); }).then(function(j){
          setStatus(true, 'Network OK: ' + (j.message||'pong'));
        }).catch(function(){
          setStatus(false, 'Network blocked — check proxy/CSP');
        });
      });
    }

    // Utilities
    function toast(msg){
      var el = document.createElement('div');
      el.className = 'toast';
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(function(){ el.parentNode && el.parentNode.removeChild(el); }, 2800);
    }
    function validZip(z){ return /^\d{5}(-\d{4})?$/.test((z||'').replace(/\s+/g,'')); }
    function collectFlags(suffix){
      if(!suffix) suffix = '';
      var out = [];
      var low = document.getElementById('lowCarb'+suffix);
      var nf  = document.getElementById('noFried'+suffix);
      if(low && low.checked) out.push('low_carb');
      if(nf && nf.checked) out.push('no_fried');
      return out;
    }
    function proteinBar(kcal, protein, target){
      kcal = Number(kcal||0); protein = Number(protein||0); target = Number(target||600);
      var closeness = Math.max(0, 1 - Math.abs(kcal-target)/Math.max(target,200));
      var pct = Math.min(100, Math.round((protein/60)*100));
      return '<div class="mt-2">\
      <div class="text-[11px] opacity-70">Target fit: ' + (closeness*100|0) + '% • Protein: ' + protein + 'g</div>\
      <div class="h-2 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full mt-1 overflow-hidden">\
        <div class="h-full bg-gradient-to-r from-indigo-600 to-emerald-600" style="width:'+pct+'%"></div>\
      </div>\
    </div>';
    }
    function renderRestaurantCard(r){
      var card = document.createElement('div');
      card.className = 'card hover-lift';
      card.tabIndex = 0;
      var picks = '';
      var ps = (r.picks||[]);
      for(var i=0;i<ps.length;i++){
        var p = ps[i];
        picks += '<div class="mt-2 p-3 rounded-xl border border-zinc-200 dark:border-zinc-8 00 bg-zinc-50 dark:bg-zinc-900">\
          <div class="flex items-center gap-2">\
            <span class="badge">'+(p.confidence||'low')+'</span>\
            <span class="text-sm font-semibold">'+(p.item_name||p.name||'Item')+'</span>\
            <span class="text-xs opacity-70 ml-auto">'+(p.est_kcal||'—')+' kcal • '+(p.est_protein_g||'—')+' g</span>\
          </div>\
          <div class="text-[12px] mt-1 opacity-80">'+((p.modifiers||[]).join(' • '))+'</div>\
          '+proteinBar(p.est_kcal||0, p.est_protein_g||0, parseInt(document.getElementById('calTarget').value||'600',10))+'\
          <div class="mt-2 flex items-center gap-2">\
            <button class="btn-ghost text-xs" onclick="navigator.clipboard.writeText(\''+String((p.server_script||'')).replace(/'/g,\"\\'\")+'\')"><span class="btn-icon">📋</span> Copy ask</button>\
            '+(p.qr_data_uri ? '<img src="'+p.qr_data_uri+'" alt="qr" class="h-10 w-10 rounded-lg border border-zinc-200 dark:border-zinc-800 ml-auto">' : '')+'\
          </div>\
        </div>';
      }
      card.innerHTML = '<div class="flex items-center gap-2">\
        <div class="text-base font-semibold">'+(r.name||'')+'</div>\
        <span class="badge">'+(r.source||'')+'</span>\
        <span class="text-xs opacity-70">'+(r.distance_mi!=null?r.distance_mi+' mi':'')+'</span>\
        '+(r.website?'<a class="btn-ghost text-xs ml-auto" href="'+r.website+'" target="_blank"><span class="btn-icon">↗</span> Website</a>':'')+'\
      </div>\
      <div class="text-xs opacity-70">'+((r.cuisine||[]).join(', '))+'</div>\
      '+(picks || '<div class="text-xs mt-2">No picks yet.</div>');
      return card;
    }
    function renderZipResults(data){
      var wrap = document.getElementById('zipResults');
      wrap.innerHTML='';
      var items = data.restaurants||[];
      if(items.length===0){
        wrap.innerHTML = '<p class="text-sm opacity-80">No restaurants found. Try increasing the radius.</p>';
        return;
      }
      for(var i=0;i<items.length;i++){
        wrap.appendChild(renderRestaurantCard(items[i]));
      }
    }

    // ZIP form
    var zipForm = document.getElementById('zipForm');
    if(zipForm){
      zipForm.addEventListener('submit', function(e){
        // Progressive enhancement: if fetch exists, use JSON POST; else let form submit normally to -test endpoint
        if(!window.fetch){ return; }
        e.preventDefault();
        log('zip submit');
        var zipEl = document.getElementById('zip');
        var zip = (zipEl && zipEl.value || '').trim();
        if(!validZip(zip)){ if(zipEl) zipEl.focus(); toast('Please enter a valid ZIP (12345 or 12345-6789).'); return; }
        var radius = parseFloat((document.getElementById('radius')||{}).value || '3');
        var onlyChains = !!((document.getElementById('onlyChains')||{}).checked);
        var calTarget = parseInt((document.getElementById('calTarget')||{}).value || '600', 10);
        var flags = collectFlags('');
        var el = document.getElementById('zipResults');
        el.innerHTML = '<div class="card skel h-10"></div>';
        fetch(ORIGIN + '/nearby-by-zip', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({zip:zip, radius_miles: radius, only_chains: onlyChains, calorie_target: calTarget, flags: flags, prioritize_protein: true})
        }).then(function(r){ return r.json(); }).then(function(data){
          if(data.error){ el.innerHTML = '<p class="text-sm">'+data.error+'</p>'; return; }
          renderZipResults(data);
          toast('Found '+((data.restaurants||[]).length||0)+' restaurants');
        }).catch(function(err){
          el.innerHTML = '<p class="text-sm">Error loading results.</p>';
          if(statusText) setStatus(false, 'Fetch error (ZIP)');
          log('nearby error', err);
        });
      });
    }

    // Analyze URL form
    var analyzeForm = document.getElementById('analyzeUrlForm');
    if(analyzeForm){
      analyzeForm.addEventListener('submit', function(e){
        if(!window.fetch){ return; } // allow GET fallback
        e.preventDefault();
        log('analyze url submit');
        var urlEl = document.getElementById('menuUrl');
        var url = (urlEl && urlEl.value || '').trim();
        if(!/^https?:\/\//i.test(url)){ if(urlEl) urlEl.focus(); toast('Please paste a valid http(s) menu URL.'); return; }
        var params = {
          calorie_target: parseInt((document.getElementById('calTarget')||{}).value || '600', 10),
          prioritize_protein: (document.getElementById('prioritizeProteinURL')||{checked:true}).checked,
          flags: collectFlags('URL')
        };
        var el = document.getElementById('zipResults');
        el.innerHTML = '<div class="card skel h-10"></div>';
        fetch(ORIGIN + '/analyze-url', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url:url, params:params})})
          .then(function(r){ return r.json(); })
          .then(function(data){
            if(data.error){ el.innerHTML = '<p class="text-sm">'+data.error+'</p>'; return; }
            var picks = (data.restaurants && data.restaurants[0] && data.restaurants[0].picks) || data.picks || data.alternates || [];
            var card = renderRestaurantCard({name:(data.context && data.context.restaurant_name)||'Menu', distance_mi:null, cuisine:[], website:url, source:'menu', picks:picks});
            el.innerHTML='';
            el.appendChild(card);
            toast('Menu analyzed');
          }).catch(function(err){
            el.innerHTML = '<p class="text-sm">Error analyzing URL.</p>';
            if(statusText) setStatus(false, 'Fetch error (URL)');
            log('analyze url error', err);
          });
      });
    }

    // OFF search
    var offBtn = document.getElementById('offBtn');
    if(offBtn){
      offBtn.addEventListener('click', function(){
        var qEl = document.getElementById('offQuery');
        var q = (qEl && qEl.value || '').trim();
        if(!q){ toast('Type something to search.'); return; }
        fetch(ORIGIN + '/openfoodfacts?q=' + encodeURIComponent(q)).then(function(r){ return r.json(); }).then(function(data){
          var el = document.getElementById('offResults');
          var items = data.items || [];
          var html = '';
          for(var i=0;i<items.length;i++){
            var it = items[i];
            html += '<div class="card">\
              <div class="font-semibold">'+(it.name||'Unknown')+' <span class="opacity-60">'+(it.brand||'')+'</span></div>\
              <div class="text-xs">'+(it.energy_kcal_per_100g!=null?it.energy_kcal_per_100g:'—')+' kcal/100g • '+(it.protein_per_100g!=null?it.protein_per_100g:'—')+' g protein/100g</div>\
              <div class="text-xs opacity-70 mt-1">Serving: '+(it.serving_size||'n/a')+'</div>\
            </div>';
          }
          el.innerHTML = html;
        }).catch(function(){ if(statusText) setStatus(false, 'Fetch error (OFF)'); });
      });
    }

    // Safety: prevent default anchors with href="#"
    document.addEventListener('click', function(e){
      var t = e.target;
      if(t && t.getAttribute && t.getAttribute('href') === '#'){ e.preventDefault(); }
    });

    // Resize for embeds
    setInterval(function(){
      try{ parent.postMessage({type:'fdc-resize', height: document.body.scrollHeight}, '*'); }catch(_e){}
    }, 700);
  });
})();