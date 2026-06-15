(() => {
  const KEY = 'tttSiteStats.v1';
  const defaultStats = { visits: 0, wins: {}, gamesStarted: 0 };
  const load = () => {
    try { return { ...defaultStats, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
    catch { return { ...defaultStats }; }
  };
  const save = (stats) => localStorage.setItem(KEY, JSON.stringify(stats));
  const stats = load();
  stats.visits += 1; save(stats);
  window.SiteKit = {
    stats,
    saveStats: () => save(stats),
    recordGameStart(name) { stats.gamesStarted += 1; stats.lastGame = name; save(stats); window.SiteKit.renderStats(); },
    recordWin(game, winner) { const key = `${game}:${winner}`; stats.wins[key] = (stats.wins[key] || 0) + 1; save(stats); window.SiteKit.confetti(); window.SiteKit.beep(660, 0.08); },
    renderStats() {
      document.querySelectorAll('[data-stat="visits"]').forEach(el => el.textContent = stats.visits);
      document.querySelectorAll('[data-stat="gamesStarted"]').forEach(el => el.textContent = stats.gamesStarted);
      document.querySelectorAll('[data-stat="lastGame"]').forEach(el => el.textContent = stats.lastGame || 'まだありません');
    },
    openModal(id) { document.getElementById(id)?.classList.add('is-open'); },
    closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); },
    hideLoading() { document.querySelector('.loading-overlay')?.classList.add('is-hidden'); },
    confetti() {
      const colors = ['#79f2c0', '#7aa7ff', '#ffd166', '#ff6b6b', '#ffffff'];
      for (let i = 0; i < 50; i++) {
        const p = document.createElement('span'); p.className = 'confetti-piece';
        p.style.left = `${Math.random() * 100}vw`; p.style.background = colors[i % colors.length];
        p.style.animationDelay = `${Math.random() * .35}s`; p.style.transform = `rotate(${Math.random()*180}deg)`;
        document.body.appendChild(p); setTimeout(() => p.remove(), 1800);
      }
    },
    beep(freq = 440, duration = .04) {
      if (localStorage.getItem('tttMuted') === '1') return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.frequency.value = freq; gain.gain.value = .025; osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); setTimeout(() => { osc.stop(); ctx.close(); }, duration * 1000);
      } catch {}
    },
    toggleMute(btn) { const muted = localStorage.getItem('tttMuted') === '1'; localStorage.setItem('tttMuted', muted ? '0' : '1'); if (btn) btn.textContent = muted ? '音: ON' : '音: OFF'; }
  };
  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close-modal]'); if (close) window.SiteKit.closeModal(close.dataset.closeModal);
    const open = e.target.closest('[data-open-modal]'); if (open) window.SiteKit.openModal(open.dataset.openModal);
  });
  document.addEventListener('DOMContentLoaded', () => { window.SiteKit.renderStats(); setTimeout(window.SiteKit.hideLoading, 450); });
})();
