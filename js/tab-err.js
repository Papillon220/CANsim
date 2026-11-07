/* ==========================================================================
   CANsim – Reiter 5: Fehlermechanismen (Error Frames, TEC/REC, Zustände)
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS, h = CS.h, SIM = CS.sim;
  const T = (CS.ErrTab = {});
  let active = false, example = '1', tecPlot = null, lastDraw = 0, lastLogLen = -1;
  const ERR = { bit: 'Bit-Fehler', stuff: 'Stuff-Fehler', crc: 'CRC-Fehler', form: 'Form-Fehler', ack: 'ACK-Fehler' };
  const STATE_TXT = { active: 'Error Active', passive: 'Error Passive', busoff: 'Bus Off' };

  /* ---------------- Error-Frame-Diagramm ---------------- */
  function scenario(ex) {
    // pre: Buspegel vor der Fehlererkennung; starts: Beginn der Error Flags je Knoten (relativ zum Ende von pre)
    if (ex === '1') return {
      pre: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0], names: ['Knoten 1 (sendet & erkennt Fehler)', 'Knoten 2 (erkennt Fehler)', 'Knoten 3 (erkennt Fehler)'], starts: [0, 0, 0], kinds: ['P', 'P', 'P'],
      text: '<b>Beispiel 1 – 6 Error-Bits:</b> Alle Knoten erkennen den Fehler gleichzeitig (z. B. Form-Fehler im Delimiter). Jeder sendet ein Primary Active Error Flag; die dominanten Bits überlagern sich auf dem Bus. Ergebnis: 6 Flag-Bits + 8 Delimiter-Bits. Alle Knoten nehmen sich als „Entdecker“ wahr.'
    };
    if (ex === '2') return {
      pre: [1, 0, 1, 1, 0, 1, 0, 1, 0, 1], names: ['Knoten 1 (sendet, Bit-Fehler)', 'Knoten 2 (erkennt Stuff-Fehler)', 'Knoten 3 (erkennt Stuff-Fehler)'], starts: [0, 6, 6], kinds: ['P', 'S', 'S'], mark: 9,
      text: '<b>Beispiel 2 – 12 Error-Bits:</b> Knoten 1 sendet eine 0, liest aber eine 1 → <b>Bit-Fehler</b>, nur der Sender bemerkt ihn. Er sendet ein Primary Active Error Flag (6 × dominant). Für Knoten 2 und 3 sind das 6 gleiche Bits → <b>Stuff-Fehler</b>; sie antworten mit dem Secondary Active Error Flag. Ergebnis: 6 + 6 = 12 Flag-Bits + 8 Delimiter-Bits.'
    };
    if (ex === '3') return {
      pre: [1, 0, 1, 1, 0, 1, 1, 0, 0, 0], names: ['Knoten 1 (sendet, Bit-Fehler)', 'Knoten 2 (erkennt Stuff-Fehler)', 'Knoten 3 (erkennt Stuff-Fehler)'], starts: [0, 3, 3], kinds: ['P', 'S', 'S'], mark: 9, markSent: 1,
      text: '<b>Beispiel 3 – 9 Error-Bits:</b> Knoten 1 erkennt nach 3 übertragenen dominanten Bits einen Bit-Fehler. Wegen der 3 vorangegangenen dominanten Bits erkennen Knoten 2 und 3 schon nach 3 Bits des Error Flags sechs gleiche Bits (Stuff-Fehler). Primary und Secondary Flag überlappen sich um 3 Bits: 6 + 6 − 3 = 9 Flag-Bits + 8 Delimiter-Bits.'
    };
    // live
    const e = [...SIM.errLog].reverse().find((x) => x.kind === 'error');
    if (!e) return { pre: [1, 1, 1, 1, 1], names: ['–', '–', '–'], starts: [null, null, null], kinds: ['', '', ''], text: 'Noch kein Fehler in der Simulation. Simulation starten und links einen Fehler injizieren – oder im Netzwerk einen Fehler einbauen (z. B. Abschluss entfernen).' };
    const names = [CS.nodeLabel(e.sender) + ' (Sender)'];
    const det = e.detector === e.sender ? null : e.detector;
    if (det) names.push(CS.nodeLabel(det) + ' (erkennt zuerst)');
    const others = CS.state.net.nodes.filter((n) => n.id !== e.sender && n.id !== det).slice(0, det ? 1 : 2).map((n) => n.name + ' (Empfänger)');
    names.push(...others);
    const fb = e.flagBits;
    let starts;
    if (e.detector === e.sender) starts = names.map((_, i) => (i === 0 ? 0 : fb - 6));
    else starts = names.map((_, i) => (i === 1 ? 0 : 1));
    return {
      pre: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0], names, starts, kinds: names.map((_, i) => ((e.detector === e.sender ? i === 0 : i === 1) ? 'P' : 'S')),
      text: `<b>Letzter Fehler (t = ${CS.fmtFix(e.t, 4)} s):</b> ${ERR[e.type]} beim Senden von „${CS.esc(e.name)}“ (${CS.hexId(e.id, e.ext)}), erkannt von ${CS.esc(CS.nodeLabel(e.detector))} in Bit ${e.pos} (${CS.can.FIELD_NAMES[e.field] || ''}). Error Frame: ${fb} Flag-Bits + 8 Delimiter-Bits.${e.why ? ' Ursache: ' + CS.esc(e.why) : e.injected ? ' (injiziert)' : ''}`
    };
  }
  function drawEF() {
    const cv = document.getElementById('efCv');
    if (!cv.offsetParent) return;
    const sc = scenario(example);
    const { ctx, w, h: hh } = CS.fitCanvas(cv);
    ctx.clearRect(0, 0, w, hh);
    document.getElementById('efText').innerHTML = sc.text;
    const nPre = sc.pre.length;
    const flagEnd = Math.max(...sc.starts.map((s) => (s == null ? 0 : s + 6)));
    const total = nPre + flagEnd + 8 + 2;
    const pad = { l: Math.min(250, w * 0.3), r: 10, t: 28 };
    const rows = sc.names.length + 1, rh = (hh - pad.t - 14) / rows;
    const X = (i) => pad.l + (i / total) * (w - pad.l - pad.r);
    ctx.font = '12px ' + CS.css('--font');
    // Bereiche
    const band = (i0, i1, col, lab) => { ctx.fillStyle = col; ctx.globalAlpha = 0.16; ctx.fillRect(X(i0), pad.t - 6, X(i1) - X(i0), hh - pad.t - 8); ctx.globalAlpha = 1; ctx.fillStyle = CS.css('--ink-2'); ctx.textAlign = 'center'; ctx.fillText(lab, (X(i0) + X(i1)) / 2, 14); };
    if (sc.starts[0] != null || example !== 'live') {
      band(0, nPre, CS.css('--f-data'), 'Rahmen (Daten)');
      band(nPre, nPre + flagEnd, CS.css('--bad'), 'Error Flags (' + flagEnd + ' bit)');
      band(nPre + flagEnd, nPre + flagEnd + 8, CS.css('--muted'), 'Error Delimiter (8 bit)');
    }
    // Pegel je Knoten
    const levels = sc.names.map((_, r) => {
      const arr = [];
      for (let i = 0; i < total; i++) {
        if (i < nPre) arr.push(r === 0 || example === 'live' ? sc.pre[i] : sc.pre[i]);
        else { const s = sc.starts[r]; const k = i - nPre; arr.push(s != null && k >= s && k < s + 6 ? 0 : 1); }
      }
      return arr;
    });
    if (sc.mark != null) levels[0][sc.mark] = sc.markSent != null ? sc.markSent : 0; // vom Sender gesendeter Pegel (Bus zeigt den anderen)
    const bus = [];
    for (let i = 0; i < total; i++) bus.push(i < nPre ? sc.pre[i] : Math.min(...levels.map((l) => l[i])));
    const drawRow = (r, arr, label, col) => {
      const y0 = pad.t + r * rh, yHi = y0 + rh * 0.2, yLo = y0 + rh * 0.72;
      ctx.fillStyle = CS.css('--ink'); ctx.textAlign = 'right'; ctx.font = (r === rows - 1 ? 'bold ' : '') + (w < 700 ? '10.5px ' : '12px ') + CS.css('--font');
      ctx.fillText(label, pad.l - 10, (yHi + yLo) / 2 + 4);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      arr.forEach((v, i) => { const y = v ? yHi : yLo; if (!i) ctx.moveTo(X(0), y); else ctx.lineTo(X(i), y); ctx.lineTo(X(i + 1), y); });
      ctx.stroke();
      if (r < sc.names.length && sc.starts[r] != null) {
        const s = nPre + sc.starts[r];
        ctx.fillStyle = sc.kinds[r] === 'P' ? CS.css('--bad') : CS.css('--warn');
        ctx.font = '10.5px ' + CS.css('--font'); ctx.textAlign = 'center';
        ctx.fillText(sc.kinds[r] === 'P' ? 'Primary Flag' : 'Secondary Flag', (X(s) + X(s + 6)) / 2, yLo + 14);
      }
    };
    levels.forEach((l, r) => drawRow(r, l, sc.names[r], r === 0 ? CS.css('--s1') : CS.css('--s3')));
    drawRow(rows - 1, bus, 'CAN-Bus (resultierend)', CS.css('--ink'));
    if (sc.mark != null) {
      ctx.fillStyle = CS.css('--bad'); ctx.textAlign = 'center'; ctx.font = 'bold 11px ' + CS.css('--font');
      ctx.fillText('Bit-Fehler', (X(sc.mark) + X(sc.mark + 1)) / 2, pad.t + rh * 0.12);
    }
    // Bitraster
    ctx.strokeStyle = CS.css('--grid'); ctx.lineWidth = 1;
    for (let i = 0; i <= total; i++) { const x = Math.round(X(i)) + 0.5; ctx.beginPath(); ctx.moveTo(x, hh - 12); ctx.lineTo(x, hh - 6); ctx.stroke(); }
    ctx.fillStyle = CS.css('--muted'); ctx.textAlign = 'left'; ctx.font = '10.5px ' + CS.css('--font');
    ctx.fillText('oben = rezessiv (1), unten = dominant (0)', 4, hh - 2);
  }

  /* ---------------- Fehlerprotokoll & Knotenzustände ---------------- */
  function renderLog(force) {
    if (!force && SIM.errLog.length === lastLogLen) return;
    lastLogLen = SIM.errLog.length;
    const rows = SIM.errLog.slice(-150).reverse();
    let html = '<thead><tr><th class="num">Zeit [s]</th><th>Ereignis</th><th>Botschaft</th><th>Sender</th><th>Erkannt von</th><th class="num">Flag-Bits</th><th>Erläuterung</th></tr></thead><tbody>';
    for (const e of rows) {
      if (e.kind === 'state') html += `<tr><td class="num">${CS.fmtFix(e.t, 4)}</td><td colspan="6"><span class="tag warn">Zustand</span> ${CS.esc(e.text)}</td></tr>`;
      else html += `<tr class="clickable" data-t="${e.t}"><td class="num">${CS.fmtFix(e.t, 4)}</td><td><span class="tag bad">${ERR[e.type]}</span></td><td>${CS.esc(e.name)} <span class="mono">${CS.hexId(e.id, e.ext)}</span></td><td>${CS.esc(CS.nodeLabel(e.sender))}</td><td>${CS.esc(CS.nodeLabel(e.detector))}</td><td class="num">${e.flagBits}</td><td style="white-space:normal;min-width:240px">${e.why ? CS.esc(e.why) : e.injected ? 'injiziert' : ''}</td></tr>`;
    }
    if (!rows.length) html += '<tr><td colspan="7" class="hint">Noch keine Fehler.</td></tr>';
    document.getElementById('errTable').innerHTML = html + '</tbody>';
  }
  function renderNodes() {
    let html = '<thead><tr><th>Knoten</th><th>Zustand</th><th class="num">TEC</th><th class="num">REC</th><th></th></tr></thead><tbody>';
    for (const n of CS.state.net.nodes) {
      const rt = SIM.nrt[n.id] || { tec: 0, rec: 0, state: 'active' };
      html += `<tr><td>${CS.esc(n.name)}</td><td><span class="state-tag ${rt.state}">${STATE_TXT[rt.state]}</span></td><td class="num">${rt.tec}</td><td class="num">${rt.rec}</td><td>${rt.state === 'busoff' ? `<button class="btn small" data-rec="${n.id}" ${rt.recoverAt != null ? 'disabled' : ''}>${rt.recoverAt != null ? 'wartet …' : 'Reset'}</button>` : `<button class="btn small" data-clr="${n.id}" title="Zähler auf 0 setzen">0</button>`}</td></tr>`;
    }
    if (!CS.state.net.nodes.length) html += '<tr><td colspan="5" class="hint">Keine Knoten.</td></tr>';
    document.getElementById('errNodes').innerHTML = html + '</tbody>';
    const fs = document.getElementById('fsmNode'), old = fs.value;
    if (fs.options.length !== CS.state.net.nodes.length) {
      fs.textContent = '';
      for (const n of CS.state.net.nodes) fs.append(h('option', { value: n.id }, n.name));
      if (CS.state.net.nodes.some((n) => n.id === old)) fs.value = old;
    }
    drawFsm();
  }
  function drawFsm() {
    const id = document.getElementById('fsmNode').value;
    const rt = SIM.nrt[id] || { tec: 0, rec: 0, state: 'active' };
    const st = (k, x, y, w, t, sub) => `<g class="st ${rt.state === k ? 'cur ' + k : ''}"><rect x="${x}" y="${y}" width="${w}" height="64" rx="10"/><text class="t" x="${x + w / 2}" y="${y + 21}" text-anchor="middle">${t}</text><text x="${x + w / 2}" y="${y + 37}" text-anchor="middle" class="e">${sub}</text><text x="${x + w / 2}" y="${y + 53}" text-anchor="middle" class="e" style="font-weight:700">${rt.state === k ? 'TEC ' + rt.tec + ' · REC ' + rt.rec : ''}</text></g>`;
    document.getElementById('fsmSvg').innerHTML = `
      <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--muted)" stroke="none"/></marker></defs>
      ${st('active', 70, 22, 120, 'Error Active', 'aktive Flags (dominant)')}${st('passive', 214, 22, 120, 'Error Passive', 'passive Flags (rezessiv)')}${st('busoff', 142, 186, 120, 'Bus Off', 'vom Bus getrennt')}
      <path d="M190 40 L212 40" marker-end="url(#ar)"/><text class="e" x="202" y="13" text-anchor="middle">TEC &gt; 127 oder REC &gt; 127</text>
      <path d="M214 70 L192 70" marker-end="url(#ar)"/><text class="e" x="202" y="104" text-anchor="middle">TEC &lt; 128 und REC &lt; 128</text>
      <path d="M274 86 L232 184" marker-end="url(#ar)"/><text class="e" x="282" y="140">TEC &gt; 255</text>
      <path d="M142 218 C 60 218 40 150 98 88" marker-end="url(#ar)"/><text class="e" x="4" y="196">Host-Reset +</text><text class="e" x="4" y="209">128 × 11 rez. Bits</text>
      <text class="e" x="202" y="266" text-anchor="middle">Ein defekter Knoten blockiert so nicht den Bus.</text>`;
  }
  function drawTec(force) {
    if (!tecPlot) return;
    const now = performance.now();
    if (!force && now - lastDraw < 200) return;
    lastDraw = now;
    const t = SIM.hist.t;
    const series = [];
    CS.state.net.nodes.forEach((n, i) => {
      const hs = SIM.hist.nodes[n.id];
      if (!hs) return;
      series.push({ name: n.name + ' TEC', color: CS.seriesColor(i), t, v: hs.tec, step: true });
    });
    const recS = CS.state.net.nodes.map((n, i) => { const hs = SIM.hist.nodes[n.id]; return hs && { name: n.name + ' REC', color: CS.seriesColor(i), t, v: hs.rec, step: true }; }).filter(Boolean).filter((s) => s.v.some((x) => x > 0));
    const t1 = Math.max(10, SIM.t);
    tecPlot.draw({ t0: Math.max(0, t1 - 60), t1, tNow: SIM.t, panels: [{ series: series.filter((s) => s.v.some((x) => x > 0)), yMin: 0, yMax: 130, empty: 'TEC aller Knoten = 0' }, { series: recS, yMin: 0, yMax: 130, empty: 'REC aller Knoten = 0' }] });
  }

  function fillSelects() {
    const im = document.getElementById('injMsg'), o1 = im.value;
    im.textContent = '';
    im.append(h('option', { value: '' }, 'nächste beliebige Botschaft'));
    for (const m of CS.state.messages) im.append(h('option', { value: m.key }, m.name + ' (' + CS.hexId(m.id, m.ext) + ')'));
    if ([...im.options].some((o) => o.value === o1)) im.value = o1;
    const ds = document.getElementById('defectSel'), o2 = ds.value;
    ds.textContent = '';
    ds.append(h('option', { value: '' }, 'kein'));
    for (const n of CS.state.net.nodes) ds.append(h('option', { value: n.id }, n.name));
    if ([...ds.options].some((o) => o.value === o2)) ds.value = o2;
  }

  T.init = function () {
    tecPlot = CS.Plot(document.getElementById('tecCv'));
    document.getElementById('errTypes').innerHTML = [
      ['Bit-Fehler', 'Sender vergleicht gesendetes Bit mit dem Buspegel (Bitmonitoring). Erkennt: nur der Sender.'],
      ['Stuff-Fehler', '6 gleiche Bits in Folge zwischen SOF und CRC. Erkennt: Empfänger.'],
      ['Form-Fehler', 'Feste Bits (CRC-/ACK-Delimiter, EOF) nicht rezessiv. Erkennt: Empfänger.'],
      ['ACK-Fehler', 'Kein Empfänger setzt den ACK-Slot dominant (z. B. einziger Knoten am Bus). Erkennt: Sender.'],
      ['CRC-Fehler', 'Vom Empfänger berechnete CRC-15 ≠ empfangene CRC. Erkennt: Empfänger.']
    ].map(([t, d]) => `<div class="et"><b>${t}</b>${d}</div>`).join('');
    const inj = (n) => {
      if (!SIM.running) CS.toast('Hinweis: Die Simulation läuft nicht – der Fehler wird beim nächsten Rahmen wirksam.');
      for (let i = 0; i < n; i++) SIM.inject(document.getElementById('injType').value, document.getElementById('injMsg').value || null);
      if (example === 'live') setTimeout(drawEF, 300);
    };
    document.getElementById('injOnce').addEventListener('click', () => inj(1));
    document.getElementById('injBurst').addEventListener('click', () => inj(10));
    document.getElementById('defectSel').addEventListener('change', (e) => { SIM.faults.defect = {}; if (e.target.value) SIM.faults.defect[e.target.value] = true; });
    document.getElementById('noise').addEventListener('input', (e) => { SIM.faults.noise = +e.target.value; document.getElementById('noiseVal').textContent = CS.fmt(+e.target.value, 2) + ' V'; });
    document.querySelectorAll('#efExample button').forEach((b) => b.addEventListener('click', () => {
      example = b.dataset.ex; document.querySelectorAll('#efExample button').forEach((x) => x.classList.toggle('active', x === b)); drawEF();
    }));
    document.getElementById('errClear').addEventListener('click', () => { SIM.errLog = []; renderLog(true); });
    document.getElementById('errTable').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-t]'); if (!tr) return;
      example = 'live';
      document.querySelectorAll('#efExample button').forEach((x) => x.classList.toggle('active', x.dataset.ex === 'live'));
      drawEF();
    });
    document.getElementById('errNodes').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.rec) SIM.recover(b.dataset.rec);
      if (b.dataset.clr) SIM.clearCounters(b.dataset.clr);
      renderNodes();
    });
    document.getElementById('fsmNode').addEventListener('change', drawFsm);
    window.addEventListener('resize', () => { if (active) { drawEF(); drawTec(true); } });
    CS.on('changed', fillSelects);
    CS.on('tick', () => { if (!active) return; renderNodes(); renderLog(); drawTec(); });
    CS.on('sim-reset', () => { if (active) { renderNodes(); renderLog(true); drawTec(true); } });
    fillSelects();
  };
  T.setActive = function (on) {
    active = on;
    if (on) { fillSelects(); renderNodes(); renderLog(true); drawEF(); drawTec(true); }
  };
})();
