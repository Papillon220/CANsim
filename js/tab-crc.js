/* ==========================================================================
   CANsim – Reiter 6: Checksumme (CRC-8 SAE J1850) & Botschaftszähler
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS, h = CS.h, SIM = CS.sim;
  const T = (CS.CrcTab = {});
  let active = false, cntPlot = null, lastDraw = 0;

  const SAMPLES = [
    { name: 'MM7.10, Trace bei 51,89 s', data: '18 80 00 57 D0 7D 05', crc: '45' },
    { name: 'MM7.10, Trace bei 0,11 s', data: '12 80 00 57 E7 7D 0D', crc: '67' },
    { name: 'MM7.10, Trace bei 3,86 s', data: '16 80 00 57 D9 7D 04', crc: 'DA' },
    { name: 'Joystick 0x124 (5 Byte)', data: '4C 04 E8 03', crc: '32' },
    { name: 'MM7.10 mit Übertragungsfehler', data: '18 80 00 57 D0 7D 25', crc: '45' }
  ];
  const E2E_MODES = {
    '': 'kein Fehler',
    init0: 'Sender: falscher Startwert (0x00 statt 0xFF)',
    noxor: 'Sender: abschließendes XOR vergessen',
    poly: 'Sender: falsches Polynom (0x2F)',
    flip: 'Gateway: Bit kippt nach CRC-Bildung',
    cntFreeze: 'Sender-Software hängt (Zähler steht)',
    cntJump: 'Botschaften gehen verloren (Zähler springt)',
    silent: 'Sender verstummt (Timeout)'
  };

  const byteBin = (b, mark) => { const s = b.toString(2).padStart(8, '0'); return mark ? `<span class="m">${s[0]}</span>${s.slice(1)}` : s; };
  function params() {
    const p = parseInt(document.getElementById('crcPoly').value, 16), i = parseInt(document.getElementById('crcInit').value, 16), x = parseInt(document.getElementById('crcXor').value, 16);
    return { poly: (p || 0) & 0xff, init: (i || 0) & 0xff, xorout: (x || 0) & 0xff };
  }

  /* ---------------- Rechner ---------------- */
  function calc() {
    const data = CS.parseHexBytes(document.getElementById('crcData').value);
    const p = params();
    const steps = [];
    const crc = CS.crc8(data, p, steps);
    const expS = document.getElementById('crcExp').value.trim();
    const exp = expS ? parseInt(expS.replace(/^0x/i, ''), 16) & 0xff : null;
    const out = document.getElementById('crcResult');
    out.innerHTML = `<span>Polynom: <b>${CS.polyStr8(p.poly)}</b></span>
      <span>Register nach ${data.length} Byte: <b class="mono">0x${CS.hex(steps.length ? steps[steps.length - 1].reg : p.init, 2)}</b> → XOR 0x${CS.hex(p.xorout, 2)}</span>
      <span>CRC berechnet: <span class="big">0x${CS.hex(crc, 2)}</span> <span class="mono">(${byteBin(crc)})</span></span>` +
      (exp != null ? (exp === crc ? `<span class="ok">✓ stimmt mit der empfangenen CRC 0x${CS.hex(exp, 2)} überein</span>` : `<span class="fail">✕ empfangen 0x${CS.hex(exp, 2)} – Abweichung (XOR 0x${CS.hex(exp ^ crc, 2)})</span>`) : '');
    // Schritte
    const bits = document.getElementById('crcBits').checked;
    let html = '<thead><tr><th>Schritt</th><th>Datenbyte</th><th>CRC vorher</th><th>CRC ⊕ Byte</th><th>Bit 7 = 1 → schieben ⊕ Poly, sonst schieben</th><th>Register</th></tr></thead><tbody>';
    html += `<tr class="byte"><td>Start</td><td></td><td></td><td></td><td>Startwert</td><td>0x${CS.hex(p.init, 2)} ${byteBin(p.init)}</td></tr>`;
    for (const s of steps) {
      html += `<tr class="byte"><td>Byte ${s.i}</td><td>0x${CS.hex(s.byte, 2)} ${byteBin(s.byte)}</td><td>0x${CS.hex(s.before, 2)}</td><td>0x${CS.hex(s.afterXor, 2)} ${byteBin(s.afterXor)}</td><td></td><td>0x${CS.hex(s.reg, 2)}</td></tr>`;
      if (bits) {
        let r = s.afterXor;
        s.bitSteps.forEach((b, j) => {
          html += `<tr><td></td><td>Bit ${j}</td><td></td><td>${byteBin(r, true)}</td><td>${b.msb ? '« 1, ⊕ 0x' + CS.hex(p.poly, 2) : '« 1'}</td><td>${byteBin(b.reg)}</td></tr>`;
          r = b.reg;
        });
      }
    }
    html += `<tr class="byte"><td>Ende</td><td></td><td></td><td></td><td>⊕ 0x${CS.hex(p.xorout, 2)} (Final XOR)</td><td>0x${CS.hex(crc, 2)} ${byteBin(crc)}</td></tr></tbody>`;
    document.getElementById('crcSteps').innerHTML = html;
    if (exp != null && exp !== crc) analyze({ bytes: data, rx: exp, source: 'Rechner' });
  }

  /* ---------------- Fehleranalyse ---------------- */
  function analyze(c) {
    const box = document.getElementById('e2eAnalysis');
    const J = CS.CRC8_PRESETS.j1850;
    const calc = CS.crc8(c.bytes, J);
    const hyps = [];
    const test = (name, p, why) => { const v = CS.crc8(c.bytes, p); hyps.push({ name, v, match: v === c.rx, why }); };
    test('SAE J1850 (Init 0xFF, XorOut 0xFF)', J, 'Korrekte Berechnung');
    test('Startwert 0x00 statt 0xFF', Object.assign({}, J, { init: 0 }), 'Sender initialisiert das Register falsch');
    test('ohne abschließendes XOR', Object.assign({}, J, { xorout: 0 }), 'Sender vergisst den letzten Schritt');
    test('Init 0x00 und ohne XOR', Object.assign({}, J, { init: 0, xorout: 0 }), 'SAE-J1850-„Zero“-Variante');
    test('Polynom 0x2F (AUTOSAR CRC8H2F)', CS.CRC8_PRESETS.h2f, 'anderes Generatorpolynom');
    test('Bytes in umgekehrter Reihenfolge', Object.assign({}, J), 'Byte-Reihenfolge vertauscht');
    hyps[hyps.length - 1].v = CS.crc8([...c.bytes].reverse(), J); hyps[hyps.length - 1].match = hyps[hyps.length - 1].v === c.rx;
    // Einzelbitfehler suchen
    const singles = [];
    c.bytes.forEach((b, i) => { for (let k = 0; k < 8; k++) { const d = [...c.bytes]; d[i] ^= 1 << k; if (CS.crc8(d, J) === c.rx) singles.push({ byte: i, bit: k, was: b, now: d[i] }); } });
    for (let k = 0; k < 8; k++) if ((c.rx ^ (1 << k)) === calc) singles.push({ crcByte: true, bit: k });
    let html = `<div class="ana"><span>Quelle: ${CS.esc(c.source)}${c.msg ? ' · ' + CS.esc(c.msg) : ''}</span>
      <span>Daten ohne CRC: <span class="mono">${CS.bytesHex(c.bytes)}</span> · empfangen <b class="mono">0x${CS.hex(c.rx, 2)}</b> · berechnet <b class="mono">0x${CS.hex(calc, 2)}</b></span>`;
    if (calc === c.rx) html += '<div class="hyp match"><b>CRC korrekt.</b> Die Daten sind (mit hoher Wahrscheinlichkeit) unverfälscht.</div>';
    else {
      html += '<b>Hypothesen: mit welcher Berechnung passt die empfangene CRC?</b>';
      for (const y of hyps.slice(1)) html += `<div class="hyp ${y.match ? 'match' : ''}">${y.match ? '✓' : '✕'} <b>${y.name}</b> → 0x${CS.hex(y.v, 2)}${y.match ? ' – passt! ' + y.why + '.' : ''}</div>`;
      html += '<b>Einzelbit-Fehler, der die Abweichung erklärt:</b>';
      if (!singles.length) html += '<div class="hyp">Kein einzelnes gekipptes Bit erklärt die Abweichung → Mehrbitfehler oder systematischer Fehler (siehe Hypothesen).</div>';
      for (const s of singles) html += s.crcByte
        ? `<div class="hyp match">Bit ${s.bit} im <b>CRC-Byte</b> selbst gekippt – die Nutzdaten wären korrekt.</div>`
        : `<div class="hyp match">Byte ${s.byte}, Bit ${s.bit} gekippt: empfangen 0x${CS.hex(s.was, 2)}, gesendet wohl <b>0x${CS.hex(s.now, 2)}</b> (${byteBin(s.now)} → ${byteBin(s.was)})</div>`;
      if (singles.length === 1 && !singles[0].crcByte) html += '<span class="hint">Bei kurzen Botschaften ist das Fehlersyndrom eines Einzelbitfehlers eindeutig – die CRC könnte ihn sogar korrigieren. In der Praxis wird die Botschaft aber verworfen.</span>';
      else if (singles.length > 1) html += '<span class="hint">Mehrere Einzelbitfehler würden passen – eine Korrektur wäre nicht eindeutig.</span>';
    }
    if (c.cnt) html += `<div class="hyp ${c.cnt.ok ? 'match' : ''}"><b>Zähler:</b> ${c.cnt.text}</div>`;
    if (c.truth) html += `<details><summary>Auflösung (tatsächliche Ursache in der Simulation)</summary><p class="hint">${CS.esc(c.truth)}</p></details>`;
    html += `<span class="hint">Restfehlerwahrscheinlichkeit einer 8-bit-CRC bei zufälligen Mehrbitfehlern ≈ 1/256. Zusammen mit dem 4-bit-Zähler und der CAN-CRC-15 ergibt sich eine sehr hohe Datensicherheit.</span></div>`;
    box.innerHTML = html;
  }

  /* ---------------- Live-Prüfung ---------------- */
  function e2eMsgs() { return CS.state.messages.filter((m) => m.signals.some((s) => s.src === 'crc' || s.src === 'counter')); }
  function cntText(r) {
    if (!r.hasCnt) return { text: 'kein Zähler', ok: true };
    if (r.cntOk == null) return { text: 'Zählerstand ' + r.cnt + ' (erste Botschaft)', ok: true };
    if (r.cntOk) return { text: 'Zählerstand ' + r.cnt + ' (+1, lückenlos)', ok: true };
    if (r.cntDelta === 0) return { text: 'Zählerstand ' + r.cnt + ' unverändert → Sender sendet alte Daten (eingefroren)', ok: false };
    return { text: 'Sprung um ' + r.cntDelta + ' auf ' + r.cnt + ' → ' + (r.cntDelta - 1) + ' Botschaft(en) verloren', ok: false };
  }
  let liveRows = [];
  function renderLive() {
    const rows = [];
    for (const m of e2eMsgs()) for (const x of (CS.rx.recent.get(m.key) || []).slice(-12)) rows.push({ m, x });
    rows.sort((a, b) => b.x.t - a.x.t);
    liveRows = rows.slice(0, 40);
    let html = '<thead><tr><th class="num">Zeit [s]</th><th>Botschaft</th><th>Daten</th><th class="num">Zähler</th><th>CRC empf.</th><th>CRC berechn.</th><th>Status</th></tr></thead><tbody>';
    liveRows.forEach(({ m, x }, i) => {
      const r = x.e2e, bad = (r.hasCrc && !r.crcOk) || (r.hasCnt && r.cntOk === false);
      html += `<tr class="clickable ${bad ? 'errrow' : ''}" data-i="${i}"><td class="num">${CS.fmtFix(x.t, 4)}</td><td>${CS.esc(m.name)}</td><td class="mono">${CS.bytesHex(x.data)}</td><td class="num">${r.hasCnt ? r.cnt + (r.cntDelta != null && r.cntDelta !== 1 ? ' (Δ' + r.cntDelta + ')' : '') : '–'}</td><td class="mono">${r.hasCrc ? '0x' + CS.hex(r.crcRx, 2) : '–'}</td><td class="mono">${r.hasCrc ? '0x' + CS.hex(r.crcCalc, 2) : '–'}</td><td>${r.hasCrc ? (r.crcOk ? '<span class="tag ok">CRC ✓</span>' : '<span class="tag bad">CRC ✕</span>') : ''} ${r.hasCnt && r.cntOk != null ? (r.cntOk ? '<span class="tag ok">Zähler ✓</span>' : '<span class="tag bad">Zähler ✕</span>') : ''}</td></tr>`;
    });
    if (!liveRows.length) html += '<tr><td colspan="7" class="hint">' + (e2eMsgs().length ? 'Simulation starten – empfangene Botschaften mit Zähler/CRC erscheinen hier (das CAN-Interface muss am Bus sein).' : 'Keine Botschaft mit Zähler oder CRC konfiguriert.') + '</td></tr>';
    document.getElementById('e2eTable').innerHTML = html + '</tbody>';
    const ecu = SIM.world.ecu.e2e;
    document.getElementById('e2eHint').textContent = CS.state.scenario === 'boom' ? `Steuerung: ${ecu.ok} gültig · ${ecu.crcErr} CRC-Fehler verworfen · ${ecu.cntErr} Zählerfehler · ${ecu.timeouts} Timeouts` : '';
  }
  function drawCnt(force) {
    if (!cntPlot) return;
    const now = performance.now();
    if (!force && now - lastDraw < 100) return;
    lastDraw = now;
    const k = document.getElementById('cntMsg').value;
    const list = CS.rx.recent.get(k) || [];
    const t = list.map((x) => x.t), v = list.map((x) => (x.e2e.hasCnt ? x.e2e.cnt : 0));
    const m = CS.state.messages.find((x) => x.key === k);
    const t1 = Math.max(0.5, SIM.t);
    const win = m ? Math.min(2, Math.max(0.2, (m.cycle || 10) * 40 / 1000)) : 1;
    cntPlot.draw({ t0: t1 - win, t1, tNow: SIM.t, panels: [{ series: [{ name: 'MSG_CNT ' + (m ? m.name : ''), color: CS.seriesColor(0), t, v, step: true }], yMin: 0, yMax: 15, empty: 'Keine Daten' }] });
  }

  function renderFaults() {
    const box = document.getElementById('e2eFaults');
    box.textContent = '';
    for (const m of e2eMsgs()) {
      const s = h('select', { onchange: (e) => { if (e.target.value) SIM.faults.e2e[m.key] = e.target.value; else delete SIM.faults.e2e[m.key]; } }, Object.entries(E2E_MODES).map(([k, v]) => h('option', { value: k }, v)));
      s.value = SIM.faults.e2e[m.key] || '';
      box.append(h('div', { class: 'e2e-row' }, [h('b', {}, m.name + ' ' + CS.hexId(m.id, m.ext)), s]));
    }
    if (!box.children.length) box.append(h('p', { class: 'hint' }, 'Keine Botschaft mit Zähler/CRC vorhanden.'));
    const cs = document.getElementById('cntMsg'), old = cs.value;
    cs.textContent = '';
    for (const m of e2eMsgs()) cs.append(h('option', { value: m.key }, m.name));
    if ([...cs.options].some((o) => o.value === old)) cs.value = old;
  }

  T.init = function () {
    cntPlot = CS.Plot(document.getElementById('cntCv'));
    const ss = document.getElementById('crcSample');
    ss.append(h('option', { value: '' }, 'eigene Eingabe'));
    SAMPLES.forEach((s, i) => ss.append(h('option', { value: i }, s.name)));
    ss.value = '0';
    ss.addEventListener('change', () => {
      const s = SAMPLES[+ss.value]; if (!s) return;
      document.getElementById('crcData').value = s.data; document.getElementById('crcExp').value = s.crc;
      document.getElementById('crcPreset').value = 'j1850'; setPreset(); calc();
    });
    const ps = document.getElementById('crcPreset');
    for (const [k, p] of Object.entries(CS.CRC8_PRESETS)) ps.append(h('option', { value: k }, p.name));
    ps.append(h('option', { value: 'custom' }, 'eigene Parameter'));
    const setPreset = () => { const p = CS.CRC8_PRESETS[ps.value]; if (!p) return; document.getElementById('crcPoly').value = CS.hex(p.poly, 2); document.getElementById('crcInit').value = CS.hex(p.init, 2); document.getElementById('crcXor').value = CS.hex(p.xorout, 2); };
    ps.addEventListener('change', () => { setPreset(); calc(); });
    for (const id of ['crcPoly', 'crcInit', 'crcXor']) document.getElementById(id).addEventListener('input', () => { ps.value = 'custom'; calc(); });
    for (const id of ['crcData', 'crcExp']) document.getElementById(id).addEventListener('input', () => { ss.value = ''; calc(); });
    document.getElementById('crcBits').addEventListener('change', calc);
    document.getElementById('e2eTable').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      const { m, x } = liveRows[+tr.dataset.i];
      const r = x.e2e;
      const ct = cntText(r);
      let truth = null;
      const mode = SIM.faults.e2e[m.key];
      if (x.flip) truth = `Gateway hat Byte ${x.flip.byte}, Bit ${x.flip.bit} nach der CRC-Bildung gekippt.`;
      else if (mode) truth = 'Aktiver E2E-Fehler: ' + E2E_MODES[mode] + '.';
      if (r.hasCrc) analyze({ bytes: r.crcBytes, rx: r.crcRx, source: 'Trace t = ' + CS.fmtFix(x.t, 4) + ' s', msg: m.name, cnt: r.hasCnt ? ct : null, truth });
      else document.getElementById('e2eAnalysis').innerHTML = `<div class="ana"><div class="hyp ${ct.ok ? 'match' : ''}"><b>Zähler:</b> ${ct.text}</div></div>`;
      // Daten auch in den Rechner übernehmen
      if (r.hasCrc) { document.getElementById('crcData').value = CS.bytesHex(r.crcBytes); document.getElementById('crcExp').value = CS.hex(r.crcRx, 2); ss.value = ''; ps.value = 'j1850'; setPreset(); const keep = document.getElementById('e2eAnalysis').innerHTML; calc(); document.getElementById('e2eAnalysis').innerHTML = keep; }
    });
    document.getElementById('cntMsg').addEventListener('change', () => drawCnt(true));
    window.addEventListener('resize', () => { if (active) drawCnt(true); });
    CS.on('changed', renderFaults);
    CS.on('tick', () => { if (!active) return; renderLive(); drawCnt(); });
    setPreset(); renderFaults(); calc();
  };
  T.setActive = function (on) { active = on; if (on) { renderFaults(); renderLive(); drawCnt(true); } };
})();
