/* ==========================================================================
   CANsim – Reiter 3: Simulation, Trace, DBC, Signale und Grafik
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS, h = CS.h, SIM = CS.sim;
  const T = (CS.SimTab = {});
  let mode = 'fixed', filter = '', plot = null, lastTraceDraw = 0, lastPlotDraw = 0, active = false;

  /* ---------------- Empfangsdaten (gemeinsam für Trace, Grafik, E2E) ---------------- */
  const RX = (CS.rx = { ids: new Map(), series: new Map(), recent: new Map(), errCount: 0, frames: 0, dbc: null });
  RX.reset = function () { RX.ids.clear(); RX.series.clear(); RX.recent.clear(); RX.errCount = 0; RX.frames = 0; };

  /** E2E-Prüfung einer Botschaft (CRC-8 J1850 + Zähler) mit der Definition des Empfängers */
  CS.e2eCheck = function (def, data, prevCnt) {
    const crcS = def.signals.find((s) => s.src === 'crc' || s.isCrc), cntS = def.signals.find((s) => s.src === 'counter' || s.isCnt);
    const r = { hasCrc: !!crcS, hasCnt: !!cntS };
    if (crcS) {
      const cov = new Set(CS.sig.bytes(crcS));
      r.crcBytes = [...data].filter((_, i) => !cov.has(i));
      r.crcCalc = CS.crc8(r.crcBytes) & (Math.pow(2, crcS.len) - 1);
      r.crcRx = CS.sig.getRaw(data, crcS);
      r.crcOk = r.crcCalc === r.crcRx;
      r.crcSig = crcS;
    }
    if (cntS) {
      r.cnt = CS.sig.getRaw(data, cntS);
      r.cntMod = Math.pow(2, cntS.len);
      if (prevCnt != null) { const d = (r.cnt - prevCnt + r.cntMod) % r.cntMod; r.cntDelta = d; r.cntOk = d === 1; }
    }
    return r;
  };

  function onFrame(e) {
    const k = (e.type === 'error' ? 'err' : (e.ext ? 'x' : 's') + e.id);
    if (e.type === 'error') RX.errCount++; else RX.frames++;
    let st = RX.ids.get(k);
    if (!st) { st = { count: 0, last: null, dt: null }; RX.ids.set(k, st); }
    if (st.last != null) st.dt = e.t - st.last;
    st.last = e.t; st.count++; st.e = e;
    if (e.type !== 'data') return;
    // E2E mit der Kommunikationsmatrix
    const def = CS.state.messages.find((m) => m.key === e.key);
    if (def) {
      const list = RX.recent.get(e.key) || [];
      const prev = list.length ? list[list.length - 1].e2e.cnt : null;
      const r = CS.e2eCheck(def, e.data, prev);
      st.e2e = r;
      list.push({ t: e.t, data: e.data, e2e: r, flip: e.flip });
      if (list.length > 400) list.splice(0, 100);
      RX.recent.set(e.key, list);
    }
    // DBC-Dekodierung → Zeitreihen
    if (RX.dbc) {
      const dm = CS.dbc.find(RX.dbc, e.id, e.ext);
      if (dm) {
        for (const d of CS.dbc.decode(dm, e.data)) {
          const sk = dm.name + '|' + d.sig.name;
          let s = RX.series.get(sk);
          if (!s) { s = { t: [], v: [], sig: d.sig, msg: dm }; RX.series.set(sk, s); }
          s.t.push(e.t); s.v.push(d.phys); s.raw = d.raw;
          if (s.t.length > 15000) { s.t.splice(0, 5000); s.v.splice(0, 5000); }
        }
      }
    }
  }

  /* ---------------- DBC ---------------- */
  T.setDbc = function (db, text) {
    RX.dbc = db; RX.dbcText = text; RX.series.clear();
    const st = document.getElementById('dbcStatus');
    if (!db) { st.textContent = 'Keine Datenbank geladen – der Trace zeigt nur ID und Rohdaten.'; }
    else {
      const nS = db.messages.reduce((s, m) => s + m.signals.length, 0);
      const ids = new Set(CS.state.messages.map((m) => CS.dbc.key(m.id, m.ext)));
      const miss = CS.state.messages.filter((m) => !CS.dbc.find(db, m.id, m.ext));
      const viaPgn = CS.state.messages.filter((m) => m.ext && !db.byKey.has(CS.dbc.key(m.id, m.ext)) && CS.dbc.find(db, m.id, m.ext));
      st.innerHTML = `<b>${CS.esc(db.name)}</b>: ${db.messages.length} Botschaften, ${nS} Signale.` +
        (miss.length ? ` <span class="warnc">Nicht in der DBC: ${miss.map((m) => CS.esc(m.name) + ' (' + CS.hexId(m.id, m.ext) + ')').join(', ')}</span>` : '') +
        (viaPgn.length ? ` <span class="hint">J1939: ${viaPgn.map((m) => CS.hexId(m.id, m.ext)).join(', ')} über die PGN zugeordnet (DBC: ${viaPgn.map((m) => CS.hexId(CS.dbc.find(db, m.id, m.ext).id, true)).join(', ')} – andere Source Address).</span>` : '') +
        (db.messages.some((m) => !ids.has(CS.dbc.key(m.id, m.ext))) ? ' <span class="hint">Einige DBC-Botschaften werden im Netzwerk nicht gesendet.</span>' : '');
      // Standardzuordnung für die Grafik
      const ps = (CS.state.plotSel = CS.state.plotSel || {});
      if (!Object.keys(ps).some((k) => k.startsWith(db.name + '#'))) {
        const def = { DrvDmd_X: 1, DrvDmd_Y: 1, Winkel: 2, Button1: 3, flgUpperLim: 3, flgLowerLim: 3, AY: 1, AX: 1, AZ: 1, YAW_RATE: 2, ROLL_RATE: 2, PITCH_RATE: 2, TEMP_RATE_Z: 3, EngSpeed: 1 };
        for (const m of db.messages) for (const s of m.signals) if (def[s.name] && !(db.name.includes('MM710') && !m.ext)) ps[db.name + '#' + m.name + '|' + s.name] = def[s.name];
      }
      // vorhandenen Trace nachträglich dekodieren
      for (const e of SIM.trace) if (e.type === 'data') {
        const dm = CS.dbc.find(db, e.id, e.ext); if (!dm) continue;
        for (const d of CS.dbc.decode(dm, e.data)) {
          const sk = dm.name + '|' + d.sig.name;
          let s = RX.series.get(sk); if (!s) { s = { t: [], v: [], sig: d.sig, msg: dm }; RX.series.set(sk, s); }
          s.t.push(e.t); s.v.push(d.phys); s.raw = d.raw;
        }
      }
    }
    document.getElementById('dbcText').textContent = text || '';
    renderSigList(true); renderTrace(true); drawPlot(true);
    CS.emit('dbc');
  };
  function fillDbcSel() {
    const s = document.getElementById('dbcSel');
    s.textContent = '';
    const scn = CS.SCENARIOS[CS.state.scenario];
    const names = [...new Set(scn.dbcs.concat(Object.keys(CS.dbc.BUILTIN)))];
    s.append(h('option', { value: '#own' }, 'Aus eigener Kommunikationsmatrix (Reiter 2)'));
    for (const n of names) s.append(h('option', { value: n }, n));
    s.value = scn.dbcs[0] || '#own';
  }

  /* ---------------- Trace ---------------- */
  const traceName = (e) => {
    if (RX.dbc) { const dm = CS.dbc.find(RX.dbc, e.id, e.ext); if (dm) return dm.name; }
    return e.name || '';
  };
  const ERR_NAMES = { bit: 'Bit-Fehler', stuff: 'Stuff-Fehler', crc: 'CRC-Fehler', form: 'Form-Fehler', ack: 'ACK-Fehler' };
  function e2eTags(e2e) {
    if (!e2e) return '';
    let s = '';
    if (e2e.hasCrc) s += e2e.crcOk ? '<span class="tag ok">CRC ✓</span> ' : '<span class="tag bad">CRC ✕</span> ';
    if (e2e.hasCnt && e2e.cntOk != null) s += e2e.cntOk ? '<span class="tag ok">Zähler ✓</span>' : '<span class="tag bad">Zähler ' + (e2e.cntDelta === 0 ? 'steht' : '+' + e2e.cntDelta) + '</span>';
    return s;
  }
  function renderTrace(force) {
    const now = performance.now();
    if (!force && now - lastTraceDraw < 120) return;
    lastTraceDraw = now;
    const tb = document.getElementById('traceTable');
    const f = filter.toLowerCase();
    const match = (e) => !f || (e.name || '').toLowerCase().includes(f) || traceName(e).toLowerCase().includes(f) || CS.hex(e.id).toLowerCase().includes(f.replace(/^0x/, ''));
    let html = '<thead><tr><th class="num">Zeit [s]</th><th>ID</th><th>Name</th><th class="num">DLC</th><th>Daten (hex)</th>' + (mode === 'fixed' ? '<th class="num">Δt [ms]</th><th class="num">Anzahl</th>' : '') + '<th>Absicherung</th></tr></thead><tbody>';
    const rowOf = (e, st) => {
      if (e.type === 'error') {
        const er = e.err;
        return `<tr class="errrow"><td class="num">${CS.fmtFix(e.t, 4)}</td><td class="mono">–</td><td><b>Error Frame</b></td><td></td><td>${ERR_NAMES[er.type]} beim Senden von ${CS.esc(e.name)} (${CS.hexId(e.id, e.ext)}), erkannt von ${CS.esc(CS.nodeLabel(er.detector))}</td>` +
          (mode === 'fixed' ? `<td class="num">${st && st.dt != null ? CS.fmt(st.dt * 1000, 1) : ''}</td><td class="num">${st ? st.count : ''}</td>` : '') + '<td></td></tr>';
      }
      let r = `<tr><td class="num">${CS.fmtFix(e.t, 4)}</td><td class="mono">${CS.hexId(e.id, e.ext)}${e.ext ? ' x' : ''}</td><td>${CS.esc(traceName(e))}</td><td class="num">${e.dlc}</td><td class="mono">${CS.bytesHex(e.data)}</td>` +
        (mode === 'fixed' ? `<td class="num">${st && st.dt != null ? CS.fmt(st.dt * 1000, 1) : '–'}</td><td class="num">${st ? st.count : ''}</td>` : '') + `<td>${e2eTags(st ? st.e2e : null)}</td></tr>`;
      if (mode === 'fixed' && RX.dbc && document.getElementById('traceSigs').checked) {
        const dm = CS.dbc.find(RX.dbc, e.id, e.ext);
        if (dm) for (const d of CS.dbc.decode(dm, e.data)) r += `<tr class="trace-sig"><td colspan="2">${CS.esc(d.sig.name)}</td><td class="num" colspan="2">${d.text ? CS.esc(d.text) : CS.fmt(d.phys)} ${CS.esc(d.sig.unit)}</td><td class="mono">roh ${d.raw} = 0x${CS.hex(d.raw < 0 ? d.raw + Math.pow(2, d.sig.len) : d.raw)}</td><td colspan="3"></td></tr>`;
      }
      return r;
    };
    if (mode === 'fixed') {
      const rows = [...RX.ids.entries()].filter(([k, st]) => k !== 'err' && match(st.e)).sort((a, b) => CS.can.arbCompare(a[1].e, b[1].e));
      for (const [, st] of rows) html += rowOf(st.e, st);
      const er = RX.ids.get('err');
      if (er) html += rowOf(er.e, er);
      if (!rows.length && !er) html += '<tr><td colspan="8" class="hint">' + emptyText() + '</td></tr>';
    } else {
      const list = SIM.trace.filter(match).slice(-250).reverse();
      for (const e of list) html += rowOf(e, null);
      if (!list.length) html += '<tr><td colspan="8" class="hint">' + emptyText() + '</td></tr>';
    }
    tb.innerHTML = html + '</tbody>';
  }
  function emptyText() {
    const pc = CS.state.net.nodes.find((n) => n.type === 'pc');
    if (!pc) return 'Kein CAN-Interface (PC) im Netzwerk – ohne Interface sieht der Trace nichts. Im Reiter „Netzwerk“ das CAN-Interface platzieren und anschließen.';
    const a = CS.phys.analyze().nodes[pc.id];
    if (a && a.wiring !== 'ok') return 'Das CAN-Interface ist ' + CS.phys.WIRING_TEXT[a.wiring] + ' – es empfängt nichts.';
    return SIM.running ? 'Noch keine Botschaften empfangen …' : 'Simulation starten (▶ Start).';
  }

  /* ---------------- Signalliste ---------------- */
  let sigListKey = '';
  function renderSigList(force) {
    const box = document.getElementById('sigList');
    const db = RX.dbc;
    const key = db ? db.name + db.messages.length : '';
    if (force || key !== sigListKey) {
      sigListKey = key;
      box.textContent = '';
      if (!db) { box.append(h('p', { class: 'hint' }, 'Nach dem Laden einer DBC erscheinen hier alle Signale.')); return; }
      const ps = (CS.state.plotSel = CS.state.plotSel || {});
      for (const m of [...db.messages].sort((a, b) => CS.can.arbCompare(a, b))) {
        box.append(h('div', { class: 'sig-msg' }, m.name + ' · ' + CS.hexId(m.id, m.ext)));
        for (const s of m.signals) {
          const pk = db.name + '#' + m.name + '|' + s.name;
          const pp = h('div', { class: 'pp' });
          for (let p = 1; p <= 3; p++) {
            const b = h('button', { class: ps[pk] === p ? 'on' : '', title: 'In Fenster ' + p + ' darstellen', onclick: () => { ps[pk] = ps[pk] === p ? 0 : p; CS.save(); renderSigList(true); drawPlot(true); } }, p);
            pp.append(b);
          }
          box.append(h('div', { class: 'sig-row', title: (s.comment || '') + ` Startbit ${s.start}, ${s.len} bit, ${s.order === 'motorola' ? 'Motorola' : 'Intel'}, Faktor ${s.factor}, Offset ${s.offset}` }, [
            h('span', { class: 'snm' }, s.name), h('span', { class: 'sv', 'data-sk': m.name + '|' + s.name }, '–'), pp
          ]));
        }
      }
      colorPlotButtons();
    }
    for (const el of box.querySelectorAll('.sv')) {
      const s = RX.series.get(el.dataset.sk);
      el.textContent = s && s.v.length ? CS.fmt(s.v[s.v.length - 1]) + (s.sig.unit ? ' ' + s.sig.unit : '') : '–';
    }
  }
  function plotSeriesList() {
    const db = RX.dbc, ps = CS.state.plotSel || {};
    const panels = [[], [], []];
    if (!db) return panels;
    let ci = 0;
    for (const m of db.messages) for (const s of m.signals) {
      const p = ps[db.name + '#' + m.name + '|' + s.name];
      if (p) panels[p - 1].push({ key: m.name + '|' + s.name, sig: s, color: CS.seriesColor(ci++) });
    }
    return panels;
  }
  function colorPlotButtons() {
    const list = plotSeriesList().flat();
    const db = RX.dbc;
    document.querySelectorAll('#sigList .sig-row').forEach((row) => {
      const sk = row.querySelector('.sv').dataset.sk;
      const it = list.find((x) => x.key === sk);
      row.querySelectorAll('.pp button.on').forEach((b) => (b.style.background = it ? it.color : ''));
    });
    void db;
  }

  /* ---------------- Grafik ---------------- */
  function drawPlot(force) {
    if (!plot || !active) return;
    const now = performance.now();
    if (!force && now - lastPlotDraw < 50) return;
    lastPlotDraw = now;
    const win = +document.getElementById('plotWin').value;
    const t1 = Math.max(win, SIM.t), t0 = t1 - win;
    const panels = plotSeriesList().map((list, i) => ({
      empty: RX.dbc ? 'Fenster ' + (i + 1) + ': Signal in der Liste rechts mit „' + (i + 1) + '“ zuordnen' : 'Fenster ' + (i + 1) + ': zuerst eine DBC laden',
      series: list.map((it) => {
        const s = RX.series.get(it.key) || { t: [], v: [] };
        return { name: it.sig.name, unit: it.sig.unit, color: it.color, t: s.t, v: s.v, step: it.sig.len <= 4 };
      })
    }));
    plot.draw({ t0, t1, tNow: SIM.t, panels });
  }

  /* ---------------- Joystick ---------------- */
  function initJoystick() {
    const pad = document.getElementById('joyPad'), knob = document.getElementById('joyKnob');
    const R = 47;
    let dragging = false;
    const setKnob = () => {
      const j = SIM.world.joy;
      knob.style.transform = `translate(${(j.x / 1000) * R}px, ${(-j.y / 1000) * R}px)`;
      document.getElementById('joyVal').textContent = Math.round(j.x) + ' ‰ / ' + Math.round(j.y) + ' ‰';
    };
    T.setKnob = setKnob;
    const move = (e) => {
      const r = pad.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
      SIM.world.joy.x = Math.round((dx / R) * 1000); SIM.world.joy.y = Math.round((-dy / R) * 1000);
      setKnob();
    };
    pad.addEventListener('pointerdown', (e) => { dragging = true; pad.setPointerCapture(e.pointerId); move(e); });
    pad.addEventListener('pointermove', (e) => { if (dragging) move(e); });
    const rel = () => { dragging = false; SIM.world.joy.x = 0; SIM.world.joy.y = 0; setKnob(); };
    pad.addEventListener('pointerup', rel); pad.addEventListener('pointercancel', rel);
    const latched = [false, false, false, false];
    document.querySelectorAll('.joy-btns .btn').forEach((b) => {
      const i = +b.dataset.btn;
      const set = (v) => { SIM.world.joy.b[i] = v ? 1 : 0; b.classList.toggle('on', !!v); };
      b.addEventListener('pointerdown', () => set(1));
      b.addEventListener('pointerup', () => set(latched[i]));
      b.addEventListener('pointerleave', () => set(latched[i]));
      b.addEventListener('dblclick', () => { latched[i] = !latched[i]; set(latched[i]); });
    });
    const keys = {};
    const applyKeys = () => {
      if (dragging) return;
      SIM.world.joy.x = (keys.ArrowRight ? 1000 : 0) - (keys.ArrowLeft ? 1000 : 0);
      SIM.world.joy.y = (keys.ArrowUp ? 1000 : 0) - (keys.ArrowDown ? 1000 : 0);
      setKnob();
    };
    const onKey = (e, down) => {
      if (!active || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key.startsWith('Arrow')) { keys[e.key] = down; applyKeys(); e.preventDefault(); }
      if (/^[1-4]$/.test(e.key)) { const i = +e.key - 1; SIM.world.joy.b[i] = down || latched[i] ? 1 : 0; document.querySelector(`.joy-btns [data-btn="${i}"]`).classList.toggle('on', !!SIM.world.joy.b[i]); }
    };
    document.addEventListener('keydown', (e) => onKey(e, true));
    document.addEventListener('keyup', (e) => onKey(e, false));
    setKnob();
  }

  /* ---------------- Hubwerk-Darstellung ---------------- */
  function drawBoom() {
    const svg = document.getElementById('boomSvg');
    const B = SIM.BOOM, w = SIM.world, ang = w.boom.angle;
    const px = 95, py = 120, Lb = 170;
    const rad = (d) => (d * Math.PI) / 180;
    const ex = px + Lb * Math.cos(rad(ang)), ey = py - Lb * Math.sin(rad(ang));
    const ax = px + 70 * Math.cos(rad(ang)), ay = py - 70 * Math.sin(rad(ang));
    const arc = (a0, a1, r) => `M ${px + r * Math.cos(rad(a0))} ${py - r * Math.sin(rad(a0))} A ${r} ${r} 0 0 0 ${px + r * Math.cos(rad(a1))} ${py - r * Math.sin(rad(a1))}`;
    const up = ang >= B.max - 0.05, lo = ang <= B.min + 0.05;
    svg.innerHTML = `
      <rect x="10" y="160" width="280" height="6" rx="2" fill="var(--line-2)"/>
      <rect x="35" y="128" width="110" height="32" rx="5" fill="var(--panel-2)" stroke="var(--line-2)"/>
      <circle cx="58" cy="166" r="12" fill="var(--ink-2)"/><circle cx="122" cy="166" r="12" fill="var(--ink-2)"/>
      <path d="${arc(B.min, B.max, 42)}" stroke="var(--line-2)" stroke-width="6" fill="none" transform=""/>
      <line x1="${px}" y1="${py}" x2="${px + 50 * Math.cos(rad(B.max))}" y2="${py - 50 * Math.sin(rad(B.max))}" stroke="${up ? 'var(--bad)' : 'var(--line-2)'}" stroke-width="2" stroke-dasharray="3 3"/>
      <line x1="${px}" y1="${py}" x2="${px + 50 * Math.cos(rad(B.min))}" y2="${py - 50 * Math.sin(rad(B.min))}" stroke="${lo ? 'var(--bad)' : 'var(--line-2)'}" stroke-width="2" stroke-dasharray="3 3"/>
      <line x1="125" y1="150" x2="${ax}" y2="${ay}" stroke="var(--ink-2)" stroke-width="7" stroke-linecap="round"/>
      <line x1="125" y1="150" x2="${125 + (ax - 125) * 0.55}" y2="${150 + (ay - 150) * 0.55}" stroke="var(--s3)" stroke-width="10" stroke-linecap="round"/>
      <line x1="${px}" y1="${py}" x2="${ex}" y2="${ey}" stroke="var(--s2)" stroke-width="12" stroke-linecap="round"/>
      <path d="M ${ex} ${ey} l ${12 * Math.cos(rad(ang - 70))} ${-12 * Math.sin(rad(ang - 70))} l 14 8" stroke="var(--s2)" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="${px}" cy="${py}" r="6" fill="var(--card)" stroke="var(--ink)" stroke-width="2"/>
      <text x="292" y="18" text-anchor="end" font-size="13" fill="var(--ink)" font-weight="700">${CS.fmtFix(ang, 2)}°</text>
      <text x="292" y="34" text-anchor="end" font-size="11" fill="var(--muted)">${CS.fmtFix(w.boom.rate, 1)} °/s</text>
      <text x="8" y="18" font-size="11" fill="${up ? 'var(--bad)' : 'var(--muted)'}">obere Endlage ${B.max}°${up ? ' ●' : ''}</text>
      <text x="8" y="34" font-size="11" fill="${lo ? 'var(--bad)' : 'var(--muted)'}">untere Endlage ${B.min}°${lo ? ' ●' : ''}</text>`;
    document.getElementById('ecuMode').textContent = w.ecu.mode;
    document.getElementById('boomVal').textContent = CS.fmtFix(ang, 1) + '° / ' + CS.fmtFix(w.boom.rate, 1) + ' °/s';
  }

  /* ---------------- Status ---------------- */
  const STATE_TXT = { active: 'Error Active', passive: 'Error Passive', busoff: 'Bus Off' };
  function renderStatus() {
    document.getElementById('simTime').textContent = CS.fmtFix(SIM.t, 3) + ' s';
    document.getElementById('simLoad').textContent = SIM.t > 0.1 ? CS.fmt(SIM.load.value * 100, 1) + ' %' : '–';
    document.getElementById('simCount').textContent = RX.frames + ' / ' + RX.errCount;
    const box = document.getElementById('simNodes');
    const a = SIM.analysis || CS.phys.analyze();
    let html = '';
    for (const n of CS.state.net.nodes) {
      const rt = SIM.nrt[n.id] || { tec: 0, rec: 0, state: 'active', tx: 0, rx: 0 };
      const x = a.nodes[n.id];
      const conn = x && x.wiring !== 'ok' ? ' · <span class="fail">' + CS.phys.WIRING_TEXT[x.wiring] + '</span>' : x && !x.baudOk ? ' · <span class="fail">falsche Baudrate</span>' : '';
      html += `<div class="ns-row"><span class="nn">${CS.esc(n.name)}</span><span class="state-tag ${rt.state}">${STATE_TXT[rt.state]}</span><span class="nd">TEC ${rt.tec} · REC ${rt.rec} · gesendet ${rt.tx} · empfangen ${rt.rx}${rt.arbLost ? ' · Arbitrierung verloren ' + rt.arbLost : ''}${conn}</span></div>`;
    }
    box.innerHTML = html || '<p class="hint">Noch keine Knoten im Netzwerk.</p>';
    const hint = document.getElementById('simNetHint');
    const fails = a.checks.filter((c) => c.level === 'fail');
    hint.innerHTML = fails.length ? '<span class="warnc">Netzwerk mit ' + fails.length + ' Problem(en):</span> ' + fails.map((c) => CS.esc(c.title)).join(' · ') + ' – Auswirkungen siehe Trace und Reiter „Fehler“.' : 'Netzwerk ohne Beanstandung.';
    const scn = CS.state.scenario;
    document.getElementById('joyCard').hidden = scn !== 'boom' && !CS.state.net.nodes.some((n) => n.type === 'joystick');
    document.getElementById('boomCard').hidden = scn !== 'boom';
    document.getElementById('imuCard').hidden = scn !== 'imu' && !CS.state.net.nodes.some((n) => n.type === 'imu');
  }

  /* ---------------- Initialisierung ---------------- */
  T.init = function () {
    plot = CS.Plot(document.getElementById('plotCv'));
    initJoystick();
    fillDbcSel();
    document.getElementById('simStart').addEventListener('click', () => SIM.start());
    document.getElementById('simPause').addEventListener('click', () => SIM.pause());
    document.getElementById('simReset').addEventListener('click', () => { SIM.reset(); });
    document.getElementById('simSpeed').addEventListener('change', (e) => (SIM.speed = +e.target.value));
    document.querySelectorAll('#traceMode button').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode; document.querySelectorAll('#traceMode button').forEach((x) => x.classList.toggle('active', x === b)); renderTrace(true);
    }));
    document.getElementById('traceSigs').addEventListener('change', () => renderTrace(true));
    document.getElementById('traceFilter').addEventListener('input', (e) => { filter = e.target.value.trim(); renderTrace(true); });
    document.getElementById('traceClear').addEventListener('click', () => { SIM.trace = []; RX.reset(); renderTrace(true); drawPlot(true); });
    document.getElementById('traceCsv').addEventListener('click', () => {
      const rows = ['Zeit_s;ID;Extended;DLC;Daten;Name;Typ'];
      for (const e of SIM.trace) rows.push([e.t.toFixed(6), CS.hexId(e.id, e.ext), e.ext ? 1 : 0, e.dlc || '', e.data ? CS.bytesHex(e.data) : '', traceName(e), e.type === 'error' ? 'ErrorFrame:' + e.err.type : 'Data'].join(';'));
      CS.download('CANsim_Trace.csv', rows.join('\n'), 'text/csv');
    });
    document.getElementById('dbcLoad').addEventListener('click', () => {
      const v = document.getElementById('dbcSel').value;
      if (v === '#own') { const txt = CS.dbc.fromConfig(CS.state.messages, CS.nodeLabel); T.setDbc(CS.dbc.parse(txt, 'Eigene Kommunikationsmatrix'), txt); }
      else T.setDbc(CS.dbc.parse(CS.dbc.BUILTIN[v], v), CS.dbc.BUILTIN[v]);
      CS.toast('DBC geladen – Signale werden jetzt im Trace dekodiert.');
    });
    const ff = document.getElementById('dbcFile');
    document.getElementById('dbcFileBtn').addEventListener('click', () => ff.click());
    ff.addEventListener('change', () => {
      const f = ff.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        let txt = rd.result;
        const db = CS.dbc.parse(txt, f.name);
        if (!db.messages.length) CS.toast('Keine Botschaften in ' + f.name + ' gefunden.', 'bad');
        T.setDbc(db, txt); ff.value = '';
      };
      rd.readAsText(f, 'windows-1252');
    });
    document.getElementById('dbcUnload').addEventListener('click', () => T.setDbc(null, ''));
    document.getElementById('dbcView').addEventListener('click', () => { const p = document.getElementById('dbcText'); p.hidden = !p.hidden; });
    document.getElementById('plotWin').addEventListener('change', () => drawPlot(true));
    document.getElementById('autoChk').addEventListener('change', (e) => { CS.state.settings.auto = e.target.checked; CS.save(); });
    document.getElementById('imuMotion').addEventListener('change', (e) => (SIM.world.imu.motion = e.target.checked));
    window.addEventListener('resize', () => drawPlot(true));
    CS.on('frame', onFrame);
    CS.on('tick', () => {
      renderStatus();
      if (!active) return;
      renderTrace(); renderSigList(false); drawPlot(); drawBoom();
    });
    CS.on('sim-reset', () => { RX.reset(); if (T.setKnob) T.setKnob(); document.getElementById('imuMotion').checked = false; renderTrace(true); renderStatus(); drawBoom(); drawPlot(true); });
    CS.on('changed', (w) => {
      if (w === 'all') { fillDbcSel(); T.setDbc(null, ''); document.getElementById('autoChk').checked = !!CS.state.settings.auto; }
      renderStatus(); renderTrace(true);
    });
    document.getElementById('autoChk').checked = !!CS.state.settings.auto;
    renderStatus(); drawBoom();
  };
  T.setActive = function (on) {
    active = on;
    if (on) { renderStatus(); renderTrace(true); renderSigList(true); drawPlot(true); drawBoom(); }
  };
})();
