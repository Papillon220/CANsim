/* ==========================================================================
   CANsim – Einstieg: Reiterverwaltung, helle/dunkle Darstellung, Statusanzeige
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const TABS = { net: CS.NetTab, msg: CS.MsgTab, sim: CS.SimTab, bits: CS.BitsTab, err: CS.ErrTab, crc: CS.CrcTab, tools: CS.ToolsTab };
  let current = 'net';

  function showLastModified() {
    const set = (t) => document.querySelectorAll('.last-modified').forEach((el) => (el.textContent = new Date(t).toLocaleDateString('de-DE')));
    set(Date.parse(document.lastModified) || Date.now());
    if (!location.protocol.startsWith('http')) return;
    const urls = [location.href, ...[...document.scripts].map((s) => s.src), ...[...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href)]
      .filter((u) => u && new URL(u).origin === location.origin);
    Promise.all(urls.map((u) => fetch(u, { method: 'HEAD', cache: 'no-store' }).then((r) => Date.parse(r.headers.get('Last-Modified')) || 0, () => 0)))
      .then((ts) => { const t = Math.max(...ts); if (t) set(t); });
  }

  function showTab(name) {
    current = name;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    const btn = document.querySelector('.tab-btn.active'), nav = btn.parentElement, br = btn.getBoundingClientRect(), nr = nav.getBoundingClientRect();
    nav.scrollLeft += br.left - nr.left - (nr.width - br.width) / 2;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    for (const [k, t] of Object.entries(TABS)) if (t.setActive) t.setActive(k === name);
    if (name === 'net') CS.NetTab.onShow();
    try { localStorage.setItem('cansim-tab', name); } catch (e) { /* ignorieren */ }
  }
  CS.showTab = showTab;

  const THEMES = [['auto', '◐ Auto'], ['light', '☀ Hell'], ['dark', '☾ Dunkel']];
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme(t) {
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    document.getElementById('themeBtn').textContent = THEMES.find((x) => x[0] === t)[1];
    showTab(current); // Zeichenflächen mit neuen Farben neu zeichnen
    CS.NetTab.refresh();
  }

  function updateChip() {
    const chip = document.getElementById('simChip');
    chip.classList.toggle('run', CS.sim.running);
    document.getElementById('chipPlay').textContent = CS.sim.running ? '❚❚' : '▶';
    const load = CS.sim.t > 0.2 ? ' · Last ' + CS.fmt(CS.sim.load.value * 100, 1) + ' %' : '';
    const errs = CS.rx.errCount ? ' · ' + CS.rx.errCount + ' Error Frames' : '';
    document.getElementById('chipText').textContent = (CS.sim.running ? 't = ' : 'Pause · t = ') + CS.fmtFix(CS.sim.t, 2) + ' s' + load + errs;
  }

  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.version').forEach((el) => (el.textContent = CS.VERSION));
    showLastModified();
    CS.load();
    CS.sim.reset();
    for (const t of Object.values(TABS)) t.init();
    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    let tab = 'net';
    try { tab = localStorage.getItem('cansim-tab') || 'net'; } catch (e) { /* ignorieren */ }
    current = tab in TABS ? tab : 'net';
    applyTheme(document.documentElement.dataset.theme || 'auto');
    document.getElementById('themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme || 'auto';
      const next = THEMES[(THEMES.findIndex((x) => x[0] === cur) + 1) % THEMES.length][0];
      try { localStorage.setItem('cansim-theme', next); } catch (e) { /* ignorieren */ }
      applyTheme(next);
    });
    darkQuery.addEventListener('change', () => { if (!document.documentElement.dataset.theme) showTab(current); });
    document.getElementById('chipPlay').addEventListener('click', () => (CS.sim.running ? CS.sim.pause() : CS.sim.start()));
    CS.on('tick', updateChip);
    CS.on('sim-run', updateChip);
    CS.on('sim-reset', updateChip);
    updateChip();
  });
})();
