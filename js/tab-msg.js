/* ==========================================================================
   CANsim – Reiter 2: Botschaften konfigurieren (Kommunikationsmatrix)
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS, h = CS.h;
  const T = (CS.MsgTab = {});
  let cur = null, curSig = 0;

  const msgs = () => CS.state.messages;
  const curMsg = () => msgs().find((m) => m.key === cur);
  const sorted = () => [...msgs()].sort((a, b) => CS.can.arbCompare(a, b));
  const sigColor = (i) => CS.css('--l' + ((i % 10) + 1));

  /* ---------------- Validierung ---------------- */
  T.issues = function (m) {
    const out = [];
    const max = m.ext ? 0x1fffffff : 0x7ff;
    if (!(m.id >= 0 && m.id <= max)) out.push(['fail', 'ID außerhalb des Bereichs', m.ext ? '29-bit-ID: 0 … 0x1FFFFFFF' : '11-bit-ID: 0 … 0x7FF (2048 Adressen)']);
    const dup = msgs().filter((x) => x !== m && x.id === m.id && !!x.ext === !!m.ext);
    if (dup.length) out.push(['fail', 'ID doppelt vergeben', 'Auch „' + dup[0].name + '“ nutzt ' + CS.hexId(m.id, m.ext) + '. Zwei Sender mit gleicher ID stören sich in der Arbitrierung (Bit-Fehler im Datenfeld).']);
    if (!(m.dlc >= 0 && m.dlc <= 8)) out.push(['fail', 'DLC ungültig', 'Classical CAN: 0 … 8 Datenbytes.']);
    if (!(m.cycle > 0)) out.push(['warn', 'Keine Zykluszeit', 'Die Botschaft wird nicht zyklisch gesendet.']);
    const used = new Map();
    m.signals.forEach((s, i) => {
      if (!(s.len >= 1 && s.len <= 64)) { out.push(['fail', s.name + ': Länge ungültig', '1 … 64 bit']); return; }
      for (const p of CS.sig.positions(s)) {
        if (p < 0 || p >= m.dlc * 8) { out.push(['fail', s.name + ': liegt außerhalb des Datenfelds', 'Bit ' + p + ' ≥ DLC · 8 = ' + m.dlc * 8 + '. DLC erhöhen oder Startbit ändern.']); break; }
        if (used.has(p)) { out.push(['fail', 'Überlappung: ' + s.name + ' / ' + m.signals[used.get(p)].name, 'Bit ' + p + ' wird doppelt belegt.']); break; }
        used.set(p, i);
      }
      if (s.src === 'crc' && (s.len !== 8 || CS.sig.positions(s)[0] % 8 !== 0)) out.push(['warn', s.name + ': CRC-8 sollte ein ganzes Byte belegen', 'Länge 8 bit, Startbit Vielfaches von 8.']);
      if (!(s.factor !== 0 && isFinite(s.factor))) out.push(['fail', s.name + ': Faktor darf nicht 0 sein', '']);
    });
    return out;
  };

  /* ---------------- Liste ---------------- */
  function renderList() {
    const box = document.getElementById('msgList');
    box.textContent = '';
    if (!msgs().length) box.append(h('p', { class: 'hint' }, 'Noch keine Botschaften.'));
    for (const m of sorted()) {
      const placed = CS.nodeById(m.node);
      const bad = T.issues(m).some((x) => x[0] === 'fail');
      box.append(h('div', { class: 'msg-item' + (m.key === cur ? ' sel' : '') + (placed ? '' : ' off'), onclick: () => { cur = m.key; curSig = 0; T.refresh(); } }, [
        h('span', { class: 'mn' }, [m.name, bad ? h('span', { class: 'tag bad', style: 'margin-left:6px' }, 'Fehler') : null, m.locked ? h('span', { class: 'tag mut', style: 'margin-left:6px' }, 'vorgegeben') : null]),
        h('span', { class: 'mi' }, CS.hexId(m.id, m.ext)),
        h('span', { class: 'ms' }, CS.nodeLabel(m.node) + ' · DLC ' + m.dlc + ' · ' + (m.hideCycle && m.locked ? 'Zyklus ?' : m.cycle + ' ms') + ' · ' + m.signals.length + ' Signale' + (placed ? '' : ' · Sender nicht im Netzwerk'))
      ]));
    }
    const sel = document.getElementById('msgAddNode');
    sel.textContent = '';
    for (const id of CS.senderList()) sel.append(h('option', { value: id }, CS.nodeLabel(id)));
    if (!sel.options.length) sel.append(h('option', { value: '' }, '(erst Knoten platzieren)'));
  }

  /* ---------------- Editor-Kopf ---------------- */
  function renderEditor() {
    const box = document.getElementById('msgEditor');
    box.textContent = '';
    const m = curMsg();
    if (!m) { box.append(h('h3', {}, 'Botschaft'), h('p', { class: 'hint' }, 'Links eine Botschaft wählen oder anlegen.')); return; }
    const ro = !!m.locked;
    box.append(h('div', { class: 'card-head' }, [h('h3', {}, 'Botschaft „' + m.name + '“'), ro ? null : h('button', { class: 'btn small danger', onclick: () => { if (confirm('Botschaft „' + m.name + '“ löschen?')) { CS.state.messages = msgs().filter((x) => x !== m); cur = null; CS.changed('msg'); } } }, 'Löschen')]));
    if (ro) box.append(h('div', { class: 'lock-note' }, [h('span', {}, 'Vorgegeben (Datenblatt bzw. ' + (CS.state.scenario === 'boom' ? 'BoomControl.dbc' : 'MM710_Rexroth.dbc') + ') – nur lesen.'), h('button', { class: 'btn small', onclick: () => { m.locked = false; CS.changed('msg'); } }, 'Bearbeitung freigeben')]));
    const upd = (fn) => (e) => { fn(e.target); CS.changed('msg'); };
    const idIn = h('input', { type: 'text', class: 'mono', value: CS.hex(m.id, m.ext ? 8 : 3), disabled: ro, onchange: upd((t) => { const v = parseInt(t.value.replace(/^0x/i, ''), 16); if (isFinite(v)) m.id = v; }) });
    const extSel = h('select', { disabled: ro, onchange: upd((t) => { m.ext = t.value === '1'; }) }, [h('option', { value: 0 }, 'Standard (11 bit)'), h('option', { value: 1 }, 'Extended (29 bit)')]);
    extSel.value = m.ext ? 1 : 0;
    const nodeSel = h('select', { disabled: ro, onchange: upd((t) => { m.node = t.value; }) }, CS.senderList().concat(CS.senderList().includes(m.node) ? [] : [m.node]).map((id) => h('option', { value: id }, CS.nodeLabel(id))));
    nodeSel.value = m.node;
    const cyc = m.hideCycle && ro
      ? h('input', { type: 'text', value: '? (im Trace ermitteln)', disabled: true })
      : h('input', { type: 'number', min: 1, max: 10000, step: 1, value: m.cycle, disabled: ro, onchange: upd((t) => { m.cycle = Math.max(1, +t.value || 100); m.hideCycle = false; }) });
    box.append(h('div', { class: 'editor-grid' }, [
      h('label', {}, ['Name', h('input', { type: 'text', value: m.name, disabled: ro, onchange: upd((t) => { m.name = t.value.replace(/\W+/g, '_') || 'Botschaft'; }) })]),
      h('label', {}, ['Identifier (hex)', idIn]),
      h('label', {}, ['Format', extSel]),
      h('label', {}, ['DLC [Byte]', h('input', { type: 'number', min: 0, max: 8, value: m.dlc, disabled: ro, onchange: upd((t) => { m.dlc = CS.clamp(Math.round(+t.value), 0, 8); }) })]),
      h('label', {}, ['Zykluszeit [ms]', cyc]),
      h('label', {}, ['Sender', nodeSel])
    ]));
    const rank = sorted().indexOf(m) + 1;
    box.append(h('p', { class: 'hint' }, `ID ${CS.hexId(m.id, m.ext)} = ${m.id} dez. · Priorität ${rank} von ${msgs().length} (kleinere ID gewinnt die Arbitrierung) · Rahmenlänge ohne Stuffing (inkl. IFS) ${CS.can.buildFrame({ id: m.id, ext: m.ext, dlc: m.dlc, data: [] }).nNoStuff} bit + bis zu ${m.ext ? 29 : 24} Stuff-Bits.`));
  }

  /* ---------------- Layout-Raster ---------------- */
  function renderLayout() {
    const box = document.getElementById('msgLayout');
    box.textContent = '';
    const m = curMsg();
    if (!m) return;
    const owner = new Map();
    const marks = new Map();
    m.signals.forEach((s, i) => {
      const pos = CS.sig.positions(s);
      pos.forEach((p) => { if (!owner.has(p)) owner.set(p, []); owner.get(p).push(i); });
      if (pos.length) { marks.set(pos[0] + ':' + i, 'LSB'); marks.set(pos[pos.length - 1] + ':' + i, pos.length > 1 ? 'MSB' : ''); }
    });
    box.append(h('div', { class: 'hdr' }, ''));
    for (let b = 7; b >= 0; b--) box.append(h('div', { class: 'hdr' }, 'Bit ' + b));
    for (let by = 0; by < 8; by++) {
      box.append(h('div', { class: 'rowh' }, 'Byte ' + by));
      for (let b = 7; b >= 0; b--) {
        const p = by * 8 + b, o = owner.get(p) || [];
        const cell = h('div', { class: 'cell' + (by >= m.dlc ? ' out' : '') + (o.length ? ' sig' : '') + (o.length > 1 ? ' over' : '') + (o.includes(curSig) ? ' cur' : ''), title: 'Bit ' + p + (o.length ? ' · ' + o.map((i) => m.signals[i].name).join(', ') : '') });
        if (o.length) cell.style.background = sigColor(o[0]);
        cell.append(h('span', { class: 'bn' }, p));
        if (o.length) {
          const s = m.signals[o[0]];
          const mk = marks.get(p + ':' + o[0]);
          const pos = CS.sig.positions(s);
          // Namen in der "mittleren" Zelle des Signals zeigen
          const mid = pos[Math.floor(pos.length / 2)];
          if (p === mid || pos.length <= 2) cell.append(h('span', { class: 'sn' }, s.name));
          if (mk) cell.append(h('span', { class: 'mk' }, mk));
        }
        cell.addEventListener('click', () => {
          const s = m.signals[curSig];
          if (!s || m.locked) return;
          if (o.length && !o.includes(curSig)) { curSig = o[0]; T.refresh(); return; }
          s.start = s.order === 'motorola' ? p : p;
          CS.changed('msg');
        });
        box.append(cell);
      }
    }
  }

  /* ---------------- Signaltabelle ---------------- */
  function renderSignals() {
    const tb = document.getElementById('sigTable');
    tb.textContent = '';
    const m = curMsg();
    document.getElementById('sigAdd').disabled = !m || m.locked;
    if (!m) return;
    const ro = !!m.locked;
    tb.append(h('thead', {}, h('tr', {}, ['', 'Name', 'Startbit', 'Länge', 'Byte-Order', 'Typ', 'Faktor', 'Offset', 'Einheit', 'Wertebereich (phys.)', 'Quelle / Wert', ''].map((t) => h('th', {}, t)))));
    const body = h('tbody');
    const srcs = CS.sourcesFor(m.node);
    m.signals.forEach((s, i) => {
      const set = (k, conv) => (e) => { s[k] = conv ? conv(e.target.value) : e.target.value; CS.changed('msg'); };
      const num = (v) => CS.parseNum(v);
      const [lo, hi] = CS.sig.physRange(s);
      const ord = h('select', { disabled: ro, onchange: set('order') }, [h('option', { value: 'intel' }, 'Intel'), h('option', { value: 'motorola' }, 'Motorola')]); ord.value = s.order;
      const sgn = h('select', { disabled: ro, onchange: (e) => { s.signed = e.target.value === '1'; CS.changed('msg'); } }, [h('option', { value: 0 }, 'unsigned'), h('option', { value: 1 }, 'signed')]); sgn.value = s.signed ? 1 : 0;
      const src = h('select', { disabled: ro, onchange: set('src') }, Object.entries(srcs).map(([k, v]) => h('option', { value: k }, v)));
      src.value = s.src in srcs ? s.src : 'const';
      const tr = h('tr', { class: i === curSig ? 'cur' : '', onclick: (e) => { if (curSig !== i) { curSig = i; renderLayout(); tb.querySelectorAll('tr').forEach((r, k) => r.classList.toggle('cur', k - 1 === i)); } } }, [
        h('td', {}, h('span', { class: 'sig-color', style: 'background:' + sigColor(i) })),
        h('td', {}, h('input', { type: 'text', value: s.name, disabled: ro, onchange: set('name', (v) => v.replace(/\W+/g, '_') || 'Signal') })),
        h('td', {}, h('input', { type: 'number', min: 0, max: 63, value: s.start, disabled: ro, onchange: set('start', (v) => CS.clamp(Math.round(+v), 0, 63)) })),
        h('td', {}, h('input', { type: 'number', min: 1, max: 64, value: s.len, disabled: ro, onchange: set('len', (v) => CS.clamp(Math.round(+v), 1, 64)) })),
        h('td', {}, ord), h('td', {}, sgn),
        h('td', {}, h('input', { type: 'number', step: 'any', value: s.factor, disabled: ro, onchange: set('factor', num) })),
        h('td', {}, h('input', { type: 'number', step: 'any', value: s.offset, disabled: ro, onchange: set('offset', num) })),
        h('td', {}, h('input', { type: 'text', value: s.unit, disabled: ro, style: 'width:60px', onchange: set('unit') })),
        h('td', { class: 'num' }, s.src === 'crc' || s.src === 'counter' ? '0 … ' + (Math.pow(2, s.len) - 1) : CS.fmt(+lo.toPrecision(10)) + ' … ' + CS.fmt(+hi.toPrecision(10))),
        h('td', {}, [src, s.src === 'const' ? h('input', { type: 'number', step: 'any', value: s.val || 0, disabled: ro, style: 'width:70px;margin-left:4px', onchange: set('val', num) }) : null]),
        h('td', {}, ro ? '' : h('button', { class: 'del', title: 'Signal löschen', onclick: (e) => { e.stopPropagation(); m.signals.splice(i, 1); curSig = Math.max(0, curSig - 1); CS.changed('msg'); } }, '✕'))
      ]);
      body.append(tr);
    });
    tb.append(body);
    if (!m.signals.length) tb.append(h('tbody', {}, h('tr', {}, h('td', { colspan: 12, class: 'hint' }, 'Noch keine Signale – „＋ Signal“ legt eines an.'))));
    const ul = document.getElementById('msgIssues');
    ul.textContent = '';
    for (const [lvl, t, d] of T.issues(m)) ul.append(h('li', { class: lvl }, [h('span', { class: 'ic' }, lvl === 'warn' ? '!' : '✕'), h('b', {}, t), h('span', { class: 'd' }, d)]));
  }

  /* ---------------- Aufgabe ---------------- */
  const near = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));
  function renderTask() {
    const box = document.getElementById('msgTask');
    box.textContent = '';
    const scn = CS.state.scenario;
    document.getElementById('taskCard').hidden = scn === 'free';
    document.getElementById('msgTaskRes').textContent = '';
    if (scn === 'boom') {
      box.innerHTML = `<p class="hint" style="color:var(--ink-2)">Übung 2.2 c/d: Legen Sie für den <b>Winkelsensor</b> eine Botschaft an – analog zur Joystick-Botschaft mit <b>Botschaftszähler</b> und <b>Checksumme</b>. Wählen Sie eine Standard-ID mit <b>niedrigerer Priorität</b> als der Joystick (0x124) und das <b>kleinstmögliche DLC</b>. Ordnen Sie jedem Signal die passende Quelle zu.</p>
      <div class="table-wrap"><table class="task-table"><thead><tr><th>Signal</th><th class="num">Auflösung</th><th class="num">Min</th><th class="num">Max</th><th>Einheit</th></tr></thead><tbody>
      <tr><td>Winkel</td><td class="num">0,01°</td><td class="num">−180°</td><td class="num">180°</td><td>°</td></tr>
      <tr><td>Winkelgeschwindigkeit</td><td class="num">0,01°/s</td><td class="num">−180°/s</td><td class="num">180°/s</td><td>°/s</td></tr>
      <tr><td>Flag obere Endlage</td><td class="num">1</td><td class="num">0</td><td class="num">1</td><td>–</td></tr>
      <tr><td>Flag untere Endlage</td><td class="num">1</td><td class="num">0</td><td class="num">1</td><td>–</td></tr></tbody></table></div>`;
    } else if (scn === 'imu') {
      box.innerHTML = '<p class="hint" style="color:var(--ink-2)">Vorlesung Folie 150 / Übung 2.1: Analysieren Sie die Botschaften des MM7.10.</p>';
      const qs = [
        ['q1', 'Standard- oder Extended-Identifier? (S/E)', 'E'], ['q2', 'Datenbytes je Botschaft', '8'], ['q3', 'Bits des Botschaftszählers', '4'],
        ['q4', 'Größter Zählerwert (dezimal)', '15'], ['q5', 'Bits der Checksumme', '8'], ['q6', 'Max. übertragbare Beschleunigung AY [m/s²]', '40.958'],
        ['q7', 'Min. übertragbare Beschleunigung AY [m/s²]', '-40.957'], ['q8', 'Höchste Priorität: welche Botschaft? (TX1/TX2/TX3)', 'TX1']
      ];
      const grid = h('div', { class: 'grid2' });
      for (const [id, q] of qs) grid.append(h('label', {}, [q, h('input', { type: 'text', id: 'imu_' + id, value: (CS.state.answers || {})[id] || '' })]));
      box.append(grid);
      T._imuQs = qs;
    }
  }
  T.check = function () {
    const ul = document.getElementById('msgTaskRes');
    ul.textContent = '';
    const res = [];
    const add = (ok, t, d) => res.push([ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'fail', t, d || '']);
    if (CS.state.scenario === 'imu') {
      CS.state.answers = CS.state.answers || {};
      for (const [id, q, ans] of T._imuQs) {
        const v = document.getElementById('imu_' + id).value.trim().replace(',', '.');
        CS.state.answers[id] = v;
        const ok = isNaN(+ans) ? v.toUpperCase().includes(ans) : Math.abs(+v - +ans) < 1e-3;
        add(ok, q, ok ? 'richtig' : v ? 'nicht richtig – Signale in der Tabelle bzw. DBC prüfen' : 'noch offen');
      }
      CS.save();
    } else {
      const m = msgs().find((x) => CS.nodeType(x.node) === 'angle');
      if (m && cur !== m.key) { cur = m.key; curSig = 0; T.refresh(); }
      if (!m) add(false, 'Botschaft des Winkelsensors fehlt', 'Unten links Sender „Winkelsensor“ wählen und „＋ Botschaft“.');
      else {
        add(!m.ext, 'Standard-Identifier (11 bit)', m.ext ? 'Extended gewählt.' : '');
        add(m.id > 0x124 && m.id <= 0x7ff, 'Niedrigere Priorität als Joystick (ID > 0x124)', 'Gewählt: ' + CS.hexId(m.id, m.ext) + (m.id < 0x124 ? ' → höhere Priorität als der Joystick!' : ''));
        const by = (src) => m.signals.find((s) => s.src === src);
        const angleOk = (s, unitRe) => s && near(s.factor, 0.01) && CS.sig.physRange(s)[0] <= -180 + 1e-9 && CS.sig.physRange(s)[1] >= 180 - 1e-9;
        const sa = by('angle'), sr = by('rate');
        add(angleOk(sa), 'Winkel: Auflösung 0,01°, Bereich −180 … 180°', sa ? `Faktor ${CS.fmt(sa.factor)}, darstellbar ${CS.fmt(CS.sig.physRange(sa)[0])} … ${CS.fmt(CS.sig.physRange(sa)[1])} ${sa.unit}. Benötigt: 36000 Stufen → 16 bit.` : 'Kein Signal mit Quelle „Winkel“.');
        add(angleOk(sr), 'Winkelgeschwindigkeit: 0,01°/s, −180 … 180°/s', sr ? `Faktor ${CS.fmt(sr.factor)}, darstellbar ${CS.fmt(CS.sig.physRange(sr)[0])} … ${CS.fmt(CS.sig.physRange(sr)[1])} ${sr.unit}` : 'Kein Signal mit Quelle „Winkelgeschwindigkeit“.');
        if (sa && !/deg|°/i.test(sa.unit)) add('warn', 'Einheit des Winkels angeben (deg bzw. °)', '');
        for (const [src, nm] of [['upper', 'Flag obere Endlage'], ['lower', 'Flag untere Endlage']]) {
          const s = by(src);
          add(s && s.len === 1 && near(s.factor, 1) && near(s.offset, 0), nm + ': 1 bit', s ? `${s.len} bit, Faktor ${s.factor}, Offset ${s.offset}` : 'fehlt');
        }
        const sc = by('counter'), sk = by('crc');
        add(sc && sc.len === 4, 'Botschaftszähler 4 bit (wie Joystick)', sc ? sc.len + ' bit' : 'fehlt (Quelle „Botschaftszähler“)');
        add(sk && sk.len === 8 && CS.sig.positions(sk)[0] % 8 === 0, 'Checksumme CRC-8 (1 ganzes Byte)', sk ? sk.len + ' bit ab Bit ' + sk.start : 'fehlt (Quelle „CRC-8“)');
        const iss = T.issues(m).filter((x) => x[0] === 'fail');
        add(!iss.length, 'Keine Überlappungen, alle Signale im Datenfeld', iss.map((x) => x[1]).join(' · '));
        const bits = m.signals.reduce((s, x) => s + x.len, 0), need = Math.ceil(bits / 8);
        add(m.dlc === need ? true : m.dlc > need ? 'warn' : false, 'Minimale Länge des Datenfelds: ' + need + ' Byte', `Belegte Bits: ${bits} → ⌈${bits}/8⌉ = ${need} Byte. Gewählt: DLC ${m.dlc}.`);
        add(m.cycle > 0 && !m.hideCycle, 'Zykluszeit festgelegt', m.cycle + ' ms (Winkel ändert sich schnell → z. B. 10 ms)');
      }
    }
    for (const [lvl, t, d] of res) ul.append(h('li', { class: lvl }, [h('span', { class: 'ic' }, lvl === 'ok' ? '✓' : lvl === 'warn' ? '!' : '✕'), h('b', {}, t), h('span', { class: 'd' }, d)]));
    const n = res.filter((r) => r[0] === 'ok').length;
    CS.toast(n + ' von ' + res.length + ' Punkten erfüllt.');
  };

  /* ---------------- Rechner ---------------- */
  function renderCalc() {
    const lo = +document.getElementById('calcMin').value, hi = +document.getElementById('calcMax').value, res = +document.getElementById('calcRes').value;
    const signed = document.getElementById('calcSigned').value === '1';
    const out = document.getElementById('calcOut');
    if (!(hi > lo) || !(res > 0)) { out.innerHTML = '<span class="fail">Maximum > Minimum und Auflösung > 0 eingeben.</span>'; return; }
    const steps = Math.round((hi - lo) / res);
    const n = Math.ceil(Math.log2(steps + 1));
    const span = res * (Math.pow(2, n) - 1);
    let off, a, b;
    if (signed) { off = (lo + hi) / 2 - res * (0.5); a = off - res * Math.pow(2, n - 1); b = off + res * (Math.pow(2, n - 1) - 1); }
    else { off = lo; a = lo; b = lo + span; }
    out.innerHTML = `Stufen: (${CS.fmt(hi)} − ${CS.fmt(lo)}) / ${CS.fmt(res)} = <b>${steps}</b><br>
      Bits: ⌈log₂(${steps} + 1)⌉ = <b>${n} bit</b> (2<sup>${n}</sup> = ${Math.pow(2, n)} Werte)<br>
      Vorschlag: Faktor <b>${CS.fmt(res)}</b>, Offset <b>${CS.fmt(+off.toPrecision(10))}</b> → darstellbar ${CS.fmt(+a.toPrecision(10))} … ${CS.fmt(+b.toPrecision(10))}<br>
      ${signed ? '' : `Jeder Offset zwischen ${CS.fmt(+(hi - span).toPrecision(10))} und ${CS.fmt(lo)} deckt den Bereich ab (z. B. −300 wie in BoomControl_Loesung.dbc).`}`;
  }

  /* ---------------- Aktualisieren ---------------- */
  T.refresh = function () {
    if (cur && !curMsg()) cur = null;
    if (!cur && msgs().length) cur = sorted()[0].key;
    renderList(); renderEditor(); renderLayout(); renderSignals();
    const pre = document.getElementById('dbcPreview');
    if (!pre.hidden) pre.textContent = CS.dbc.fromConfig(msgs(), CS.nodeLabel);
  };

  T.init = function () {
    document.getElementById('msgAdd').addEventListener('click', () => {
      const node = document.getElementById('msgAddNode').value;
      if (!node) { CS.toast('Zuerst im Reiter „Netzwerk“ einen sendenden Knoten platzieren.', 'bad'); return; }
      let id = 0x200; while (msgs().some((m) => m.id === id)) id++;
      const t = CS.nodeType(node);
      const m = { key: CS.uid('m'), node, name: (t === 'angle' ? 'Winkelsensor' : CS.nodeLabel(node).replace(/\W+/g, '_')) + (msgs().some((x) => x.node === node) ? '_' + (msgs().length + 1) : ''), id, ext: false, dlc: 8, cycle: 100, signals: [] };
      msgs().push(m); cur = m.key; curSig = 0;
      CS.changed('msg');
    });
    document.getElementById('sigAdd').addEventListener('click', () => {
      const m = curMsg(); if (!m) return;
      const used = new Set(m.signals.flatMap((s) => CS.sig.positions(s)));
      let st = 0; while (used.has(st) && st < 63) st++;
      const srcKeys = Object.keys(CS.sourcesFor(m.node));
      m.signals.push({ name: 'Signal_' + (m.signals.length + 1), start: st, len: 8, order: 'intel', signed: false, factor: 1, offset: 0, unit: '', src: srcKeys[0] || 'const', val: 0 });
      curSig = m.signals.length - 1;
      CS.changed('msg');
    });
    document.getElementById('msgCheck').addEventListener('click', T.check);
    document.getElementById('msgSolution').addEventListener('click', () => {
      if (CS.state.scenario === 'imu') {
        for (const [id, , ans] of T._imuQs) document.getElementById('imu_' + id).value = ans;
        T.check(); return;
      }
      if (!confirm('Musterlösung für den Winkelsensor eintragen? Eine vorhandene Winkelsensor-Botschaft wird ersetzt.')) return;
      CS.state.messages = msgs().filter((m) => CS.nodeType(m.node) !== 'angle');
      const sol = CS.MSG_ANGLE_SOLUTION(); msgs().push(sol); cur = sol.key;
      CS.changed('msg'); T.check();
    });
    for (const id of ['calcMin', 'calcMax', 'calcRes', 'calcSigned']) document.getElementById(id).addEventListener('input', renderCalc);
    renderCalc();
    document.getElementById('dbcShow').addEventListener('click', () => {
      const pre = document.getElementById('dbcPreview');
      pre.hidden = !pre.hidden;
      if (!pre.hidden) pre.textContent = CS.dbc.fromConfig(msgs(), CS.nodeLabel);
    });
    document.getElementById('dbcSave').addEventListener('click', () => CS.download('CANsim_Eigene.dbc', CS.dbc.fromConfig(msgs(), CS.nodeLabel)));
    CS.on('changed', (w) => { if (w === 'all') { cur = null; renderTask(); } T.refresh(); });
    renderTask();
    T.refresh();
  };
})();
