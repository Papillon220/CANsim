/* ==========================================================================
   CANsim – Reiter 7: Werkzeuge (Signal, J1939, CANopen, Buslast, CAN FD) & Quiz
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS, h = CS.h;
  const T = (CS.ToolsTab = {});

  const card = (title, body, wide) => h('div', { class: 'card' + (wide ? ' wide' : '') }, [h('h3', {}, title)].concat(body));
  const field = (label, attrs) => h('label', {}, [label, h('input', Object.assign({ type: 'text' }, attrs))]);
  const bitfield = (groups) => h('div', { class: 'bitfield' }, groups.map(([lab, val, n, col]) => h('div', { class: 'grp' }, [
    h('div', { class: 'gb' }, val.toString(2).padStart(n, '0').split('').map((b) => h('span', { style: '--c:var(' + col + ')' }, b))),
    h('div', { class: 'gl' }, lab + ' (' + n + ')')
  ])));

  /* ---------------- Signalrechner ---------------- */
  function sigCard() {
    const out = h('div', { class: 'out-box' });
    const raw = field('Rohdaten (hex)', { value: '7A3F', class: 'mono' }), off = field('Offset c', { value: '-163.84' }), fac = field('Faktor m', { value: '0.005' }), len = field('Signallänge [bit]', { value: '16' });
    const run = () => {
      const r = parseInt(raw.querySelector('input').value.replace(/^0x/i, '').replace(/\s/g, ''), 16);
      const c = CS.parseNum(off.querySelector('input').value), m = CS.parseNum(fac.querySelector('input').value), n = +len.querySelector('input').value || 16;
      if (!isFinite(r)) { out.innerHTML = '<span class="fail">Ungültiger Hex-Wert</span>'; return; }
      const y = c + m * r;
      out.innerHTML = `<span>0x${CS.hex(r)} = <b>${r}</b> (dezimal)</span><span>y = c + m · x = ${CS.fmt(c)} + ${CS.fmt(m)} · ${r} = <b>${CS.fmt(+y.toPrecision(10))}</b></span>
        <span>Wertebereich mit ${n} bit: ${CS.fmt(c)} … ${CS.fmt(+(c + m * (Math.pow(2, n) - 1)).toPrecision(10))}</span>
        <span class="hint">Beispiel aus der Vorlesung: 0x7A3F, c = −163,84, m = 0,005 → −7,365 (Drehrate des MM7.10 in °/s).</span>`;
    };
    [raw, off, fac, len].forEach((l) => l.querySelector('input').addEventListener('input', run));
    run();
    return card('Physikalischer Signalwert', [h('div', { class: 'grid2' }, [raw, len, off, fac]), out]);
  }

  /* ---------------- J1939 ---------------- */
  const PGNS = { 61444: 'EEC1 – Electronic Engine Controller 1', 65265: 'CCVS – Cruise Control/Vehicle Speed', 65262: 'ET1 – Engine Temperature 1', 65226: 'DM1 – Active Diagnostic Trouble Codes', 59904: 'Request', 60928: 'Address Claimed', 60416: 'TP.CM – Transport Protocol Connection Mgmt (BAM)', 60160: 'TP.DT – Transport Protocol Data Transfer', 61443: 'EEC2 – Electronic Engine Controller 2' };
  function j1939Card() {
    const idIn = field('29-bit-Identifier (hex)', { value: '0CF00401', class: 'mono' });
    const dataIn = field('Daten (hex) – Dekodierung SPN 190 bei EEC1', { value: 'FF FF FF 68 13 FF FF FF', class: 'mono' });
    const bf = h('div'), out = h('div', { class: 'out-box' });
    const ex = h('div', { class: 'btn-row' }, [['EEC1 (Vorlesung)', '0CF00401'], ['MM7.10 TX1', '18FF2331'], ['DM1', '18FECA00'], ['Request an 0x21', '18EA2100']].map(([n, v]) => h('button', { class: 'btn small', onclick: () => { idIn.querySelector('input').value = v; run(); } }, n)));
    const run = () => {
      const id = parseInt(idIn.querySelector('input').value.replace(/^0x/i, ''), 16) & 0x1fffffff;
      const prio = id >>> 26, res = (id >>> 25) & 1, dp = (id >>> 24) & 1, pf = (id >>> 16) & 0xff, ps = (id >>> 8) & 0xff, sa = id & 0xff;
      const pdu1 = pf < 240;
      const pgn = (res << 17) | (dp << 16) | (pf << 8) | (pdu1 ? 0 : ps);
      bf.textContent = '';
      bf.append(bitfield([['Priorität', prio, 3, '--s4'], ['R', res, 1, '--f-ctl'], ['DP', dp, 1, '--f-ctl'], ['PDU Format', pf, 8, '--s1'], ['PDU Specific', ps, 8, '--s3'], ['Source Address', sa, 8, '--s2']]));
      const name = PGNS[pgn] || (pgn >= 0xff00 && pgn <= 0xffff ? 'Proprietary B (herstellerspezifisch)' : pgn === 0xef00 ? 'Proprietary A' : 'nicht in der Kurzliste');
      let html = `<span>Priorität <b>${prio}</b> (0 = höchste) · Source Address <b>0x${CS.hex(sa, 2)}</b> (${sa})</span>
        <span>PF = ${pf} ${pdu1 ? '&lt; 240 → <b>PDU1</b> (adressiert): Ziel = PS = 0x' + CS.hex(ps, 2) + (ps === 0xff ? ' (global)' : '') : '≥ 240 → <b>PDU2</b> (Broadcast), PS = Group Extension'}</span>
        <span>PGN = <b>${pgn}</b> = 0x${CS.hex(pgn, 4)} · ${CS.esc(name)}</span>`;
      if (pgn === 61444) {
        const d = CS.parseHexBytes(dataIn.querySelector('input').value);
        if (d.length >= 5) {
          const raw = d[3] + 256 * d[4];
          html += raw === 0xffff ? '<span>SPN 190 Engine Speed: 0xFFFF → <b>N/A</b> (nicht verfügbar)</span>' : `<span>SPN 190 Engine Speed: Startbit 24, 16 bit, Intel → 0x${CS.hex(raw, 4)} = ${raw} · 0,125 rpm/bit = <b>${CS.fmt(raw * 0.125)} rpm</b></span>`;
          html += '<span class="hint">0xFF in den übrigen Bytes = „not available“: Die Anwendung unterstützt diese SPNs nicht (0xFE = Fehler).</span>';
        }
      }
      out.innerHTML = html;
    };
    [idIn, dataIn].forEach((l) => l.querySelector('input').addEventListener('input', run));
    run();
    return card('J1939: Identifier → PGN', [h('p', { class: 'hint' }, 'J1939 nutzt 29-bit-IDs (250/500 kbit/s). Die Parameter Group Number (18 bit) bestimmt den Inhalt, die Source Address den Sender.'), ex, idIn, bf, dataIn, out]);
  }

  /* ---------------- CANopen ---------------- */
  const FC = [[0, 'NMT (nur Node-ID 0)'], [1, 'SYNC (ID 0) / EMCY'], [2, 'TIME'], [3, 'TPDO1'], [4, 'RPDO1'], [5, 'TPDO2'], [6, 'RPDO2'], [7, 'TPDO3'], [8, 'RPDO3'], [9, 'TPDO4'], [10, 'RPDO4'], [11, 'SDO Antwort (Server → Client)'], [12, 'SDO Anfrage (Client → Server)'], [14, 'Heartbeat / NMT Error Control']];
  const NMT = [[0x01, 'Operational'], [0x02, 'Stopped'], [0x80, 'Pre-Operational'], [0x81, 'Reset Application'], [0x82, 'Reset Communication']];
  function canopenCard() {
    const fc = h('select', {}, FC.map(([v, n]) => h('option', { value: v }, CS.hex(v) + 'h · ' + n)));
    fc.value = 11;
    const nid = h('input', { type: 'number', min: 0, max: 127, value: 5 });
    const bf = h('div'), out = h('div', { class: 'out-box' });
    const run = () => {
      const f = +fc.value, n = CS.clamp(+nid.value || 0, 0, 127);
      const cob = (f << 7) | n;
      bf.textContent = '';
      bf.append(bitfield([['Function Code', f, 4, '--s1'], ['Node-ID', n, 7, '--s3']]));
      out.innerHTML = `<span>COB-ID = Function Code · 128 + Node-ID = ${f} · 128 + ${n} = <b>0x${CS.hex(cob, 3)}</b> (${cob})</span><span class="hint">Beispiel aus der Vorlesung: Knoten 5 sendet SDO mit Function Code 1011 → COB-ID 0x585. Kleinere Function Codes = höhere Priorität (NMT und SYNC zuerst).</span>`;
    };
    fc.addEventListener('change', run); nid.addEventListener('input', run); run();
    const cmd = h('select', {}, NMT.map(([v, n]) => h('option', { value: v }, '0x' + CS.hex(v, 2) + ' – ' + n)));
    cmd.value = 0x82;
    const nn = h('input', { type: 'number', min: 0, max: 127, value: 5 });
    const nmtOut = h('div', { class: 'out-box' });
    const runN = () => {
      const c = +cmd.value, n = CS.clamp(+nn.value || 0, 0, 127);
      nmtOut.innerHTML = `<span>COB-ID <b>0x000</b> · Daten <b class="mono">${CS.hex(c, 2)} ${CS.hex(n, 2)}</b></span><span class="mono" style="word-break:break-all">${'0'.repeat(11)} ${c.toString(2).padStart(8, '0')} ${n.toString(2).padStart(8, '0')}</span><span class="hint">Byte 1 = gewünschter Zustand, Byte 2 = Node-ID (0 = alle Knoten).</span>`;
    };
    cmd.addEventListener('change', runN); nn.addEventListener('input', runN); runN();
    return card('CANopen: COB-ID & NMT', [
      h('div', { class: 'grid2' }, [h('label', {}, ['Function Code', fc]), h('label', {}, ['Node-ID (1 … 127)', nid])]), bf, out,
      h('h4', {}, 'NMT-Kommando'), h('div', { class: 'grid2' }, [h('label', {}, ['Kommando', cmd]), h('label', {}, ['Node-ID', nn])]), nmtOut
    ]);
  }

  /* ---------------- Buslast ---------------- */
  function loadCard() {
    const tbl = h('table'), out = h('div', { class: 'out-box' });
    const baud = h('select', {}, [125000, 250000, 500000, 1000000].map((b) => h('option', { value: b }, CS.fmtBaud(b))));
    const run = () => {
      baud.value = baud.dataset.set ? baud.value : CS.state.net.baud;
      const b = +baud.value;
      let sum = 0, html = '<thead><tr><th>Botschaft</th><th class="num">DLC</th><th class="num">Bits (max.)</th><th class="num">Zyklus [ms]</th><th class="num">Last</th></tr></thead><tbody>';
      for (const m of CS.state.messages) {
        const base = (m.ext ? 67 : 47) + 8 * m.dlc;
        const stuff = m.ext ? Math.floor((54 + 8 * m.dlc - 1) / 4) : Math.floor((34 + 8 * m.dlc - 1) / 4);
        const bits = base + stuff;
        const l = m.cycle > 0 ? bits / b / (m.cycle / 1000) : 0;
        sum += l;
        html += `<tr><td>${CS.esc(m.name)}</td><td class="num">${m.dlc}</td><td class="num">${bits}</td><td class="num">${m.cycle}</td><td class="num">${CS.fmt(l * 100, 2)} %</td></tr>`;
      }
      tbl.innerHTML = html + '</tbody>';
      out.innerHTML = `<span>Abgeschätzte Buslast (Worst Case Stuffing): <b>${CS.fmt(sum * 100, 2)} %</b> bei ${CS.fmtBaud(b)}</span><span>Gemessen in der Simulation: <b>${CS.sim.t > 0.2 ? CS.fmt(CS.sim.load.value * 100, 2) + ' %' : '– (Simulation starten)'}</b></span>
        <span class="hint">Last = Σ (Bits je Rahmen / Bitrate / Zykluszeit). Übliche Auslegung: ≤ 50–70 %, damit niederpriore Botschaften nicht zu lange warten (CAN ist nicht deterministisch).</span>`;
    };
    baud.addEventListener('change', () => { baud.dataset.set = 1; run(); });
    CS.on('changed', run);
    T._loadRun = run;
    run();
    return card('Buslast der Kommunikationsmatrix', [h('label', { class: 'inline' }, ['Bitrate', baud]), h('div', { class: 'table-wrap' }, tbl), out]);
  }

  /* ---------------- CAN FD ---------------- */
  const FD_DLC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];
  function fdCard() {
    const pay = h('input', { type: 'number', min: 1, max: 64, value: 64 });
    const nom = h('select', {}, [250000, 500000, 1000000].map((b) => h('option', { value: b }, CS.fmtBaud(b))));
    nom.value = 500000;
    const dat = h('select', {}, [1, 2, 4, 5, 8].map((f) => h('option', { value: f * 1e6 }, f + ' Mbit/s')));
    dat.value = 2e6;
    const bars = h('div', { class: 'bars' }), out = h('div', { class: 'out-box' });
    const run = () => {
      const n = CS.clamp(+pay.value || 1, 1, 64), bn = +nom.value, bd = Math.max(+dat.value, bn);
      // Classical CAN: n Bytes in ⌈n/8⌉ Rahmen
      const frames = Math.ceil(n / 8);
      let tC = 0;
      for (let i = 0; i < frames; i++) { const d = Math.min(8, n - i * 8); tC += (47 + 8 * d + Math.floor((34 + 8 * d - 1) / 4) * 0.5) / bn; }
      // CAN FD: Arbitrierungsphase + Datenphase
      const dl = FD_DLC.find((x) => x >= n);
      const crcBits = dl <= 16 ? 17 : 21;
      const arbBits = 1 + 11 + 1 + 1 + 1 + 1 + 1;          // SOF, ID, RRS, IDE, FDF, res, BRS
      const dataBits = 1 + 4 + 8 * dl + 4 + crcBits + 5;   // ESI, DLC, Daten, SBC, CRC inkl. fester Stuff-Bits
      const tailBits = 1 + 1 + 1 + 7 + 3;                  // CRC-Del., ACK, ACK-Del., EOF, IFS
      const tFDslow = (arbBits + tailBits + (dataBits + 0.1 * (8 * dl))) / bn;
      const tFD = (arbBits + tailBits) / bn + (dataBits + 0.1 * 8 * dl) / bd;
      const mx = Math.max(tC, tFDslow, tFD);
      const row = (lab, t, col) => h('div', { class: 'bar-row' }, [h('span', {}, lab), h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(t / mx) * 100}%;background:var(${col})` })), h('span', { class: 'val' }, CS.fmt(t * 1e6, 0) + ' µs')]);
      bars.textContent = '';
      bars.append(row('Classical CAN (' + frames + ' Rahmen)', tC, '--s1'), row('CAN FD ohne BRS', tFDslow, '--s4'), row('CAN FD mit BRS', tFD, '--s3'));
      out.innerHTML = `<span>${n} Nutzbytes → CAN-FD-DLC-Stufe <b>${dl} Byte</b>, CRC ${crcBits} bit</span><span>Zeitersparnis CAN FD (BRS) gegenüber Classical CAN: <b>${CS.fmt((1 - tFD / tC) * 100, 0)} %</b></span>
        <span class="hint">CAN FD: langsame, robuste Arbitrierung (alle Knoten müssen reagieren können) – schnelle Datenphase nach dem Bit Rate Switch. Mit wenigen Datenbytes ist ein FD-Rahmen sogar länger.</span>`;
    };
    [pay, nom, dat].forEach((e) => e.addEventListener('input', run));
    run();
    return card('Classical CAN vs. CAN FD', [h('div', { class: 'grid3' }, [h('label', {}, ['Nutzdaten [Byte]', pay]), h('label', {}, ['Arbitrierungsphase', nom]), h('label', {}, ['Datenphase', dat])]), bars, out]);
  }

  /* ---------------- Versionen ---------------- */
  function versionsCard() {
    const rows = [
      ['CAN 2.0 A', '„Classical CAN“, 11-bit-Identifier (2048 IDs)'], ['CAN 2.0 B', 'Extended CAN, 29-bit-Identifier (536 870 912 IDs), kompatibel mit 2.0 A'],
      ['Low-Speed CAN', 'ISO 11898-3, fehlertolerant, bis 125 kbit/s, anteilige Terminierung je Knoten (gesamt ≈ 100 Ω)'],
      ['High-Speed CAN', 'ISO 11898-2, verbreitetste Variante, bis 1 Mbit/s, 2 × 120 Ω – Basis für OBD-II, J1939, NMEA 2000, CANopen'],
      ['CAN FD', 'Flexible Data Rate, bis 64 Byte, Datenphase bis 8 Mbit/s, ISO 11898-1:2015'], ['CAN XL', 'CiA 610-1, bis 20 Mbit/s, schließt die Lücke zu 100BASE-T1']
    ];
    return card('CAN-Versionen', [h('div', { class: 'table-wrap' }, h('table', { html: '<tbody>' + rows.map(([a, b]) => `<tr><td><b>${a}</b></td><td style="white-space:normal">${b}</td></tr>`).join('') + '</tbody>' })),
      h('p', { class: 'hint' }, '1983 Entwicklung bei Bosch · 1986 Vorstellung mit Intel (SAE) · 1991 CAN 2.0 und erste Serienanwendung (Mercedes W140) · 1993 ISO 11898 · 2012 CAN FD · 2018 Beginn CAN XL.')]);
  }

  /* ---------------- Quiz ---------------- */
  const QUIZ = [
    ['Welcher Pegel setzt sich auf dem CAN-Bus durch, wenn ein Knoten 0 und ein anderer 1 sendet?', ['Die dominante 0', 'Die rezessive 1', 'Der Pegel des Knotens mit höherer ID', 'Keiner – Kurzschluss'], 0, 'Wired-AND: Die dominante 0 überschreibt die rezessive 1. Darauf beruht die zerstörungsfreie Arbitrierung.'],
    ['Welche Botschaft gewinnt die Arbitrierung: 0x124 oder 0x126?', ['0x124', '0x126', 'Die zuerst gestartete', 'Beide senden, es kommt zum Error Frame'], 0, 'Niedrigere ID = höhere Priorität. Im ersten unterschiedlichen Bit (Bit 1) sendet 0x124 eine 0, 0x126 eine 1.'],
    ['Welchen Widerstand misst man im spannungsfreien Zustand zwischen CAN_H und CAN_L eines korrekt terminierten High-Speed-CAN?', ['60 Ω', '120 Ω', '240 Ω', '0 Ω'], 0, 'Zwei 120-Ω-Abschlüsse liegen parallel: 120 Ω ∥ 120 Ω = 60 Ω.'],
    ['Wie groß ist die maximale Buslänge bei 1 Mbit/s laut Vorlesung?', ['40 m', '100 m', '500 m', '1 km'], 0, 'Bei der Arbitrierung muss ein Bit innerhalb der Bitzeit (1 µs) zum Abtastpunkt hin- und zurücklaufen.'],
    ['Nach wie vielen gleichen Bits wird ein Stuff-Bit eingefügt?', ['5', '6', '4', '8'], 0, 'Nach 5 gleichen Bits folgt ein invertiertes Stuff-Bit. 6 gleiche Bits sind daher ein Stuff-Fehler.'],
    ['Wer erkennt einen Bit-Fehler?', ['Nur der Sender', 'Nur die Empfänger', 'Alle Knoten', 'Nur das Gateway'], 0, 'Der Sender vergleicht beim Bitmonitoring jedes gesendete Bit mit dem Buspegel.'],
    ['Wie lang ist ein Primary Active Error Flag?', ['6 dominante Bits', '6 rezessive Bits', '8 dominante Bits', '11 rezessive Bits'], 0, 'Die 6 dominanten Bits verletzen die Stuffing-Regel – dadurch bemerken alle anderen den Fehler.'],
    ['Ein Knoten hat TEC = 136. In welchem Zustand ist er?', ['Error Passive', 'Error Active', 'Bus Off', 'Sleep'], 0, 'TEC > 127 → Error Passive. Bus Off erst ab TEC > 255.'],
    ['Um wie viel erhöht sich der TEC des Senders bei einem Sendefehler?', ['+8', '+1', '+6', '+128'], 0, 'Sender: TEC + 8, erfolgreiches Senden: TEC − 1. Empfänger: REC + 1.'],
    ['Ein einzelner Knoten ist allein am Bus und sendet. Welcher Fehler tritt auf?', ['ACK-Fehler', 'CRC-Fehler', 'Stuff-Fehler', 'Kein Fehler'], 0, 'Niemand quittiert im ACK-Slot. Der Sender geht nach 16 Versuchen in Error Passive und sendet dann endlos weiter.'],
        ['Wie viele Bits umfasst ein Standardrahmen mit 8 Datenbytes von SOF bis EOF – ohne Stuff-Bits?', ['108 bit', '64 bit', '127 bit', '83 bit'], 0, '1 + 11 + 1 + 1 + 1 + 4 + 64 + 15 + 1 + 1 + 1 + 7 = 108 bit, dazu bis zu ca. 20 % Stuff-Bits und 3 bit Intermission (IFS).'],
    ['Wie viele Datenbytes werden für den Winkelsensor (2 × 16 bit, 2 Flags, 4-bit-Zähler, 8-bit-CRC) mindestens benötigt?', ['6 Byte', '5 Byte', '8 Byte', '7 Byte'], 0, '16 + 16 + 1 + 1 + 4 + 8 = 46 bit → ⌈46/8⌉ = 6 Byte.'],
    ['Welches Generatorpolynom hat die CRC-8 nach SAE J1850?', ['x⁸ + x⁴ + x³ + x² + 1', 'x⁸ + x² + x + 1', 'x¹⁵ + x¹⁴ + x¹⁰ + x⁸ + x⁷ + x⁴ + x³ + 1', 'x⁸ + x⁵ + x⁴ + 1'], 0, '0x1D, Startwert 0xFF, abschließend XOR 0xFF. Das 15-bit-Polynom ist die CRC des CAN-Rahmens selbst.'],
    ['Wozu dient ein 4-bit-Botschaftszähler?', ['Verlorene, wiederholte oder eingefrorene Botschaften erkennen', 'Die Priorität festlegen', 'Bitstuffing vermeiden', 'Die Baudrate einstellen'], 0, 'Der Empfänger erwartet +1 (modulo 16). Steht der Zähler, hängt die Sender-Software; springt er, gingen Botschaften verloren.'],
    ['Was beschreibt eine J1939-PGN?', ['Eine 18-bit-Teilmenge des 29-bit-Identifiers, die den Inhalt kennzeichnet', 'Die Adresse des Empfängers', 'Die Prüfsumme', 'Die Baudrate'], 0, 'Parameter Group Number; die enthaltenen Signale heißen SPNs (Suspect Parameter Numbers).'],
    ['Welche COB-ID hat das SDO-Antwort-Telegramm (Function Code 1011) von Knoten 5?', ['0x585', '0x605', '0x185', '0x705'], 0, '11 · 128 + 5 = 1413 = 0x585.'],
    ['Warum braucht CAN FD zwei Bitraten?', ['Die Arbitrierung muss langsam bleiben, damit alle Knoten reagieren können; die Daten werden schneller übertragen', 'Für CAN_H und CAN_L getrennt', 'Für Sender und Empfänger', 'Wegen der Verschlüsselung'], 0, 'Bei kurzer Bitzeit würde die Arbitrierung über die Leitungslänge nicht mehr funktionieren.'],
    ['Welche Schwachstelle hat Classical CAN in Bezug auf Security?', ['Keine Authentizität: Der Sender einer Botschaft ist nicht sicher feststellbar', 'Zu geringe Datenrate', 'Kein Fehlererkennungsmechanismus', 'Keine Priorisierung'], 0, 'Botschaften sind unverschlüsselt und nicht authentifiziert; jeder Knoten kann jede ID senden.']
  ];
  function quizCard() {
    const box = h('div', { class: 'quiz-q' });
    let order = [], idx = 0, score = 0, answered = 0;
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const start = () => { order = shuffle(QUIZ.map((_, i) => i)); idx = 0; score = 0; answered = 0; show(); };
    const show = () => {
      box.textContent = '';
      if (idx >= order.length) {
        box.append(h('div', { class: 'qt' }, `Ergebnis: ${score} von ${order.length} richtig`), h('p', { class: 'hint' }, score >= order.length * 0.8 ? 'Sehr gut!' : 'Die Erklärungen und die Reiter 1–6 helfen beim Vertiefen.'), h('button', { class: 'btn primary small', onclick: start }, 'Neu starten'));
        return;
      }
      const [q, opts, right, exp] = QUIZ[order[idx]];
      const perm = shuffle(opts.map((_, i) => i));
      const optsEl = h('div', { class: 'quiz-opts' });
      const expEl = h('div', { class: 'quiz-exp', hidden: true });
      const next = h('button', { class: 'btn small primary', hidden: true, onclick: () => { idx++; show(); } }, idx + 1 < order.length ? 'Weiter →' : 'Auswertung');
      perm.forEach((oi) => {
        const b = h('button', { class: 'quiz-opt' }, opts[oi]);
        b.addEventListener('click', () => {
          answered++;
          if (oi === right) score++;
          optsEl.querySelectorAll('button').forEach((x, k) => { x.disabled = true; if (perm[k] === right) x.classList.add('right'); });
          if (oi !== right) b.classList.add('wrong');
          expEl.hidden = false; expEl.textContent = exp; next.hidden = false;
        });
        optsEl.append(b);
      });
      box.append(h('div', { class: 'quiz-nav' }, [h('span', { class: 'quiz-prog' }, `Frage ${idx + 1} von ${order.length} · ${score} richtig`), h('button', { class: 'btn small', onclick: start }, 'Neu mischen')]), h('div', { class: 'qt' }, q), optsEl, expEl, next);
    };
    start();
    return card('Quiz: CAN', [box], true);
  }

  T.init = function () {
    const g = document.getElementById('toolsGrid');
    g.append(quizCard(), sigCard(), j1939Card(), canopenCard(), loadCard(), fdCard(), versionsCard());
  };
  T.setActive = function (on) { if (on && T._loadRun) T._loadRun(); };
})();
