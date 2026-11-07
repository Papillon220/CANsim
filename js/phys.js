/* ==========================================================================
   CANsim – Physikalische Schicht (ISO 11898-2, High-Speed-CAN)
   Verdrahtung, Abschluss, Leitungsmodell (FDTD), Abtastung beim Empfänger
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const P = (CS.phys = {});

  /* Geometrie des Netzwerk-Editors (SVG-Koordinaten) */
  P.GEO = { W: 1000, H: 480, x0: 60, x1: 940, yH: 214, yL: 266, nodeW: 150, nodeH: 66 };
  P.Z0 = 120;          // Wellenwiderstand der verdrillten Leitung [Ω]
  P.V = 0.2;           // Ausbreitungsgeschwindigkeit [m/ns] (≈ 5 ns/m)
  P.VS = 3.2;          // Leerlauf-Differenzspannung des Senders (dominant) [V]
  P.RS = 30;           // Innenwiderstand des Senders (dominant) [Ω]
  P.RIN = 30000;       // Differentieller Eingangswiderstand eines Empfängers [Ω]
  P.CNODE = 20e-12;    // Eingangskapazität je Knoten [F]
  P.TR = 40;           // Flankenanstiegszeit des Senders [ns]
  P.TH_DOM = 0.9;      // Empfängerschwelle dominant [V]
  P.TH_REC = 0.5;      // Empfängerschwelle rezessiv [V]
  P.MAX_LEN = { 1000000: 40, 800000: 50, 500000: 100, 250000: 250, 125000: 500, 50000: 1000 };
  P.MAX_STUB = 0.4;    // Stichleitung (Vorlesung: max. 0,4 m; ISO 11898-2 empfiehlt ≤ 0,3 m bei 1 Mbit/s)
  P.MAX_NODES = 128;
  P.TEST_BITS = [0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1];

  P.pinX = (n, pin) => n.x + (pin === 'H' ? 50 : 100);
  P.toMeter = function (x) {
    const g = P.GEO, L = CS.state.net.busLength;
    return CS.clamp((x - g.x0) / (g.x1 - g.x0), 0, 1) * L;
  };
  P.nodePos = (n) => P.toMeter((P.pinX(n, 'H') + P.pinX(n, 'L')) / 2);

  /** Verdrahtungszustand eines Knotens */
  P.wiring = function (n) {
    if (!n.pinH && !n.pinL) return 'open';
    if (!n.pinH || !n.pinL) return 'partial';
    if (n.pinH === n.pinL) return 'short';
    if (n.pinH === 'L' && n.pinL === 'H') return 'swapped';
    return 'ok';
  };
  P.WIRING_TEXT = {
    ok: 'korrekt angeschlossen', open: 'nicht angeschlossen', partial: 'nur eine Ader angeschlossen',
    short: 'beide Adern an derselben Busleitung', swapped: 'CAN_H und CAN_L vertauscht'
  };
  const par = (rs) => { let g = 0; for (const r of rs) if (r > 0 && isFinite(r)) g += 1 / r; return g > 0 ? 1 / g : Infinity; };
  P.parallel = par;

  /** Analyse des gesamten Netzwerks (ohne Zeitbereichssimulation) */
  P.analyze = function () {
    const net = CS.state.net, L = net.busLength, baud = net.baud;
    const endTol = Math.max(0.5, 0.05 * L);
    const nodes = {};
    const terms = []; // {pos, R, label}
    for (const n of net.nodes) {
      const w = P.wiring(n);
      const pos = P.nodePos(n);
      const baudOk = !n.baud || n.baud === baud;
      nodes[n.id] = { node: n, wiring: w, pos, baudOk, onBus: w === 'ok' || w === 'swapped' };
      if (n.term && (w === 'ok' || w === 'swapped')) terms.push({ pos, R: n.term, label: n.name + ' (intern)' });
    }
    for (const r of net.res) terms.push({ pos: P.toMeter(r.x), R: r.R, label: 'R' + (net.res.indexOf(r) + 1), res: r });
    const endA = terms.filter((t) => t.pos <= endTol), endB = terms.filter((t) => t.pos >= L - endTol);
    const mid = terms.filter((t) => t.pos > endTol && t.pos < L - endTol);
    const RA = par(endA.map((t) => t.R)), RB = par(endB.map((t) => t.R));
    const rinAll = Object.values(nodes).filter((x) => x.onBus).map(() => P.RIN);
    const Rterm = par(terms.map((t) => t.R));
    const Rdc = par(terms.map((t) => t.R).concat(rinAll));
    const gamma = (R) => (isFinite(R) ? (R - P.Z0) / (R + P.Z0) : 1);
    const res = { nodes, terms, endA, endB, mid, RA, RB, gA: gamma(RA), gB: gamma(RB), Rterm, Rdc, endTol, L, baud };
    res.vdom = P.VS * Rdc / (Rdc + P.RS);
    res.maxLen = P.MAX_LEN[baud] || 40;
    res.tBit = 1e9 / baud; // ns
    res.loop = 2 * (L / P.V + 150); // Signallaufzeit hin und zurück inkl. Transceiver [ns]
    res.lenOk = L <= res.maxLen;
    res.checks = P.checks(res);
    return res;
  };

  P.checks = function (a) {
    const net = CS.state.net, scn = CS.SCENARIOS[CS.state.scenario];
    const out = [];
    const add = (key, level, title, detail) => out.push({ key, level, title, detail });
    const list = Object.values(a.nodes);
    // 1. Vollständigkeit
    const missing = scn.nodes.filter((id) => !a.nodes[id]);
    if (scn.nodes.length) add('complete', missing.length ? 'fail' : 'ok', 'Alle Teilnehmer platziert',
      missing.length ? 'Es fehlen: ' + missing.map(CS.nodeLabel).join(', ') : 'Alle ' + scn.nodes.length + ' Knoten des Szenarios sind im Netzwerk.');
    else add('complete', list.length >= 2 ? 'ok' : 'fail', 'Mindestens zwei Knoten', list.length + ' Knoten platziert.');
    // 2. Verdrahtung
    const bad = list.filter((x) => x.wiring !== 'ok');
    add('wiring', bad.length || !list.length ? 'fail' : 'ok', 'CAN_H und CAN_L korrekt verbunden',
      bad.length ? bad.map((x) => x.node.name + ': ' + P.WIRING_TEXT[x.wiring]).join(' · ') : list.length ? 'Jeder Knoten: CAN_H → CAN_H, CAN_L → CAN_L.' : 'Noch keine Knoten.');
    // 3. Abschluss
    const nA = a.endA.length, nB = a.endB.length;
    let lvl = 'ok', det;
    const rOk = (R) => R >= 100 && R <= 130;
    if (!a.terms.length) { lvl = 'fail'; det = 'Keine Abschlusswiderstände: Reflexionen an beiden offenen Leitungsenden, das Bussignal entlädt sich nach dominanten Bits nur langsam.'; }
    else if (!nA || !nB) { lvl = 'fail'; det = 'Ein Leitungsende ist offen (Busende ' + (!nA ? 'A' : 'B') + '). Abschlusswiderstände gehören an beide Enden der Linie.'; }
    else if (!rOk(a.RA) || !rOk(a.RB)) { lvl = 'fail'; det = 'Abschluss passt nicht zum Wellenwiderstand Z₀ = 120 Ω: Ende A ' + CS.fmtOhm(a.RA) + ', Ende B ' + CS.fmtOhm(a.RB) + ' → Reflexionsfaktor r = ' + CS.fmtFix(a.gA, 2) + ' / ' + CS.fmtFix(a.gB, 2) + '.'; }
    else if (a.mid.length) { lvl = 'warn'; det = 'Zusätzlicher Widerstand in der Busmitte (' + a.mid.map((t) => t.label).join(', ') + ') belastet den Bus und verringert den Differenzpegel.'; }
    else det = 'Beide Enden mit ' + CS.fmtOhm(a.RA) + ' / ' + CS.fmtOhm(a.RB) + ' abgeschlossen (r ≈ 0, keine Reflexionen).';
    add('term', lvl, 'Abschluss an beiden Busenden (Z₀ = 120 Ω)', det);
    // 4. Gesamtwiderstand
    const R = a.Rterm;
    add('rdc', R >= 50 && R <= 70 ? 'ok' : R >= 45 && R <= 75 ? 'warn' : 'fail', 'Widerstand CAN_H–CAN_L ≈ 60 Ω',
      'Gemessen (Bus spannungsfrei): ' + CS.fmtOhm(a.Rdc) + '. Soll: 2 × 120 Ω parallel = 60 Ω. Dominanter Differenzpegel ≈ ' + CS.fmtFix(a.vdom, 2) + ' V (Empfängerschwelle 0,9 V).');
    // 5. Baudrate
    const wrong = list.filter((x) => !x.baudOk);
    add('baud', wrong.length ? 'fail' : 'ok', 'Einheitliche Baudrate (' + CS.fmtBaud(net.baud) + ')',
      wrong.length ? wrong.map((x) => x.node.name + ' ist auf ' + CS.fmtBaud(x.node.baud) + ' eingestellt').join(' · ') : 'Alle Teilnehmer kommunizieren mit derselben Bitrate.');
    // 6. Leitungslänge
    add('len', a.lenOk ? 'ok' : 'fail', 'Buslänge ≤ ' + a.maxLen + ' m bei ' + CS.fmtBaud(net.baud),
      'Buslänge ' + CS.fmt(a.L) + ' m. Bei der Arbitrierung muss ein Bit innerhalb einer Bitzeit (' + CS.fmt(a.tBit) + ' ns) bis zum Abtastpunkt hin- und zurücklaufen: Schleifenlaufzeit ≈ ' + CS.fmt(a.loop, 0) + ' ns.');
    // 7. Stichleitungen
    const longStubs = list.filter((x) => (x.node.stub || 0) > P.MAX_STUB);
    add('stub', longStubs.length ? 'warn' : 'ok', 'Stichleitungen ≤ ' + CS.fmt(P.MAX_STUB) + ' m',
      longStubs.length ? longStubs.map((x) => x.node.name + ': ' + CS.fmt(x.node.stub) + ' m').join(' · ') + ' – lange Stichleitungen erzeugen Reflexionen.' : 'Alle Knoten mit kurzen Stichleitungen angebunden.');
    // 8. Knotenzahl
    if (list.length > P.MAX_NODES) add('count', 'fail', 'Höchstens ' + P.MAX_NODES + ' Knoten', list.length + ' Knoten.');
    return out;
  };

  /* ======================================================================
     Zeitbereich: verlustlose Leitung als FDTD (Spannung an Knoten, Strom dazwischen).
     Abschlüsse, Empfängereingänge und der Sender (Thevenin-Quelle) als konzentrierte Elemente.
     ====================================================================== */
  /**
   * @param a      Ergebnis von analyze()
   * @param txId   sendender Knoten
   * @param bits   Bitfolge ab SOF (0 = dominant)
   * @returns {dt, n, idle, tBit, v:{nodeId: Float32Array}, samples:{nodeId:[{t,v,exp,bit,ok}]}}
   */
  P.simulate = function (a, txId, bits, baudOverride) {
    const L = Math.max(0.5, a.L);
    const baud = baudOverride || a.baud;
    const tBit = 1e9 / baud; // ns
    const idle = 1.5;        // rezessive Bits vor SOF
    const T = (bits.length + idle + 1) * tBit;
    // Zellenzahl so wählen, dass der Rechenaufwand begrenzt bleibt
    const vm = P.V; // m/ns
    let N = Math.round(Math.sqrt(3e6 * L / (T * vm)));
    N = CS.clamp(N, 6, 120);
    const dx = L / N, dt = dx / vm; // ns, Courant = 1
    const Lp = P.Z0 / (vm * 1e9);         // H/m
    const Cp = 1 / (P.Z0 * vm * 1e9);     // F/m
    const steps = Math.ceil(T / dt);
    const V = new Float64Array(N + 1), I = new Float64Array(N);
    const C = new Float64Array(N + 1), G = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) C[i] = Cp * dx * (i === 0 || i === N ? 0.5 : 1);
    const cell = (pos) => CS.clamp(Math.round((pos / L) * N), 0, N);
    for (const t of a.terms) G[cell(t.pos)] += 1 / t.R;
    for (const x of Object.values(a.nodes)) if (x.onBus) { const c = cell(x.pos); G[c] += 1 / P.RIN; C[c] += P.CNODE; }
    const tx = a.nodes[txId];
    const txCell = tx ? cell(tx.pos) : 0;
    const sign = tx && tx.wiring === 'swapped' ? -1 : 1;
    const dts = dt * 1e-9;
    const kI = dts / (Lp * dx);
    // Quelle: rampenförmige Leerlaufspannung, Innenwiderstand nur während dominanter Bits
    const level = (t) => { // 1 = dominant angesteuert (mit Rampe), 0 = aus
      const tb = t / tBit - idle;
      if (tb < 0) return 0;
      const k = Math.floor(tb);
      if (k >= bits.length) return 0;
      const cur = bits[k] === 0 ? 1 : 0, prev = k > 0 ? (bits[k - 1] === 0 ? 1 : 0) : 0;
      const into = (tb - k) * tBit;
      if (cur === prev || into >= P.TR) return cur;
      return prev + (cur - prev) * (into / P.TR);
    };
    const rec = Object.values(a.nodes).filter((x) => x.onBus || x.node.id === txId);
    const out = {}; rec.forEach((x) => (out[x.node.id] = new Float32Array(steps)));
    const recCells = rec.map((x) => [x.node.id, cell(x.pos), x.wiring === 'swapped' ? -1 : 1]);
    for (let s = 0; s < steps; s++) {
      const t = s * dt;
      for (let i = 0; i < N; i++) I[i] += kI * (V[i] - V[i + 1]);
      const lv = tx && tx.onBus ? level(t) : 0;
      for (let i = 0; i <= N; i++) {
        let g = G[i], src = 0;
        if (i === txCell && lv > 0) { g += lv / P.RS; src = (sign * P.VS * lv) / P.RS; }
        const inI = (i > 0 ? I[i - 1] : 0) - (i < N ? I[i] : 0);
        const a1 = C[i] / dts;
        V[i] = ((a1 - g / 2) * V[i] + inI + src) / (a1 + g / 2);
      }
      for (const [id, c, sg] of recCells) out[id][s] = V[c] * sg;
    }
    // Abtastung bei den Empfängern (Hard-Sync auf die SOF-Flanke: Laufzeit berücksichtigen)
    const sp = CS.state.net.samplePoint;
    const samples = {};
    for (const x of rec) {
      const id = x.node.id, arr = out[id];
      const delay = tx ? Math.abs(x.pos - tx.pos) / vm : 0;
      const list = [];
      for (let k = 0; k < bits.length; k++) {
        const ts = (idle + k + sp) * tBit + delay;
        const v = arr[Math.min(steps - 1, Math.round(ts / dt))];
        const rd = v > P.TH_DOM ? 0 : v < P.TH_REC ? 1 : -1;
        const margin = bits[k] === 0 ? v - P.TH_DOM : P.TH_REC - v;
        list.push({ t: ts, v, exp: bits[k], bit: rd, ok: rd === bits[k], margin });
      }
      samples[id] = list;
    }
    return { dt, steps, idle, tBit, T, v: out, samples, N };
  };

  /** Für die Bussimulation: Welche Empfänger können welchen Sender fehlerfrei lesen? */
  P.linkMatrix = function (a) {
    const M = {};
    const onBus = Object.values(a.nodes).filter((x) => x.onBus);
    for (const tx of onBus) {
      const sim = P.simulate(a, tx.node.id, P.TEST_BITS);
      M[tx.node.id] = {};
      for (const rx of onBus) {
        if (rx === tx) continue;
        const sm = sim.samples[rx.node.id] || [];
        const ok = sm.every((s) => s.ok);
        const margin = sm.length ? Math.min(...sm.map((s) => s.margin)) : 0;
        M[tx.node.id][rx.node.id] = { ok, margin };
      }
    }
    return M;
  };

  /** Analyse inkl. Verbindungsmatrix (zwischengespeichert, bis sich das Netzwerk ändert) */
  let cache = null, cacheKey = '';
  P.current = function () {
    const key = JSON.stringify(CS.state.net);
    if (cache && key === cacheKey) return cache;
    const a = P.analyze();
    a.links = P.linkMatrix(a);
    cache = a; cacheKey = key;
    return a;
  };
})();
