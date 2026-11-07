/* ==========================================================================
   CANsim – Reiter 4: Bitebene (Rahmenaufbau, Bitstuffing, CRC-15,
   Fehlererkennung beim Empfänger, Arbitrierung)
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS, h = CS.h, CAN = CS.can;
  const T = (CS.BitsTab = {});
  let frame = null, flips = new Set(), active = false;

  const FIELD_COLOR = { SOF: '--f-sof', ID: '--f-id', IDx: '--f-id', SRR: '--f-ctl', RTR: '--f-ctl', IDE: '--f-ctl', r0: '--f-ctl', r1: '--f-ctl', DLC: '--f-dlc', DATA: '--f-data', CRC: '--f-crc', CRCdel: '--f-ack', ACK: '--f-ack', ACKdel: '--f-ack', EOF: '--f-eof', IFS: '--f-eof', STUFF: '--f-stuff' };
  const SHORT = { SOF: 'SOF', ID: 'Identifier', IDx: 'ID (Ext.)', SRR: 'SRR', RTR: 'RTR', IDE: 'IDE', r0: 'r0', r1: 'r1', DLC: 'DLC', DATA: 'Daten', CRC: 'CRC', CRCdel: 'Del', ACK: 'ACK', ACKdel: 'Del', EOF: 'EOF', IFS: 'IFS' };

  function readInputs() {
    const id = parseInt(document.getElementById('bitId').value.replace(/^0x/i, ''), 16) || 0;
    const ext = document.getElementById('bitExt').value === '1';
    const rtr = document.getElementById('bitRtr').value === '1';
    const dlc = CS.clamp(+document.getElementById('bitDlc').value || 0, 0, 8);
    const data = CS.parseHexBytes(document.getElementById('bitData').value);
    while (data.length < dlc) data.push(0);
    return { id: ext ? id & 0x1fffffff : id & 0x7ff, ext, rtr, dlc, data: data.slice(0, dlc) };
  }
  function setInputs(f) {
    document.getElementById('bitId').value = CS.hex(f.id, f.ext ? 8 : 3);
    document.getElementById('bitExt').value = f.ext ? 1 : 0;
    document.getElementById('bitRtr').value = f.rtr ? 1 : 0;
    document.getElementById('bitDlc').value = f.dlc;
    document.getElementById('bitData').value = CS.bytesHex(f.data || []);
  }
  function fillSrc() {
    const s = document.getElementById('bitSrc'), old = s.value;
    s.textContent = '';
    s.append(h('option', { value: '' }, 'Manuelle Eingabe'));
    for (const m of CS.state.messages) s.append(h('option', { value: m.key }, 'Letzter Rahmen: ' + m.name + ' (' + CS.hexId(m.id, m.ext) + ')'));
    if ([...s.options].some((o) => o.value === old)) s.value = old;
  }
  function fromSource() {
    const k = document.getElementById('bitSrc').value;
    if (!k) return;
    const m = CS.state.messages.find((x) => x.key === k);
    if (!m) return;
    const rec = CS.rx.recent.get(k);
    const data = rec && rec.length ? rec[rec.length - 1].data : CS.sim.encode(m, CS.sim.t, { counter: 0 });
    setInputs({ id: m.id, ext: m.ext, rtr: false, dlc: m.dlc, data: [...data] });
  }

  /* ---------------- Empfänger: Rahmen aus der (gestörten) Bitfolge dekodieren ---------------- */
  function receive(bus) {
    // bus: Array der Buspegel (0/1) ab SOF
    const res = { events: [] };
    let i = 0, run = 0, last = -1, stuffOn = true;
    const raw = [];
    const take = () => {
      for (;;) {
        const v = i < bus.length ? bus[i] : 1;
        const idx = i++;
        if (stuffOn && run === 5) {
          if (v === last) { res.stuffErr = idx; return null; }
          run = 1; last = v; continue; // Stuff-Bit verwerfen
        }
        if (v === last) run++; else { run = 1; last = v; }
        raw.push(v);
        return { v, idx };
      }
    };
    const field = (n) => { let x = 0; for (let k = 0; k < n; k++) { const b = take(); if (!b) return null; x = x * 2 + b.v; } return x; };
    const sof = take(); if (!sof) return res;
    const idA = field(11); if (idA == null) return res;
    const b1 = take(); if (!b1) return res;
    const ide = take(); if (!ide) return res;
    let id = idA, ext = false, rtr = b1.v;
    if (ide.v === 1) {
      ext = true;
      const idB = field(18); if (idB == null) return res;
      id = idA * 262144 + idB;
      const r = take(); if (!r) return res; rtr = r.v;
      if (!take() || !take()) return res;
    } else { if (!take()) return res; }
    const dlc = field(4); if (dlc == null) return res;
    const data = [];
    if (!rtr) for (let k = 0; k < Math.min(8, dlc); k++) { const x = field(8); if (x == null) return res; data.push(x); }
    const crcCalc = CAN.crc15(raw.slice());
    const crcRx = field(15); if (crcRx == null) return res;
    stuffOn = false;
    Object.assign(res, { id, ext, rtr, dlc, data, crcCalc, crcRx });
    const crcDel = i; const vDel = bus[i++] ?? 1;
    const ackIdx = i; const vAck = bus[i++] ?? 1;
    const ackDel = i; const vAckDel = bus[i++] ?? 1;
    if (crcRx !== crcCalc) res.crcErr = ackDel + 1;
    if (vDel !== 1) res.formErr = crcDel;
    else if (vAckDel !== 1) res.formErr = ackDel;
    else for (let k = 0; k < 7; k++) if ((bus[i + k] ?? 1) !== 1) { res.formErr = i + k; break; }
    res.ackIdx = ackIdx; res.ackVal = vAck;
    return res;
  }

  /* ---------------- Darstellung ---------------- */
  T.update = function () {
    const f = readInputs();
    frame = CAN.buildFrame(f);
    frame.input = f;
    // Bits mit Busverhalten: ACK-Slot dominant (Empfänger quittieren)
    const sent = frame.bits.map((b) => b.v);
    const bus = sent.map((v, i) => (flips.has(i) ? 1 - v : v));
    frame.sent = sent; frame.bus = bus;
    renderBits();
    renderAnalysis();
    renderStats();
    renderCrc();
    drawWave();
  };
  function renderBits() {
    const box = document.getElementById('bitView');
    box.textContent = '';
    const groups = [];
    frame.bits.forEach((b, i) => {
      const f = b.f === 'STUFF' ? (groups.length ? groups[groups.length - 1].f : 'SOF') : b.f;
      let g = groups[groups.length - 1];
      if (!g || g.f !== f || (f === 'DATA' && b.f === 'DATA' && b.k === 0)) { g = { f, bits: [], byte: b.byte }; groups.push(g); }
      g.bits.push(i);
    });
    const det = T._detect;
    for (const g of groups) {
      const col = 'var(' + FIELD_COLOR[g.f] + ')';
      const bitsEl = h('div', { class: 'bf-bits' });
      for (const i of g.bits) {
        const b = frame.bits[i], v = frame.bus[i];
        const el = h('div', {
          class: 'bit ' + (v === 0 ? 'd' : 'r') + (b.f === 'STUFF' ? ' stuff' : '') + (flips.has(i) ? ' flip' : '') + (det === i ? ' detect' : ''),
          style: '--fc:' + (b.f === 'STUFF' ? 'var(--f-stuff)' : col),
          title: `Bit ${i} · ${CAN.FIELD_NAMES[b.f]}${b.f === 'STUFF' ? ' (nach 5 gleichen Bits in ' + (CAN.FIELD_NAMES[b.stuffIn] || '') + ')' : ''} · ${v === 0 ? 'dominant (0)' : 'rezessiv (1)'}${flips.has(i) ? ' · GEKIPPT' : ''}`
        }, v);
        el.addEventListener('click', () => { if (flips.has(i)) flips.delete(i); else flips.add(i); T.update(); });
        bitsEl.append(el);
      }
      const name = g.f === 'DATA' ? 'Byte ' + g.byte : SHORT[g.f];
      box.append(h('div', { class: 'bf', style: '--fc:' + col }, [h('div', { class: 'bf-name' }, name), bitsEl]));
    }
    const lg = document.getElementById('bitLegend');
    lg.innerHTML = [['--f-sof', 'SOF/EOF/IFS'], ['--f-id', 'Identifier'], ['--f-ctl', 'Steuerbits'], ['--f-dlc', 'DLC'], ['--f-data', 'Daten'], ['--f-crc', 'CRC'], ['--f-ack', 'Delimiter/ACK'], ['--f-stuff', 'Stuff-Bit']]
      .map(([c, t]) => `<span><i class="sw box" style="--c:var(${c})"></i>${t}</span>`).join('') + '<span>gefüllt = dominant (0), Rahmen = rezessiv (1)</span>';
  }
  const ERR = { bit: 'Bit-Fehler', stuff: 'Stuff-Fehler', crc: 'CRC-Fehler', form: 'Form-Fehler', ack: 'ACK-Fehler' };
  function renderAnalysis() {
    const box = document.getElementById('bitAnalysis');
    T._detect = null;
    if (!flips.size) {
      box.innerHTML = `<div class="err-box good"><b>Fehlerfreie Übertragung.</b><span>Die Empfänger entfernen ${frame.nStuff} Stuff-Bit(s), berechnen die CRC-15 = 0x${CS.hex(frame.crc, 4)} und vergleichen sie mit der empfangenen CRC → identisch. Delimiter und EOF sind rezessiv. Mindestens ein Empfänger setzt den ACK-Slot dominant.</span><span class="hint">Klicken Sie ein Bit im Bitstrom an, um eine Störung auf der Leitung zu simulieren.</span></div>`;
      highlightDetect(); return;
    }
    const first = Math.min(...flips);
    const fb = frame.bits[first];
    const r = receive(frame.bus);
    // Sicht des Senders (Bitmonitoring)
    let sender;
    if (fb.f === 'ACK') sender = { type: 'ack', pos: first, text: 'Der ACK-Slot ist rezessiv geblieben – der Sender erkennt einen <b>ACK-Fehler</b> (keine Quittung).' };
    else if ((fb.f === 'ID' || fb.f === 'IDx' || fb.f === 'RTR' || fb.f === 'SRR' || fb.f === 'IDE') && frame.sent[first] === 1) sender = { type: 'arb', pos: first, text: 'Der Sender hat rezessiv gesendet und liest dominant – im Arbitrierungsfeld bedeutet das: <b>Arbitrierung verloren</b>, er wird zum Empfänger (kein Fehler!).' };
    else sender = { type: 'bit', pos: first, text: `Der Sender vergleicht jedes gesendete Bit mit dem Buspegel (Bitmonitoring): gesendet ${frame.sent[first]}, gelesen ${frame.bus[first]} → <b>Bit-Fehler</b> in Bit ${first} (${CAN.FIELD_NAMES[fb.f]}).` };
    // Sicht der Empfänger
    let rx;
    if (r.stuffErr != null) rx = { type: 'stuff', pos: r.stuffErr, text: `In Bit ${r.stuffErr} folgt das 6. gleiche Bit → <b>Stuff-Fehler</b>.` };
    else if (r.crcErr != null) rx = { type: 'crc', pos: r.crcErr, text: `Berechnete CRC 0x${CS.hex(r.crcCalc, 4)} ≠ empfangene CRC 0x${CS.hex(r.crcRx, 4)} → <b>CRC-Fehler</b> (Error Flag nach dem ACK-Delimiter).` + (r.dlc !== frame.input.dlc || r.id !== frame.input.id ? ` Der Empfänger hat ID ${CS.hexId(r.id, r.ext)} / DLC ${r.dlc} gelesen.` : '') };
    else if (r.formErr != null) rx = { type: 'form', pos: r.formErr, text: `Bit ${r.formErr} (${CAN.FIELD_NAMES[(frame.bits[r.formErr] || {}).f] || 'EOF'}) muss rezessiv sein → <b>Form-Fehler</b>.` };
    else rx = { type: null, text: 'Die Empfänger erkennen <b>keinen</b> Fehler: ' + (sender.type === 'ack' ? 'der ACK-Slot betrifft nur den Sender.' : sender.type === 'arb' ? 'Arbitrierung ist ein normaler Vorgang.' : 'die Störung würde nur der Sender bemerken (CRC/Stuffing zufällig erfüllt).') };
    const detectPos = sender.type === 'bit' ? Math.min(sender.pos, rx.pos != null ? rx.pos : Infinity) : sender.type === 'ack' ? sender.pos : rx.pos;
    T._detect = detectPos != null && isFinite(detectPos) ? detectPos : null;
    let ef = '';
    if (T._detect != null) {
      let k = 0;
      for (let i = T._detect - 1; i >= 0 && frame.bus[i] === 0 && k < 5; i--) k++;
      const bits = sender.type === 'bit' && sender.pos <= frame.stuffEnd && sender.pos === T._detect ? 12 - k : 7;
      ef = `<span>→ Error Frame ab Bit ${T._detect + 1}: ${bits} dominante Error-Flag-Bits + 8 Delimiter-Bits. Alle Knoten verwerfen den Rahmen, der Sender wiederholt ihn automatisch (TEC + 8, REC + 1).</span>`;
    }
    box.innerHTML = `<div class="err-box bad"><b>Störung: ${flips.size} Bit(s) gekippt (erstes: Bit ${first}, ${CAN.FIELD_NAMES[fb.f]}).</b>
      <span><b>Sender:</b> ${sender.text}</span><span><b>Empfänger:</b> ${rx.text}</span>${ef}
      <span class="hint">Der zuerst erkannte Fehler löst das Error Frame aus. Die CAN-CRC-15 hat eine Hamming-Distanz von 6: bis zu 5 zufällig verteilte Bitfehler werden sicher erkannt.</span></div>`;
    highlightDetect();
  }
  function highlightDetect() { document.querySelectorAll('#bitView .bit').forEach((el, i) => el.classList.toggle('detect', i === T._detect)); }

  function renderStats() {
    const f = frame, baud = CS.state.net.baud, dl = f.input.rtr ? 0 : f.input.dlc;
    const worst = f.input.ext ? Math.floor((54 + 8 * dl - 1) / 4) : Math.floor((34 + 8 * dl - 1) / 4);
    const rows = [
      ['Bits ohne Stuffing (SOF … EOF + IFS)', (f.nNoStuff - 3) + ' + 3'],
      ['Stuff-Bits', f.nStuff + ' (max. ' + worst + ')'],
      ['Bits gesamt', f.nTotal],
      ['Dauer bei ' + CS.fmtBaud(baud), CS.fmt((f.nTotal / baud) * 1e6, 1) + ' µs'],
      ['Nutzdaten-Effizienz', CS.fmt((dl * 8 / f.nTotal) * 100, 1) + ' %'],
      ['Max. Rahmenrate (100 % Buslast)', CS.fmt(baud / f.nTotal, 0) + ' /s']
    ];
    document.getElementById('bitStats').innerHTML = rows.map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  }
  function renderCrc() {
    const raw = frame.raw.filter((b) => b.f !== 'CRC').map((b) => b.v);
    const crc = frame.crc;
    document.getElementById('crc15Out').innerHTML = `<div class="out-box"><span>Gesicherte Bits (SOF … Daten, ohne Stuff-Bits): <b>${raw.length}</b></span>
      <span>CRC-Sequenz: <b class="mono">${crc.toString(2).padStart(15, '0')}</b> = <b class="mono">0x${CS.hex(crc, 4)}</b></span>
      <span class="hint">Polynomdivision: Bitfolge · x¹⁵ modulo g(x). Implementiert als 15-bit-Schieberegister mit XOR 0x4599, wenn das herausgeschobene Bit ≠ Eingangsbit.</span></div>`;
    const show = document.getElementById('crc15Steps').checked;
    document.getElementById('crc15StepsWrap').hidden = !show;
    if (show) {
      const steps = []; CAN.crc15(raw, steps);
      document.getElementById('crc15Table').innerHTML = '<thead><tr><th class="num">#</th><th>Bit</th><th>MSB</th><th>XOR?</th><th>Register (15 bit)</th></tr></thead><tbody>' +
        steps.map((s) => `<tr><td class="num">${s.i}</td><td class="mono">${s.bit}</td><td class="mono">${s.msb}</td><td>${s.xor ? '<span class="tag warn">⊕ 0x4599</span>' : ''}</td><td class="mono">${s.reg.toString(2).padStart(15, '0')}</td></tr>`).join('') + '</tbody>';
    }
  }
  function drawWave() {
    const cv = document.getElementById('bitWave');
    if (!cv.offsetParent) return;
    const { ctx, w, h: hh } = CS.fitCanvas(cv);
    ctx.clearRect(0, 0, w, hh);
    const n = frame.bus.length, pad = 40;
    const X = (i) => pad + (i / n) * (w - pad - 8);
    const Y = (u) => 10 + (1 - (u - 1) / 2.8) * (hh - 26);
    ctx.font = '11px ' + CS.css('--font'); ctx.fillStyle = CS.css('--muted'); ctx.textAlign = 'right';
    for (const u of [1.5, 2.5, 3.5]) { ctx.strokeStyle = CS.css('--grid'); ctx.beginPath(); ctx.moveTo(pad, Y(u)); ctx.lineTo(w - 8, Y(u)); ctx.stroke(); ctx.fillText(u + ' V', pad - 4, Y(u) + 4); }
    for (const i of flips) { ctx.fillStyle = CS.css('--bad-wash'); ctx.fillRect(X(i), 4, X(i + 1) - X(i), hh - 16); }
    frame.bits.forEach((b, i) => { if (b.f === 'STUFF') { ctx.fillStyle = CS.css('--f-stuff'); ctx.globalAlpha = 0.18; ctx.fillRect(X(i), 4, X(i + 1) - X(i), hh - 16); ctx.globalAlpha = 1; } });
    const line = (lvl, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      frame.bus.forEach((v, i) => { const y = Y(v === 0 ? lvl : 2.5); if (i === 0) ctx.moveTo(X(0), y); else ctx.lineTo(X(i), y); ctx.lineTo(X(i + 1), y); });
      ctx.stroke();
    };
    line(3.5, CS.css('--canh')); line(1.5, CS.css('--canl'));
    ctx.textAlign = 'left'; ctx.fillStyle = CS.css('--ink-2');
    ctx.fillText('CAN_H', pad + 4, Y(3.5) - 4); ctx.fillText('CAN_L', pad + 4, Y(1.5) + 12);
  }

  /* ---------------- Arbitrierung ---------------- */
  let arbList = [{ id: 0x124, ext: false, name: 'Joystick' }, { id: 0x126, ext: false, name: 'Winkelsensor' }, { id: 0x125, ext: false, name: 'Knoten 3' }];
  function renderArbInputs() {
    const box = document.getElementById('arbInputs');
    box.textContent = '';
    arbList.forEach((a, i) => {
      box.append(h('label', {}, [a.name + ' (hex)', h('input', { type: 'text', class: 'mono', value: CS.hex(a.id, a.ext ? 8 : 3), onchange: (e) => { a.id = parseInt(e.target.value.replace(/^0x/i, ''), 16) || 0; renderArb(); } })]));
      const ex = h('select', { onchange: (e) => { a.ext = e.target.value === '1'; renderArb(); } }, [h('option', { value: 0 }, '11 bit'), h('option', { value: 1 }, '29 bit')]);
      ex.value = a.ext ? 1 : 0;
      box.append(h('label', { style: 'width:80px' }, ['Format', ex]));
    });
    box.append(h('button', { class: 'btn small', onclick: () => { if (arbList.length < 4) arbList.push({ id: 0x7ff, ext: false, name: 'Knoten ' + (arbList.length + 1) }); renderArbInputs(); renderArb(); } }, '＋'));
    if (arbList.length > 2) box.append(h('button', { class: 'btn small', onclick: () => { arbList.pop(); renderArbInputs(); renderArb(); } }, '−'));
  }
  function renderArb() {
    const seqs = arbList.map((a) => [{ v: 0, f: 'SOF' }].concat(CAN.arbBits(a.id, a.ext, false)));
    const n = Math.max(...seqs.map((s) => s.length));
    const out = new Array(arbList.length).fill(-1);
    const bus = [];
    const alive = arbList.map(() => true);
    for (let k = 0; k < n; k++) {
      let b = 1;
      arbList.forEach((_, i) => { if (alive[i] && seqs[i][k]) b &= seqs[i][k].v; });
      bus.push(b);
      arbList.forEach((_, i) => { if (alive[i] && seqs[i][k] && seqs[i][k].v === 1 && b === 0) { alive[i] = false; out[i] = k; } });
    }
    const hdr = seqs.reduce((a, b) => (b.length > a.length ? b : a));
    let html = '<table class="arb-table"><thead><tr><th>Knoten</th>' + hdr.map((b, k) => `<th title="${CAN.FIELD_NAMES[b.f] || ''}">${b.f === 'SOF' ? 'S' : b.f === 'ID' || b.f === 'IDx' ? (b.f === 'ID' ? 'ID' + (10 - b.k + (hdr.length > 15 ? 18 : 0)) : 'ID' + (17 - b.k)) : b.f}</th>`).join('') + '</tr></thead><tbody>';
    arbList.forEach((a, i) => {
      html += `<tr class="${alive[i] ? 'win' : ''}"><td>${CS.esc(a.name)} ${CS.hexId(a.id, a.ext)}</td>`;
      for (let k = 0; k < n; k++) {
        const b = seqs[i][k];
        const lost = out[i] >= 0 && k > out[i];
        html += `<td class="${out[i] === k ? 'lostbit' : lost ? 'lost' : ''}">${b ? (lost ? '·' : b.v) : ''}</td>`;
      }
      html += '</tr>';
    });
    html += '<tr class="bus"><td>Bus (Wired-AND)</td>' + bus.map((b) => `<td>${b}</td>`).join('') + '</tr></tbody></table>';
    document.getElementById('arbView').innerHTML = html;
    const winner = arbList.filter((_, i) => alive[i]);
    document.getElementById('arbInfo').innerHTML = winner.length === 1
      ? `<b>${CS.esc(winner[0].name)}</b> gewinnt die Arbitrierung. ` + arbList.map((a, i) => out[i] >= 0 ? `${CS.esc(a.name)} sendet in Bit „${hdr[out[i]].f === 'ID' ? 'ID' + (10 - hdr[out[i]].k) : hdr[out[i]].f}“ eine rezessive 1, liest aber eine dominante 0 → bricht ab und wird Empfänger.` : '').join(' ') + ' Der Gewinner merkt von der Arbitrierung nichts – sie ist zerstörungsfrei. Beginn mit dem MSB, niedrigste ID = höchste Priorität.'
      : 'Mehrere Knoten mit identischem Arbitrierungsfeld: Sie senden gleichzeitig weiter und stören sich im Datenfeld (Bit-Fehler). IDs müssen im Netz eindeutig sein!';
  }

  /* ---------------- Bitstuffing üben ---------------- */
  function renderStuff() {
    const inp = document.getElementById('stuffIn').value.replace(/[^01]/g, '');
    const st = CAN.stuff(inp.split('').map(Number));
    document.getElementById('stuffOut').innerHTML = st.map((b) => (b.s ? `<span class="s">${b.v}</span>` : b.v)).join('') +
      `<span class="note">${inp.length} Bits → ${st.length} Bits (${st.length - inp.length} Stuff-Bits, unterstrichen). Ein Stuff-Bit zählt selbst wieder für die nächste 5er-Folge mit.</span>`;
    const rx = document.getElementById('destuffIn').value.replace(/[^01]/g, '');
    const d = CAN.destuff(rx.split('').map(Number));
    document.getElementById('destuffOut').innerHTML = d.error >= 0
      ? rx.split('').map((b, i) => (i === d.error ? `<span class="e">${b}</span>` : b)).join('') + `<span class="note fail">Stuff-Fehler in Bit ${d.error}: sechs gleiche Bits in Folge.</span>`
      : d.bits.join('') + `<span class="note ok">Gültig – nach Entfernen der Stuff-Bits ${d.bits.length} Nutzbits.</span>`;
  }

  T.init = function () {
    fillSrc();
    for (const id of ['bitId', 'bitExt', 'bitRtr', 'bitDlc', 'bitData']) document.getElementById(id).addEventListener('change', () => { document.getElementById('bitSrc').value = ''; flips.clear(); T.update(); });
    document.getElementById('bitSrc').addEventListener('change', () => { flips.clear(); fromSource(); T.update(); });
    document.getElementById('bitRestore').addEventListener('click', () => { flips.clear(); T.update(); });
    document.getElementById('crc15Steps').addEventListener('change', renderCrc);
    document.getElementById('stuffIn').addEventListener('input', renderStuff);
    document.getElementById('destuffIn').addEventListener('input', renderStuff);
    document.getElementById('arbLive').addEventListener('click', () => {
      const l = CS.sim.arbLog[CS.sim.arbLog.length - 1];
      if (!l) { CS.toast('Noch keine Arbitrierung mit mehreren Sendern in der Simulation – Simulation laufen lassen.', 'bad'); return; }
      arbList = l.list.map((x) => ({ id: x.id, ext: x.ext, name: x.name }));
      renderArbInputs(); renderArb();
      CS.toast('Arbitrierung bei t = ' + CS.fmtFix(l.t, 4) + ' s übernommen.');
    });
    window.addEventListener('resize', () => { if (active && frame) drawWave(); });
    CS.on('changed', () => { fillSrc(); syncArbNames(); });
    syncArbNames();
    renderArbInputs(); renderArb(); renderStuff();
    T.update();
  };
  function syncArbNames() {
    const m = CS.state.messages;
    const joy = m.find((x) => CS.nodeType(x.node) === 'joystick'), ang = m.find((x) => CS.nodeType(x.node) === 'angle');
    if (CS.state.scenario === 'imu') arbList = m.slice(0, 3).map((x) => ({ id: x.id, ext: x.ext, name: x.name }));
    else if (joy && ang) { arbList[0] = { id: joy.id, ext: joy.ext, name: 'Joystick' }; arbList[1] = { id: ang.id, ext: ang.ext, name: 'Winkelsensor' }; }
    if (document.getElementById('arbInputs')) { renderArbInputs(); renderArb(); }
  }
  T.setActive = function (on) {
    active = on;
    if (on) {
      fillSrc();
      if (document.getElementById('bitSrc').value && !flips.size) fromSource();
      T.update();
    }
  };
})();
