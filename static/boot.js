
(function(){
  const btn=document.getElementById('darkToggle');
  function setMode(on){document.documentElement.classList.toggle('dark',!!on);localStorage.setItem('fdc-dark',on?'1':'0');}
  setMode(localStorage.getItem('fdc-dark')==='1');
  btn?.addEventListener('click',()=>setMode(!(localStorage.getItem('fdc-dark')==='1')));

  const s=document.querySelector('[data-status]');
  if(s){ s.textContent='Initializing…'; setTimeout(()=>{ if(s.getAttribute('data-status')!=='ok'){ s.setAttribute('data-status','ok'); s.textContent='Ready'; } },1500); }
})();
