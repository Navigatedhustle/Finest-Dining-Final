(function(){
  function ready(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  function setStatus(ok,msg){
    var d=document.getElementById('statusDot'), t=document.getElementById('statusText');
    if(d) d.style.background = ok ? '#22c55e' : '#ef4444';
    if(t) t.textContent = msg;
  }
  window.bootSeen = true;
  window.addEventListener('error', function(e){
    try{ setStatus(false, 'JS error: ' + (e.message||'unknown')); }catch(_){}
  });
  window.addEventListener('unhandledrejection', function(e){
    try{ setStatus(false, 'Promise error: ' + (e.reason && (e.reason.message||e.reason)) ); }catch(_){}
  });
  ready(function(){ setStatus(true, 'Boot OK — loading app…'); });
})();