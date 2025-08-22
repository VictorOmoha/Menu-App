(function () {
  function run() {
    try {
      var bg = document.getElementById('hero-bg');
      var card = document.getElementById('hero-card');
      if (!bg || !card) { console.log('[hero] elements not found'); return; }
      function setMode(mode) {
        if (mode === 'bg') {
          bg.classList.remove('hidden');
          card.classList.add('hidden');
        } else {
          card.classList.remove('hidden');
          bg.classList.add('hidden');
        }
        try { console.log('[hero] switched-to', mode); } catch {}
      }
      function nextMode() {
        var isBgVisible = !bg.classList.contains('hidden');
        return isBgVisible ? 'card' : 'bg';
      }
      function schedule() {
        var delay = 10000 + Math.floor(Math.random() * 5000);
        try { console.log('[hero] next-switch-in-ms', delay); } catch {}
        setTimeout(function () {
          setMode(nextMode());
          schedule();
        }, delay);
      }
      schedule();
    } catch (e) { try { console.warn('[hero] error', e); } catch {} }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
