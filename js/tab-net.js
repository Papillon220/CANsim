/* ==========================================================================
   CANsim – Reiter 1: Netzwerk aufbauen (Knoten, Verdrahtung, Abschluss)
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS, P = CS.phys, G = P.GEO;
  const T = (CS.NetTab = {});
  const NS = 'http://www.w3.org/2000/svg';
  let svg, sel = null, pendingPin = null, drag = null;

  const S = (tag, attrs, parent) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    if (parent) parent.append(el);
    return el;
  };
  const net = () => CS.state.net;
  const lineY = (ln) => (ln === 'H' ? G.yH : G.yL);
  const isTop = (n) => n.y + G.nodeH / 2 < (G.yH + G.yL) / 2;
  const pinY = (n) => (isTop(n) ? n.y + G.nodeH : n.y);

  function svgPoint(e) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  /* ---------------- Knoten hinzufügen ---------------- */
  function freeSpot() {
    const nodes = net().nodes;
    const slots = [];
    for (const y of [40, 350]) for (let x = 90; x <= 780; x += 175) slots.push({ x, y });
    return slots.find((s) => !nodes.some((n) => Math.abs(n.x - s.x) < 120 && Math.abs(n.y - s.y) < 60)) || { x: 400, y: 40 };
  }
  function addNode(type, id, at) {
    const t = CS.NODE_TYPES[type];
    if (!id) { let k = 1; while (CS.nodeById('n' + k)) k++; id = 'n' + k; }
    const name = t.multi ? t.label + ' ' + String.fromCharCode(64 + (+id.slice(1) || 1)) : t.label;
    const p = at || freeSpot();
    const n = { id, type, name, x: p.x, y: p.y, pinH: null, pinL: null, stub: 0.2, baud: null, term: 0, silent: false };
    clampNode(n);
    net().nodes.push(n);
    sel = { kind: 'node', id };
    CS.changed('net');
  }
  function addRes(x) {
    const r = { id: CS.uid('r'), x: x != null ? x : (G.x0 + G.x1) / 2, R: 120 };
    net().res.push(r);
    sel = { kind: 'res', id: r.id };
    CS.changed('net');
  }
  function clampNode(n) {
    n.x = CS.clamp(n.x, G.x0 - 70, G.x1 - 80);
    if (isTop(n)) n.y = CS.clamp(n.y, 8, G.yH - G.nodeH - 36);
    else n.y = CS.clamp(n.y, G.yL + 36, G.H - G.nodeH - 8);
  }

  /* ---------------- Musterlösung ---------------- */
  T.solution = function () {
    const scn = CS.SCENARIOS[CS.state.scenario];
    const ids = scn.nodes.length ? scn.nodes : ['n1', 'n2', 'pc'];
    const types = scn.nodes.length ? scn.nodeTypes : { n1: 'gen', n2: 'gen', pc: 'pc' };
    net().nodes = []; net().res = [];
    const n = ids.length, span = G.x1 - G.x0 - 180;
    ids.forEach((id, i) => {
      const t = CS.NODE_TYPES[types[id]];
      const x = G.x0 + 10 + (n > 1 ? (i * span) / (n - 1) : 0);
      const node = { id, type: types[id], name: t.multi ? t.label + ' ' + String.fromCharCode(65 + i) : t.label, x, y: i % 2 ? 360 : 44, pinH: 'H', pinL: 'L', stub: 0.2, baud: null, term: 0, silent: false };
      clampNode(node);
      net().nodes.push(node);
    });
    net().res.push({ id: CS.uid('r'), x: G.x0 + 8, R: 120 }, { id: CS.uid('r'), x: G.x1 - 8, R: 120 });
    sel = null;
    CS.changed('net');
    CS.toast('Musterlösung: alle Knoten korrekt angeschlossen, 2 × 120 Ω an den Busenden.');
  };

  /* ---------------- Zeichnen ---------------- */
  T.render = function () {
    if (!svg) return;
    const a = P.analyze();
    svg.textContent = '';
    const cH = 'var(--canh)', cL = 'var(--canl)';
    // Maßstab
    const L = net().busLength, g = S('g', {}, svg);
    const yR = G.yL + 22;
    S('line', { x1: G.x0, y1: yR, x2: G.x1, y2: yR, stroke: 'var(--line-2)', 'stroke-width': 1 }, g);
    const step = L <= 20 ? 2 : L <= 50 ? 5 : L <= 200 ? 20 : 100;
    for (let m = 0; m <= L + 1e-9; m += step) {
      const x = G.x0 + (m / L) * (G.x1 - G.x0);
      S('line', { x1: x, y1: yR - 3, x2: x, y2: yR + 3, stroke: 'var(--line-2)' }, g);
      S('text', { x, y: yR + 14, 'text-anchor': 'middle', class: 'lbl' }, g).textContent = m + ' m';
    }
    // Endbereiche
    const tolPx = (a.endTol / L) * (G.x1 - G.x0);
    for (const [x, w, lab] of [[G.x0, tolPx, 'Busende A'], [G.x1 - tolPx, tolPx, 'Busende B']]) {
      S('rect', { x, y: G.yH - 14, width: w, height: G.yL - G.yH + 28, fill: 'var(--accent-wash)', opacity: 0.55, rx: 4 }, svg);
      S('text', { x: lab.endsWith('A') ? G.x0 : G.x1, y: G.yH - 20, 'text-anchor': lab.endsWith('A') ? 'start' : 'end', class: 'lbl b' }, svg).textContent = lab;
    }
    // Busleitungen
    for (const [ln, y, c, lab] of [['H', G.yH, cH, 'CAN_H'], ['L', G.yL, cL, 'CAN_L']]) {
      const hit = S('line', { x1: G.x0, y1: y, x2: G.x1, y2: y, class: 'bus-hit', 'data-line': ln }, svg);
      S('line', { x1: G.x0, y1: y, x2: G.x1, y2: y, stroke: c, 'stroke-width': 4, 'stroke-linecap': 'round', class: 'bus-line' + (pendingPin ? ' hot' : ''), 'pointer-events': 'none' }, svg);
      S('text', { x: G.x0 - 8, y: y + 4, 'text-anchor': 'end', class: 'lbl b', fill: c, style: 'fill:' + c }, svg).textContent = lab;
      hit.addEventListener('pointerdown', (e) => { if (pendingPin) { e.stopPropagation(); connect(pendingPin.id, pendingPin.pin, ln); pendingPin = null; } });
    }
    // Abschlusswiderstände
    for (const r of net().res) {
      const gr = S('g', { class: 'res' + (sel && sel.kind === 'res' && sel.id === r.id ? ' sel' : ''), transform: `translate(${r.x},0)` }, svg);
      S('line', { x1: 0, y1: G.yH, x2: 0, y2: G.yL, stroke: 'var(--ink-2)', 'stroke-width': 2 }, gr);
      S('rect', { x: -7, y: (G.yH + G.yL) / 2 - 15, width: 14, height: 30, rx: 2 }, gr);
      S('circle', { cx: 0, cy: G.yH, r: 4, fill: cH }, gr);
      S('circle', { cx: 0, cy: G.yL, r: 4, fill: cL }, gr);
      const right = r.x < G.x1 - 60;
      S('text', { x: right ? 11 : -11, y: (G.yH + G.yL) / 2 + 4, 'text-anchor': right ? 'start' : 'end' }, gr).textContent = CS.fmtOhm(r.R).replace(' ', ' ');
      gr.addEventListener('pointerdown', (e) => startDrag(e, { kind: 'res', id: r.id, ox: svgPoint(e).x - r.x }));
    }
    // Knoten mit Stichleitungen
    for (const n of net().nodes) {
      const info = a.nodes[n.id];
      const top = isTop(n), py = pinY(n);
      // Leitungen
      for (const pin of ['H', 'L']) {
        const tgt = pin === 'H' ? n.pinH : n.pinL;
        if (!tgt) continue;
        const x = P.pinX(n, pin), y2 = lineY(tgt);
        const ok = tgt === pin;
        const isSel = sel && sel.kind === 'wire' && sel.id === n.id && sel.pin === pin;
        const col = ok ? (pin === 'H' ? cH : cL) : 'var(--bad)';
        S('line', { x1: x, y1: py, x2: x, y2: y2, stroke: col, class: 'wire' + (isSel ? ' sel' : ''), 'stroke-dasharray': ok ? null : '6 3' }, svg);
        const hit = S('line', { x1: x, y1: py, x2: x, y2: y2, class: 'wire-hit' }, svg);
        hit.addEventListener('pointerdown', (e) => { e.stopPropagation(); sel = { kind: 'wire', id: n.id, pin }; T.render(); renderInspector(); });
        S('circle', { cx: x, cy: y2, r: 4.5, fill: col }, svg);
      }
      const gn = S('g', { class: 'node' + (sel && sel.kind === 'node' && sel.id === n.id ? ' sel' : ''), transform: `translate(${n.x},${n.y})` }, svg);
      S('rect', { class: 'body', width: G.nodeW, height: G.nodeH, rx: 8 }, gn);
      const t = CS.NODE_TYPES[n.type];
      S('rect', { x: 8, y: top ? 9 : 25, width: 30, height: 18, rx: 4, fill: 'var(--accent-wash)' }, gn);
      S('text', { x: 23, y: top ? 22 : 38, 'text-anchor': 'middle', style: 'font-size:9.5px;fill:var(--accent-ink)' }, gn).textContent = t.short;
      S('text', { x: 44, y: top ? 22 : 38 }, gn).textContent = n.name.length > 13 ? n.name.slice(0, 12) + '…' : n.name;
      const subs = [];
      if (n.term) subs.push(n.term + ' Ω intern');
      if (n.baud && n.baud !== net().baud) subs.push(CS.fmtBaud(n.baud));
      if (n.silent) subs.push('Silent');
      if (!subs.length) subs.push('Stich ' + CS.fmt(n.stub) + ' m');
      S('text', { x: 44, y: top ? 38 : 54, class: 'sub' }, gn).textContent = subs.join(' · ');
      const w = info ? info.wiring : 'open';
      S('circle', { cx: G.nodeW - 12, cy: top ? 16 : G.nodeH - 16, r: 6, fill: w === 'ok' && info.baudOk ? 'var(--good)' : w === 'open' ? 'var(--line-2)' : 'var(--bad)', class: 'status-dot' }, gn);
      gn.addEventListener('pointerdown', (e) => startDrag(e, { kind: 'node', id: n.id, ox: svgPoint(e).x - n.x, oy: svgPoint(e).y - n.y }));
      // Pins
      for (const pin of ['H', 'L']) {
        const x = P.pinX(n, pin);
        const gp = S('g', { class: 'pin' }, svg);
        const pend = pendingPin && pendingPin.id === n.id && pendingPin.pin === pin;
        S('circle', { cx: x, cy: py, r: pend ? 10 : 8.5, fill: pin === 'H' ? cH : cL, stroke: pend ? 'var(--ink)' : 'var(--card)' }, gp);
        S('text', { x, y: py + 3.5, 'text-anchor': 'middle' }, gp).textContent = pin;
        gp.addEventListener('pointerdown', (e) => startDrag(e, { kind: 'pin', id: n.id, pin, x0: x, y0: py }));
      }
    }
    if (drag && drag.kind === 'pin' && drag.moved) S('line', { x1: drag.x0, y1: drag.y0, x2: drag.x, y2: drag.y, class: 'temp' }, svg);
    // HUD
    const nOk = Object.values(a.nodes).filter((x) => x.wiring === 'ok').length;
    document.getElementById('netHud').textContent = `${net().nodes.length} Knoten (${nOk} korrekt) · ${net().res.length} Widerstände · ${CS.fmtBaud(net().baud)} · ${CS.fmt(net().busLength)} m`;
  };

  /* ---------------- Ziehen & Verbinden ---------------- */
  function startDrag(e, d) {
    e.stopPropagation(); e.preventDefault();
    drag = Object.assign(d, { moved: false, sx: e.clientX, sy: e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (d.kind === 'node' || d.kind === 'res') { sel = { kind: d.kind, id: d.id }; renderInspector(); }
  }
  function onMove(e) {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
    if (!drag.moved) return;
    const p = svgPoint(e);
    if (drag.kind === 'node') {
      const n = CS.nodeById(drag.id);
      n.x = p.x - drag.ox; n.y = p.y - drag.oy; clampNode(n);
    } else if (drag.kind === 'res') {
      const r = net().res.find((x) => x.id === drag.id);
      r.x = CS.clamp(p.x - drag.ox, G.x0, G.x1);
    } else if (drag.kind === 'pin') { drag.x = p.x; drag.y = p.y; }
    T.render();
  }
  function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === 'pin') {
      if (!d.moved) { pendingPin = { id: d.id, pin: d.pin }; sel = { kind: 'node', id: d.id }; T.render(); renderInspector(); return; }
      const p = svgPoint(e);
      const ln = Math.abs(p.y - G.yH) < 16 ? 'H' : Math.abs(p.y - G.yL) < 16 ? 'L' : null;
      if (ln && p.x >= G.x0 - 5 && p.x <= G.x1 + 5) connect(d.id, d.pin, ln);
      else { const n = CS.nodeById(d.id); n['pin' + d.pin] = null; CS.changed('net'); }
      return;
    }
    if (d.moved) CS.changed('net'); else { T.render(); renderInspector(); }
  }
  function connect(id, pin, ln) {
    const n = CS.nodeById(id);
    n['pin' + pin] = ln;
    pendingPin = null;
    if (pin !== ln) CS.toast('Achtung: Pin ' + pin + ' an CAN_' + ln + ' angeschlossen.', 'bad');
    CS.changed('net');
  }
  function removeSel() {
    if (!sel) return;
    if (sel.kind === 'node') { net().nodes = net().nodes.filter((n) => n.id !== sel.id); }
    else if (sel.kind === 'res') { net().res = net().res.filter((r) => r.id !== sel.id); }
    else if (sel.kind === 'wire') { const n = CS.nodeById(sel.id); if (n) n['pin' + sel.pin] = null; }
    sel = null;
    CS.changed('net');
  }

  /* ---------------- Inspektor ---------------- */
  function renderInspector() {
    const box = document.getElementById('inspector');
    box.textContent = '';
    const h = CS.h;
    if (!sel) { box.append(h('p', { class: 'hint' }, 'Element anklicken, um es zu bearbeiten.')); return; }
    const wrap = h('div', { class: 'insp' });
    box.append(wrap);
    if (sel.kind === 'node') {
      const n = CS.nodeById(sel.id);
      if (!n) { sel = null; return renderInspector(); }
      const t = CS.NODE_TYPES[n.type];
      const a = P.analyze().nodes[n.id];
      wrap.append(h('p', { class: 'hint' }, t.desc));
      wrap.append(h('label', {}, ['Name', h('input', { type: 'text', value: n.name, onchange: (e) => { n.name = e.target.value || t.label; CS.changed('net'); } })]));
      const bsel = h('select', { onchange: (e) => { n.baud = +e.target.value || null; CS.changed('net'); } }, [
        h('option', { value: 0 }, 'wie Bus (' + CS.fmtBaud(net().baud) + ')'),
        ...[125000, 250000, 500000, 1000000].map((b) => h('option', { value: b }, CS.fmtBaud(b)))
      ]);
      bsel.value = n.baud || 0;
      wrap.append(h('div', { class: 'grid2' }, [
        h('label', {}, ['Bitrate des Knotens', bsel]),
        h('label', {}, ['Stichleitung [m]', h('input', { type: 'number', min: 0, max: 5, step: 0.05, value: n.stub, onchange: (e) => { n.stub = Math.max(0, +e.target.value || 0); CS.changed('net'); } })])
      ]));
      if (t.term) {
        const ts = h('select', { onchange: (e) => { n.term = +e.target.value; CS.changed('net'); } }, [h('option', { value: 0 }, 'aus'), h('option', { value: 120 }, '120 Ω zugeschaltet')]);
        ts.value = n.term;
        wrap.append(h('label', {}, ['Interner Abschluss', ts]));
      }
      if (t.silent) wrap.append(h('label', { class: 'chk' }, [h('input', { type: 'checkbox', checked: n.silent, onchange: (e) => { n.silent = e.target.checked; CS.changed('net'); } }), 'Silent Mode (nur mithören, kein ACK)']));
      const st = a ? P.WIRING_TEXT[a.wiring] : '';
      wrap.append(h('div', { class: 'stats compact' }, [
        h('div', { class: 'stat' }, [h('span', { class: 'k' }, 'Anschluss'), h('span', { class: 'v ' + (a && a.wiring === 'ok' ? 'ok' : 'fail') }, st)]),
        h('div', { class: 'stat' }, [h('span', { class: 'k' }, 'Pin H → / Pin L →'), h('span', { class: 'v' }, (n.pinH ? 'CAN_' + n.pinH : '–') + ' / ' + (n.pinL ? 'CAN_' + n.pinL : '–'))]),
        h('div', { class: 'stat' }, [h('span', { class: 'k' }, 'Position am Bus'), h('span', { class: 'v' }, CS.fmt(a ? a.pos : 0, 1) + ' m')])
      ]));
      wrap.append(h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn small', onclick: () => { n.pinH = null; n.pinL = null; CS.changed('net'); } }, 'Verbindungen lösen'),
        h('button', { class: 'btn small danger', onclick: removeSel }, 'Knoten entfernen')
      ]));
    } else if (sel.kind === 'res') {
      const r = net().res.find((x) => x.id === sel.id);
      if (!r) { sel = null; return renderInspector(); }
      const inp = h('input', { type: 'number', min: 1, step: 1, value: r.R, onchange: (e) => { r.R = Math.max(1, +e.target.value || 120); CS.changed('net'); } });
      wrap.append(h('p', { class: 'hint' }, 'Abschlusswiderstand zwischen CAN_H und CAN_L. Am Leitungsende verhindert ein Widerstand in Höhe des Wellenwiderstands Reflexionen (Reflexionsfaktor r = (R − Z₀)/(R + Z₀)).'));
      wrap.append(h('label', {}, ['Widerstand [Ω]', inp]));
      wrap.append(h('div', { class: 'quick' }, [60, 100, 120, 240, 1000, 10000].map((v) => h('button', { class: 'btn small' + (r.R === v ? ' on' : ''), onclick: () => { r.R = v; CS.changed('net'); } }, CS.fmtOhm(v)))));
      const pos = P.toMeter(r.x), gm = (r.R - P.Z0) / (r.R + P.Z0);
      wrap.append(h('div', { class: 'stats compact' }, [
        h('div', { class: 'stat' }, [h('span', { class: 'k' }, 'Position'), h('span', { class: 'v' }, CS.fmt(pos, 2) + ' m')]),
        h('div', { class: 'stat' }, [h('span', { class: 'k' }, 'Reflexionsfaktor (am Ende)'), h('span', { class: 'v' }, CS.fmtFix(gm, 2))]),
        h('div', { class: 'stat' }, [h('span', { class: 'k' }, 'Verlustleistung (dominant, 2 V)'), h('span', { class: 'v' }, CS.fmt((4 / r.R) * 1000, 1) + ' mW')])
      ]));
      wrap.append(h('button', { class: 'btn small danger', onclick: removeSel }, 'Widerstand entfernen'));
    } else if (sel.kind === 'wire') {
      const n = CS.nodeById(sel.id);
      const tgt = n && n['pin' + sel.pin];
      wrap.append(h('p', {}, `Stichleitung: ${n ? n.name : ''} Pin ${sel.pin} → CAN_${tgt}`));
      if (tgt && tgt !== sel.pin) wrap.append(h('p', { class: 'fail' }, 'Falsch verdrahtet: Pin ' + sel.pin + ' gehört an CAN_' + sel.pin + '.'));
      wrap.append(h('button', { class: 'btn small danger', onclick: removeSel }, 'Verbindung entfernen'));
    }
  }

  /* ---------------- Prüfung, Multimeter, Oszilloskop ---------------- */
  function renderChecks() {
    const a = P.analyze();
    const ul = document.getElementById('netChecks');
    ul.textContent = '';
    for (const c of a.checks) {
      ul.append(CS.h('li', { class: c.level }, [CS.h('span', { class: 'ic' }, c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'), CS.h('b', {}, c.title), CS.h('span', { class: 'd' }, c.detail)]));
    }
    document.getElementById('meterVal').textContent = a.terms.length || Object.values(a.nodes).some((x) => x.onBus) ? CS.fmtOhm(a.Rdc) : 'OL';
    const nT = a.terms.length;
    document.getElementById('meterHint').textContent = nT
      ? a.terms.map((t) => t.label + ' = ' + CS.fmtOhm(t.R) + ' bei ' + CS.fmt(t.pos, 1) + ' m').join(' · ') + '. Die Eingangswiderstände der Transceiver (je ≈ 30 kΩ) liegen parallel.'
      : 'Kein Abschluss: Es messen nur die hochohmigen Eingänge der Transceiver.';
  }

  let scopeT = 0;
  function scheduleScope() { clearTimeout(scopeT); scopeT = setTimeout(drawScope, 120); }
  function fillScopeSelects() {
    const a = P.analyze();
    const onBus = Object.values(a.nodes).filter((x) => x.onBus);
    for (const [id, list] of [['scopeTx', onBus], ['scopeRx', Object.values(a.nodes).filter((x) => x.onBus)]]) {
      const s = document.getElementById(id), old = s.value;
      s.textContent = '';
      for (const x of list) s.append(CS.h('option', { value: x.node.id }, x.node.name));
      if (list.some((x) => x.node.id === old)) s.value = old;
      else if (id === 'scopeRx' && list.length > 1) s.value = list[list.length - 1].node.id;
      if (id === 'scopeRx' && list.length > 1 && s.value === document.getElementById('scopeTx').value) s.value = list.find((x) => x.node.id !== s.value).node.id;
    }
  }
  function drawScope() {
    const cv = document.getElementById('scopeCv');
    if (!cv.offsetParent) return;
    const { ctx, w, h } = CS.fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const info = document.getElementById('scopeInfo');
    const a = P.analyze();
    const tx = document.getElementById('scopeTx').value, rx = document.getElementById('scopeRx').value;
    ctx.font = '12px ' + CS.css('--font');
    if (!tx || !a.nodes[tx] || !a.nodes[tx].onBus) {
      ctx.fillStyle = CS.css('--muted'); ctx.fillText('Mindestens einen Knoten mit beiden Adern an den Bus anschließen.', 16, 24);
      info.textContent = ''; return;
    }
    const sim = P.simulate(a, tx, P.TEST_BITS);
    const v = sim.v[rx] || sim.v[tx];
    const samples = sim.samples[rx] || [];
    const showHL = document.getElementById('scopeHL').checked;
    const pad = { l: 46, r: 12, t: 22, b: 22 };
    const vmin = showHL ? -1.5 : -1, vmax = showHL ? 4 : 3.5;
    const X = (t) => pad.l + (t / sim.T) * (w - pad.l - pad.r);
    const Y = (u) => pad.t + (1 - (u - vmin) / (vmax - vmin)) * (h - pad.t - pad.b);
    // Raster
    ctx.strokeStyle = CS.css('--grid'); ctx.fillStyle = CS.css('--muted'); ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let u = Math.ceil(vmin); u <= vmax; u += 0.5) {
      const y = Math.round(Y(u)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      if (Number.isInteger(u)) ctx.fillText(u + ' V', pad.l - 6, y);
    }
    // Schwellenband 0,5 … 0,9 V
    ctx.fillStyle = CS.css('--warn-wash'); ctx.fillRect(pad.l, Y(P.TH_DOM), w - pad.l - pad.r, Y(P.TH_REC) - Y(P.TH_DOM));
    // Bitraster und Bitwerte
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (let k = 0; k <= P.TEST_BITS.length; k++) {
      const x = Math.round(X((sim.idle + k) * sim.tBit)) + 0.5;
      ctx.strokeStyle = CS.css('--line'); ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.setLineDash([]);
      if (k < P.TEST_BITS.length) { ctx.fillStyle = CS.css('--ink-2'); ctx.fillText(P.TEST_BITS[k], X((sim.idle + k + 0.5) * sim.tBit), 15); }
    }
    ctx.fillStyle = CS.css('--muted'); ctx.textAlign = 'left'; ctx.fillText('Bits:', 4, 15);
    // Kurven
    const stepN = Math.max(1, Math.floor(v.length / (w * 2)));
    const curve = (fn, col, lw) => {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i < v.length; i += stepN) { const x = X(i * sim.dt), y = Y(fn(v[i])); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    };
    if (showHL) { curve((u) => 2.5 + u / 2, CS.css('--canh'), 1.5); curve((u) => 2.5 - u / 2, CS.css('--canl'), 1.5); }
    curve((u) => u, CS.css('--ink'), 2);
    // Abtastpunkte
    let nBad = 0, minM = Infinity;
    for (const s of samples) {
      const x = X(s.t), y = Y(s.v);
      if (!s.ok) nBad++;
      minM = Math.min(minM, s.margin);
      ctx.fillStyle = s.ok ? CS.css('--good') : CS.css('--bad');
      ctx.strokeStyle = CS.css('--surface'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill(); ctx.stroke();
    }
    // Legende
    ctx.font = '11px ' + CS.css('--font'); ctx.fillStyle = CS.css('--ink-2'); ctx.textAlign = 'left';
    ctx.fillText('U_diff (weiß/schwarz)' + (showHL ? ' · CAN_H · CAN_L' : '') + ' · Abtastpunkte ● · Schwellenband 0,5 … 0,9 V · Bitzeit ' + CS.fmt(sim.tBit) + ' ns', pad.l, h - 6);
    const txn = a.nodes[tx].node.name, rxn = a.nodes[rx] ? a.nodes[rx].node.name : txn;
    info.innerHTML = nBad
      ? `<span class="fail">${nBad} von ${samples.length} Bits werden bei „${CS.esc(rxn)}“ falsch abgetastet</span> – ${explain(a)}`
      : `<span class="ok">Alle Bits von „${CS.esc(txn)}“ werden bei „${CS.esc(rxn)}“ korrekt erkannt</span> (minimaler Abstand zur Schwelle ${CS.fmtFix(minM, 2)} V). ${explain(a)}`;
  }
  function explain(a) {
    if (!a.terms.length) return 'Ohne Abschluss entlädt sich die Leitung nach einem dominanten Bit nur über die hochohmigen Empfängereingänge – rezessive Bits werden zu spät erreicht.';
    if (!a.endA.length || !a.endB.length) return 'Am offenen Ende wird die Welle vollständig reflektiert (r = 1) – Überschwinger und Treppenstufen an den Flanken.';
    if (Math.abs(a.gA) > 0.15 || Math.abs(a.gB) > 0.15) return 'Fehlanpassung: r = ' + CS.fmtFix(a.gA, 2) + ' / ' + CS.fmtFix(a.gB, 2) + '. Zu kleine Widerstände verringern außerdem den Differenzpegel.';
    return 'Angepasster Abschluss (r ≈ 0): saubere Flanken, keine Reflexionen.';
  }

  /* ---------------- Initialisierung ---------------- */
  T.init = function () {
    svg = document.getElementById('netSvg');
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointerdown', () => { if (pendingPin) { pendingPin = null; } sel = null; T.render(); renderInspector(); });
    svg.addEventListener('dragover', (e) => e.preventDefault());
    svg.addEventListener('drop', (e) => {
      e.preventDefault();
      const d = e.dataTransfer.getData('text/plain'); if (!d) return;
      const p = svgPoint(e);
      if (d === 'res') addRes(CS.clamp(p.x, G.x0, G.x1));
      else { const [type, id] = d.split(':'); addNode(type, id || null, { x: p.x - G.nodeW / 2, y: p.y - G.nodeH / 2 }); }
    });
    document.addEventListener('keydown', (e) => {
      if (!document.getElementById('tab-net').classList.contains('active')) return;
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { removeSel(); e.preventDefault(); }
      if (e.key === 'Escape') { pendingPin = null; sel = null; T.render(); renderInspector(); }
    });
    // Szenario
    const ss = document.getElementById('scnSel');
    for (const [k, s] of Object.entries(CS.SCENARIOS)) ss.append(CS.h('option', { value: k }, s.name));
    ss.addEventListener('change', () => {
      if ((net().nodes.length || CS.state.messages.some((m) => !m.locked)) && !confirm('Szenario wechseln? Netzwerk und Botschaften werden zurückgesetzt.')) { ss.value = CS.state.scenario; return; }
      CS.state = CS.newState(ss.value); sel = null; CS.sim.reset(); CS.changed('all');
    });
    document.getElementById('scnReset').addEventListener('click', () => {
      if (!confirm('Szenario neu beginnen? Netzwerk und Botschaften werden zurückgesetzt.')) return;
      CS.state = CS.newState(CS.state.scenario); sel = null; CS.sim.reset(); CS.changed('all');
    });
    document.getElementById('prjExport').addEventListener('click', () => CS.download('CANsim_Projekt.json', JSON.stringify(CS.state, null, 1), 'application/json'));
    const pf = document.getElementById('prjFile');
    document.getElementById('prjImport').addEventListener('click', () => pf.click());
    pf.addEventListener('change', () => {
      const f = pf.files[0]; if (!f) return;
      f.text().then((t) => {
        try { const s = JSON.parse(t); if (!s.net || !s.messages) throw new Error('Format'); CS.state = s; CS.sim.reset(); CS.changed('all'); CS.toast('Projekt geladen.'); }
        catch (err) { CS.toast('Datei ist kein CANsim-Projekt.', 'bad'); }
        pf.value = '';
      });
    });
    document.getElementById('netSolution').addEventListener('click', () => { if (!net().nodes.length || confirm('Aktuelles Netzwerk durch die Musterlösung ersetzen?')) T.solution(); });
    // Busparameter
    document.getElementById('netBaud').addEventListener('change', (e) => { net().baud = +e.target.value; CS.changed('net'); });
    document.getElementById('netLen').addEventListener('change', (e) => { net().busLength = CS.clamp(+e.target.value || 10, 1, 1000); CS.changed('net'); });
    document.getElementById('netSp').addEventListener('change', (e) => { net().samplePoint = +e.target.value; CS.changed('net'); });
    for (const id of ['scopeTx', 'scopeRx', 'scopeHL']) document.getElementById(id).addEventListener('change', drawScope);
    window.addEventListener('resize', scheduleScope);
    CS.on('changed', () => T.refresh());
    T.refresh();
  };

  function renderPalette() {
    const pal = document.getElementById('palette');
    pal.textContent = '';
    const scn = CS.SCENARIOS[CS.state.scenario];
    const items = scn.free ? Object.keys(CS.NODE_TYPES).map((t) => ({ type: t, id: t === 'pc' ? 'pc' : null })) : scn.nodes.map((id) => ({ type: scn.nodeTypes[id], id }));
    for (const it of items) {
      const t = CS.NODE_TYPES[it.type];
      const placed = it.id && CS.nodeById(it.id);
      const b = CS.h('button', { class: 'pal-item', draggable: !placed, disabled: !!placed, title: t.desc, onclick: () => addNode(it.type, it.id) }, [CS.h('span', { class: 'pi' }, t.short), t.label]);
      b.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', it.type + ':' + (it.id || '')));
      pal.append(b);
    }
    const r = CS.h('button', { class: 'pal-item res full', draggable: true, onclick: () => addRes() }, [CS.h('span', { class: 'pi' }, 'R'), 'Abschlusswiderstand']);
    r.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'res'));
    pal.append(r);
  }

  T.refresh = function () {
    const scn = CS.SCENARIOS[CS.state.scenario];
    document.getElementById('scnSel').value = CS.state.scenario;
    document.getElementById('scnDesc').textContent = scn.desc;
    document.getElementById('netBaud').value = net().baud;
    document.getElementById('netLen').value = net().busLength;
    document.getElementById('netSp').value = net().samplePoint;
    renderPalette();
    T.render();
    renderInspector();
    renderChecks();
    fillScopeSelects();
    scheduleScope();
  };
  T.onShow = function () { scheduleScope(); };
})();
