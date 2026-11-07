/* ==========================================================================
   CANsim – Bussimulation: zyklisches Senden, Arbitrierung, ACK, Fehler-
   erkennung, Error Frames, Fehlerzähler (TEC/REC), Knotenzustände,
   Streckenmodelle (Hubwerk, Inertialsensor) und Maschinensteuerung
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const SIM = (CS.sim = {});

  SIM.running = false;
  SIM.t = 0;            // Simulationszeit [s]
  SIM.speed = 1;
  SIM.trace = [];       // Einträge, die das CAN-Interface (PC) sieht
  SIM.TRACE_MAX = 5000;
  SIM.errLog = [];
  SIM.arbLog = [];
  SIM.faults = { once: [], e2e: {}, defect: {}, noise: 0 };
  SIM.nrt = {};         // Laufzeitdaten je Knoten
  SIM.mrt = {};         // Laufzeitdaten je Botschaft
  SIM.segments = [];
  SIM.hist = { t: [], nodes: {} }; // Verlauf TEC/REC
  SIM.load = { bins: [], binT: 0, busy: 0, value: 0 };
  SIM.world = null;
  SIM.lastFrame = null;

  /* ---------------- Streckenmodelle ---------------- */
  SIM.BOOM = { min: -15, max: 55, vmax: 20, vauto: 8 }; // Winkelgrenzen [°], max. Winkelgeschwindigkeit [°/s]
  function newWorld() {
    return {
      joy: { x: 0, y: 0, b: [0, 0, 0, 0] },
      boom: { angle: 0, rate: 0, cmd: 0 },
      ecu: { joy: null, ang: null, mode: 'Warte auf Daten', e2e: { crcErr: 0, cntErr: 0, timeouts: 0, ok: 0 }, lastCnt: {}, autoDir: 0 },
      imu: { motion: false, phase: 0 },
      rnd: 1
    };
  }
  SIM.world = newWorld();
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  function imuValue(key, t) {
    const w = SIM.world, mv = w.imu.motion ? 1 : 0;
    switch (key) {
      case 'yaw': return 0.12 + 0.02 * gauss() + mv * 25 * Math.sin(2 * Math.PI * 0.2 * t);
      case 'roll': return -0.085 + 0.02 * gauss() + mv * 4 * Math.sin(2 * Math.PI * 0.5 * t);
      case 'pitch': return 0.045 + 0.02 * gauss() + mv * 3 * Math.cos(2 * Math.PI * 0.35 * t);
      case 'ax': return 0.12 + 0.01 * gauss() + mv * 1.5 * Math.sin(2 * Math.PI * 0.2 * t);
      case 'ay': return -0.7 + 0.01 * gauss() + mv * 2.2 * Math.cos(2 * Math.PI * 0.2 * t);
      case 'az': return 9.78 + 0.012 * gauss();
      case 'temp': return 37 + 4 * (1 - Math.exp(-t / 90));
    }
    return 0;
  }

  /** Physikalischer Wert einer Signalquelle */
  SIM.sourceValue = function (s, t) {
    const w = SIM.world;
    const [lo, hi] = s.min != null && s.max != null && s.max > s.min ? [s.min, s.max] : CS.sig.physRange(s);
    switch (s.src) {
      case 'x': return w.joy.x;
      case 'y': return w.joy.y;
      case 'b1': return w.joy.b[0];
      case 'b2': return w.joy.b[1];
      case 'b3': return w.joy.b[2];
      case 'b4': return w.joy.b[3];
      case 'angle': return w.boom.angle;
      case 'rate': return w.boom.rate;
      case 'upper': return w.boom.angle >= SIM.BOOM.max - 0.05 ? 1 : 0;
      case 'lower': return w.boom.angle <= SIM.BOOM.min + 0.05 ? 1 : 0;
      case 'yaw': case 'roll': case 'pitch': case 'ax': case 'ay': case 'az': case 'temp': return imuValue(s.src, t);
      case 'sine': return (lo + hi) / 2 + ((hi - lo) / 2) * Math.sin((2 * Math.PI * t) / 4);
      case 'ramp': return lo + (hi - lo) * ((t / 10) % 1);
      case 'square': return Math.floor(t * 2) % 2 ? hi : lo;
      case 'random': return lo + (hi - lo) * Math.random();
      default: return +s.val || 0;
    }
  };

  /** Datenfeld einer Botschaft erzeugen (inkl. Zähler und CRC-8 SAE J1850) */
  SIM.encode = function (m, t, rt) {
    const data = new Uint8Array(m.dlc);
    const crcSigs = [];
    const fault = SIM.faults.e2e[m.key];
    for (const s of m.signals) {
      if (s.src === 'crc') { crcSigs.push(s); continue; }
      let raw;
      if (s.src === 'counter') {
        raw = rt.counter % Math.pow(2, s.len);
      } else raw = CS.sig.toRaw(s, SIM.sourceValue(s, t));
      CS.sig.setRaw(data, s, raw);
    }
    for (const s of crcSigs) {
      const covered = new Set(CS.sig.bytes(s));
      const bytes = [...data].filter((_, i) => !covered.has(i));
      let p = CS.CRC8_PRESETS.j1850;
      if (fault === 'init0') p = Object.assign({}, p, { init: 0x00 });
      if (fault === 'noxor') p = Object.assign({}, p, { xorout: 0x00 });
      if (fault === 'poly') p = CS.CRC8_PRESETS.h2f;
      CS.sig.setRaw(data, s, CS.crc8(bytes, p) & (Math.pow(2, s.len) - 1));
    }
    if (fault === 'flip' && m.dlc) { // Bitkipper nach der CRC-Bildung (z. B. defektes Gateway)
      const bi = Math.floor(Math.random() * m.dlc), bit = Math.floor(Math.random() * 8);
      data[bi] ^= 1 << bit;
      rt.lastFlip = { byte: bi, bit };
    }
    return data;
  };

  /* ---------------- Aufbau der Bussegmente aus dem Netzwerk ---------------- */
  function nodeRt(id) {
    if (!SIM.nrt[id]) SIM.nrt[id] = { tec: 0, rec: 0, state: 'active', tx: 0, rx: 0, err: 0, busoffAt: 0, recoverAt: null, arbLost: 0 };
    return SIM.nrt[id];
  }
  SIM.rebuild = function () {
    const a = CS.phys.current();
    SIM.analysis = a;
    const main = { id: 'main', nodes: [], free: SIM.t, a };
    const segs = [main];
    for (const n of CS.state.net.nodes) {
      nodeRt(n.id);
      const x = a.nodes[n.id];
      if (x.wiring === 'ok') main.nodes.push(n.id);
      else segs.push({ id: 'iso-' + n.id, nodes: [n.id], free: SIM.t, a, isolated: x.wiring });
    }
    for (const s of segs) {
      const old = SIM.segments.find((o) => o.id === s.id);
      if (old) s.free = Math.max(old.free, SIM.t);
    }
    SIM.segments = segs;
    SIM.pcSeg = segs.find((s) => s.nodes.includes('pc') || s.nodes.some((id) => CS.nodeType(id) === 'pc'));
    for (const m of CS.state.messages) if (!SIM.mrt[m.key]) SIM.mrt[m.key] = { next: SIM.t + Math.random() * (m.cycle || 10) / 1000, pending: false, counter: 0, lost: 0, data: null, tx: 0, cntOut: 0 };
  };

  SIM.reset = function () {
    SIM.running = false;
    SIM.t = 0;
    SIM.trace = []; SIM.errLog = []; SIM.arbLog = [];
    SIM.nrt = {}; SIM.mrt = {}; SIM.segments = [];
    SIM.hist = { t: [], nodes: {} };
    SIM.load = { bins: [], binT: 0, busy: 0, value: 0 };
    SIM.faults.once = [];
    SIM.world = newWorld();
    SIM.lastFrame = null;
    SIM.rebuild();
    CS.emit('sim-reset');
  };

  /* ---------------- Fehlerzähler & Zustände ---------------- */
  function setState(id, rt) {
    const prev = rt.state;
    if (rt.state === 'busoff') return;
    const tNow = SIM._now != null ? SIM._now : SIM.t;
    if (rt.tec > 255) { rt.state = 'busoff'; rt.busoffAt = tNow; rt.recoverAt = null; }
    else if (rt.tec > 127 || rt.rec > 127) rt.state = 'passive';
    else rt.state = 'active';
    if (prev !== rt.state) {
      const txt = { active: 'Error Active', passive: 'Error Passive', busoff: 'Bus Off' }[rt.state];
      SIM.errLog.push({ t: tNow, kind: 'state', node: id, text: CS.nodeLabel(id) + ' → ' + txt + ' (TEC ' + rt.tec + ', REC ' + rt.rec + ')' });
      CS.emit('node-state', { id, state: rt.state });
    }
  }
  /** Bus-Off verlassen: Host-Eingriff + 128 × 11 rezessive Bits */
  SIM.recover = function (id) {
    const rt = SIM.nrt[id];
    if (!rt || rt.state !== 'busoff') return;
    rt.recoverAt = SIM.t + (128 * 11) / CS.state.net.baud;
    SIM.errLog.push({ t: SIM.t, kind: 'state', node: id, text: CS.nodeLabel(id) + ': Reset durch Host – warte 128 × 11 rezessive Bits' });
  };
  SIM.clearCounters = function (id) { const rt = SIM.nrt[id]; if (rt) { rt.tec = 0; rt.rec = 0; rt.state = 'active'; } };

  /* ---------------- Fehlerbewertung eines Rahmens ---------------- */
  const canTx = (id) => { const rt = SIM.nrt[id]; return rt && rt.state !== 'busoff'; };
  /** Prüft, ob Fehler auftreten. Liefert null (fehlerfrei) oder Fehlerobjekt. */
  function evalFrame(seg, sender, fr, contenders, m) {
    const a = seg.a, ax = a.nodes;
    const others = seg.nodes.filter((id) => id !== sender && canTx(id));
    const good = others.filter((id) => ax[id].baudOk);
    const ackers = good.filter((id) => !CS.nodeById(id).silent);
    const bits = fr.bits;
    const rnd = (a0, b0) => a0 + Math.floor(Math.random() * (b0 - a0 + 1));
    const idxOf = (f) => bits.findIndex((b) => b.f === f);
    const dataStart = Math.max(1, idxOf('DLC'));
    const E = (type, pos, detector, cause, extra) => Object.assign({ type, pos, detector, cause: cause || null }, extra || {});
    // Einzelfehler (vom Benutzer injiziert)
    const oi = SIM.faults.once.findIndex((f) => !f.msg || f.msg === m.key);
    if (oi >= 0) {
      const f = SIM.faults.once.splice(oi, 1)[0];
      const r = good[0] || others[0] || sender;
      if (f.type === 'bit') return E('bit', rnd(dataStart, fr.stuffEnd), sender, null, { injected: true });
      if (f.type === 'stuff') return E('stuff', rnd(dataStart, fr.stuffEnd), r, null, { injected: true });
      if (f.type === 'crc') return E('crc', idxOf('ACKdel') + 1, r, null, { injected: true });
      if (f.type === 'form') return E('form', idxOf('CRCdel'), r, null, { injected: true });
      if (f.type === 'ack') return E('ack', idxOf('ACK'), sender, null, { injected: true });
    }
    const iso = seg.isolated;
    if (iso === 'swapped') return E('bit', 0, sender, sender, { why: 'CAN_H/CAN_L vertauscht: Der Sender liest seine dominanten Bits als rezessiv zurück.' });
    if (iso) return E('ack', idxOf('ACK'), sender, null, { why: 'Knoten nicht (vollständig) mit dem Bus verbunden – niemand bestätigt den Empfang.' });
    if (!ax[sender].baudOk) return E('bit', rnd(1, 12), sender, sender, { why: CS.nodeLabel(sender) + ' sendet mit falscher Baudrate – die Empfänger erkennen Stuff-/Formfehler.' });
    if (SIM.faults.defect[sender]) return E('bit', rnd(dataStart, fr.stuffEnd), sender, sender, { why: 'Defekter Transceiver bei ' + CS.nodeLabel(sender) + '.' });
    if (contenders > 1 && !a.lenOk && Math.random() < 0.5)
      return E('bit', rnd(1, 11), sender, sender, { why: 'Leitung zu lang für die Bitrate: Während der Arbitrierung kommen die Pegel anderer Knoten erst nach dem Abtastpunkt an.' });
    // Empfängerseitige Fehler (falsche Baudrate, Signalqualität, defekter Empfänger, Störungen)
    const bad = [];
    for (const r of others) {
      const nx = ax[r];
      if (!nx.baudOk) { bad.push([r, 'baud']); continue; }
      if (SIM.faults.defect[r]) { bad.push([r, 'defect']); continue; }
      const lk = a.links[sender] && a.links[sender][r];
      if (lk && !lk.ok) { bad.push([r, 'phys']); continue; }
      const noise = SIM.faults.noise;
      if (noise > 0 && lk) {
        const marg = Math.max(0, lk.margin);
        const p = noise > marg ? 0.6 : noise > 0.5 * marg ? 0.04 : 0.002 * noise;
        if (Math.random() < p) bad.push([r, 'noise']);
      }
    }
    const activeBad = bad.filter(([r]) => SIM.nrt[r].state === 'active');
    if (activeBad.length) {
      const [r, why] = activeBad[0];
      const type = why === 'noise' ? ['stuff', 'crc', 'form'][rnd(0, 2)] : why === 'phys' ? 'stuff' : why === 'baud' ? 'form' : 'crc';
      const pos = type === 'crc' ? idxOf('ACKdel') + 1 : type === 'form' ? idxOf('CRCdel') : rnd(dataStart, fr.stuffEnd);
      const texts = {
        baud: CS.nodeLabel(r) + ' ist auf eine andere Baudrate eingestellt und erkennt in jedem Rahmen einen Fehler.',
        phys: 'Signalqualität: ' + CS.nodeLabel(r) + ' tastet falsche Pegel ab (Abschluss/Reflexionen, vgl. Oszilloskop in Schritt 1).',
        defect: 'Defekter Empfänger bei ' + CS.nodeLabel(r) + '.',
        noise: 'EMV-Störung verfälscht Bits beim Empfänger ' + CS.nodeLabel(r) + '.'
      };
      return E(type, pos, r, why === 'noise' ? null : r, { why: texts[why], passiveBad: bad.filter((x) => x[0] !== r).map((x) => x[0]) });
    }
    if (!ackers.length) return E('ack', idxOf('ACK'), sender, null, { why: 'Kein aktiver Empfänger quittiert den Rahmen (ACK-Slot bleibt rezessiv).', passiveBad: bad.map((x) => x[0]) });
    // ACK-Laufzeit: Die dominante Quittung muss vor dem Abtastpunkt des Senders zurück sein
    const tbit = 1e9 / CS.state.net.baud, spT = CS.state.net.samplePoint * tbit;
    const inTime = ackers.filter((r) => 2 * (Math.abs(ax[r].pos - ax[sender].pos) / CS.phys.V + 150) < spT);
    if (!inTime.length) return E('ack', idxOf('ACK'), sender, null, { why: 'Leitung zu lang für die Bitrate: Die ACK-Quittung der Empfänger erreicht den Sender erst nach seinem Abtastpunkt (Laufzeit hin und zurück ≈ ' + CS.fmt(2 * (Math.max(...ackers.map((r) => Math.abs(ax[r].pos - ax[sender].pos))) / CS.phys.V + 150), 0) + ' ns > ' + CS.fmt(spT, 0) + ' ns).', passiveBad: bad.map((x) => x[0]) });
    const late = ackers.filter((r) => !inTime.includes(r));
    if (late.length) return E('form', idxOf('ACKdel'), sender, null, { why: 'Leitung zu lang für die Bitrate: Die Quittung von ' + late.map(CS.nodeLabel).join(', ') + ' kommt verspätet an und überlagert den ACK-Delimiter (muss rezessiv sein).', passiveBad: bad.map((x) => x[0]) });
    return bad.length ? { ok: true, passiveBad: bad.map((x) => x[0]) } : null;
  }

  /** Länge des Error Frames (dominante Flag-Bits) gemäß Vorlesung, Beispiele 1–3 */
  function errorFlagBits(err, fr, senderPassive) {
    if (err.type === 'bit') {
      // Sender erkennt zuerst; Empfänger erkennen nach (6 − k) Bits einen Stuff-Fehler (k = vorangehende dominante Bits)
      let k = 0;
      for (let i = err.pos - 1; i >= 0 && fr.bits[i].v === 0 && k < 5; i--) k++;
      if (err.pos > fr.stuffEnd) return 7;
      return senderPassive ? 6 : 12 - k;
    }
    if (err.type === 'stuff') return 7;
    return 7; // CRC-, Form-, ACK-Fehler: Primär-Flag + Reaktion des Senders ein Bit später
  }

  /* ---------------- Ein Bussegment bis zum Zeitpunkt tEnd abarbeiten ---------------- */
  function runSegment(seg, tEnd) {
    const baud = CS.state.net.baud, tb = 1 / baud;
    let guard = 0;
    const msgs = CS.state.messages.filter((m) => seg.nodes.includes(m.node));
    while (seg.free <= tEnd && guard++ < 20000) {
      const now = seg.free;
      SIM._now = now;
      // Bus-Off-Rückkehr
      for (const id of seg.nodes) {
        const rt = SIM.nrt[id];
        if (rt.state === 'busoff' && rt.recoverAt != null && now >= rt.recoverAt) {
          rt.tec = 0; rt.rec = 0; rt.state = 'active'; rt.recoverAt = null;
          SIM.errLog.push({ t: now, kind: 'state', node: id, text: CS.nodeLabel(id) + ' → Error Active (nach Bus-Off-Recovery)' });
        }
      }
      // Botschaften freigeben
      let nextRel = Infinity;
      const cand = [];
      for (const m of msgs) {
        const rt = SIM.mrt[m.key];
        if (!rt) continue;
        const cyc = Math.max(0.001, (m.cycle || 100) / 1000);
        if (SIM.faults.e2e[m.key] === 'silent') { while (rt.next <= now) rt.next += cyc; rt.pending = false; nextRel = Math.min(nextRel, rt.next); continue; }
        while (rt.next <= now) {
          if (rt.pending) rt.lost++;
          rt.pending = true; rt.data = null; rt.relT = rt.next;
          rt.next += cyc;
        }
        nextRel = Math.min(nextRel, rt.next);
        if (rt.pending && canTx(m.node)) cand.push(m);
      }
      if (!cand.length) { seg.free = Math.max(now + 1e-9, Math.min(nextRel, tEnd + 1e-6)); if (nextRel > tEnd) break; continue; }
      cand.sort((p, q) => CS.can.arbCompare(p, q));
      const m = cand[0];
      if (cand.length > 1) {
        cand.slice(1).forEach((x) => SIM.nrt[x.node] && x.node !== m.node && SIM.nrt[x.node].arbLost++);
        if (seg === SIM.pcSeg || seg.id === 'main') {
          SIM.arbLog.push({ t: now, list: cand.slice(0, 4).map((x) => ({ id: x.id, ext: x.ext, name: x.name, node: x.node })) });
          if (SIM.arbLog.length > 50) SIM.arbLog.shift();
        }
      }
      const rt = SIM.mrt[m.key];
      if (!rt.data) { rt.counter = SIM.faults.e2e[m.key] === 'cntFreeze' ? rt.counter : rt.counter + (SIM.faults.e2e[m.key] === 'cntJump' && Math.random() < 0.3 ? 2 : 1); rt.data = SIM.encode(m, now, rt); }
      const fr = CS.can.buildFrame({ id: m.id, ext: m.ext, dlc: m.dlc, data: rt.data });
      const snd = SIM.nrt[m.node];
      const err = evalFrame(seg, m.node, fr, cand.length, m);
      const pcId = seg.nodes.find((id) => CS.nodeType(id) === 'pc');
      const pcRt = pcId && SIM.nrt[pcId];
      const pcSees = pcRt && pcRt.state !== 'busoff' && pcId !== m.node;
      let dur;
      if (err && !err.ok) {
        const passiveSender = snd.state === 'passive';
        const flagBits = errorFlagBits(err, fr, passiveSender && err.detector === m.node);
        dur = (err.pos + flagBits + 8 + 3) * tb;
        // Zähler
        if (!(err.type === 'ack' && passiveSender)) snd.tec += 8;
        snd.err++;
        for (const r of seg.nodes) {
          if (r === m.node || !canTx(r)) continue;
          SIM.nrt[r].rec = Math.min(255, SIM.nrt[r].rec + (r === err.cause ? 8 : 1));
          setState(r, SIM.nrt[r]);
        }
        setState(m.node, snd);
        const pcBaudOk = pcId && seg.a.nodes[pcId] && seg.a.nodes[pcId].baudOk;
        const e = { t: now, kind: 'error', type: err.type, id: m.id, ext: m.ext, name: m.name, msg: m.key, sender: m.node, detector: err.detector, cause: err.cause, pos: err.pos, flagBits, field: (fr.bits[err.pos] || {}).f, why: err.why, injected: err.injected, seg: seg.id };
        SIM.errLog.push(e);
        if (SIM.errLog.length > 400) SIM.errLog.splice(0, 100);
        if (pcSees || (pcId && pcId !== m.node && !pcBaudOk)) addTrace({ t: now, type: 'error', err: e, id: m.id, ext: m.ext, name: m.name, key: m.key, node: m.node, flagBits }, seg);
        SIM.lastFrame = { fr, m, data: rt.data, t: now, err: e };
      } else {
        dur = fr.nTotal * tb;
        rt.pending = false; rt.tx++;
        snd.tx++;
        snd.tec = Math.max(0, snd.tec - 1); setState(m.node, snd);
        const passiveBad = (err && err.passiveBad) || [];
        for (const r of seg.nodes) {
          if (r === m.node || !canTx(r)) continue;
          const rrt = SIM.nrt[r];
          if (passiveBad.includes(r)) { rrt.rec = Math.min(255, rrt.rec + 1); setState(r, rrt); continue; }
          if (!seg.a.nodes[r].baudOk) continue;
          rrt.rec = Math.max(0, rrt.rec - 1); rrt.rx++; setState(r, rrt);
          deliver(r, m, rt.data, now + dur);
        }
        const entry = { t: now + dur - 13 * tb, type: 'data', id: m.id, ext: m.ext, dlc: m.dlc, data: rt.data, name: m.name, key: m.key, node: m.node, bits: fr.nTotal, stuff: fr.nStuff, flip: SIM.faults.e2e[m.key] === 'flip' ? rt.lastFlip : null };
        if (pcSees && !passiveBad.includes(pcId) && seg.a.nodes[pcId].baudOk) addTrace(entry, seg);
        SIM.lastFrame = { fr, m, data: rt.data, t: now };
      }
      if (seg === SIM.pcSeg || (!SIM.pcSeg && seg.id === 'main')) SIM.load.busy += dur;
      seg.free = now + dur;
    }
  }

  function addTrace(e, seg) {
    if (seg !== SIM.pcSeg) return;
    SIM.trace.push(e);
    if (SIM.trace.length > SIM.TRACE_MAX) SIM.trace.splice(0, 1000);
    CS.emit('frame', e);
  }

  /* ---------------- Empfang in der Maschinensteuerung ---------------- */
  function deliver(rx, m, data, t) {
    if (CS.nodeType(rx) !== 'ecu') return;
    const ecu = SIM.world.ecu;
    // E2E-Prüfung (CRC-8 J1850 und Zähler), sofern die Botschaft sie enthält
    const crcS = m.signals.find((s) => s.src === 'crc'), cntS = m.signals.find((s) => s.src === 'counter');
    if (crcS) {
      const cov = new Set(CS.sig.bytes(crcS));
      const calc = CS.crc8([...data].filter((_, i) => !cov.has(i))) & (Math.pow(2, crcS.len) - 1);
      if (calc !== CS.sig.getRaw(data, crcS)) { ecu.e2e.crcErr++; ecu.lastE2E = { t, msg: m.name, text: 'CRC falsch → Botschaft verworfen' }; return; }
    }
    if (cntS) {
      const c = CS.sig.getRaw(data, cntS), prev = ecu.lastCnt[m.key], mod = Math.pow(2, cntS.len);
      ecu.lastCnt[m.key] = c;
      if (prev != null && (c - prev + mod) % mod !== 1) {
        ecu.e2e.cntErr++;
        ecu.lastE2E = { t, msg: m.name, text: (c === prev ? 'Zähler steht (' + c + ')' : 'Zählersprung ' + prev + ' → ' + c) };
        if (c === prev) return; // eingefrorener Sender: Daten nicht verwenden
      }
    }
    ecu.e2e.ok++;
    const val = (src) => { const s = m.signals.find((x) => x.src === src); return s ? CS.sig.toPhys(s, CS.sig.getRaw(data, s)) : null; };
    if (CS.nodeType(m.node) === 'joystick') ecu.joy = { t, x: val('x') || 0, y: val('y') || 0, b: ['b1', 'b2', 'b3', 'b4'].map((k) => val(k) || 0) };
    if (CS.nodeType(m.node) === 'angle') ecu.ang = { t, angle: val('angle'), upper: val('upper'), lower: val('lower') };
  }

  /* ---------------- Steuerung & Strecke ---------------- */
  function physics(dt) {
    const w = SIM.world, B = SIM.BOOM, ecu = w.ecu;
    if (CS.state.scenario !== 'boom') return;
    const ecuRt = SIM.nrt.ecu;
    const ecuOk = ecuRt && ecuRt.state !== 'busoff' && SIM.segments.find((s) => s.id === 'main' && s.nodes.includes('ecu'));
    let cmd = 0;
    if (!ecuOk) { ecu.mode = CS.nodeById('ecu') ? 'Steuerung nicht am Bus' : 'Keine Steuerung im Netzwerk'; ecu.autoDir = 0; }
    else if (!ecu.joy || SIM.t - ecu.joy.t > 0.1) { ecu.mode = 'Timeout Joystick → Stillstand'; if (ecu.joy) ecu.e2e.timeouts++; ecu.joy = null; ecu.autoDir = 0; }
    else {
      const j = ecu.joy, defl = Math.abs(j.x) > 50 || Math.abs(j.y) > 50;
      const pressed = j.b.filter((b) => b >= 1).length;
      if (CS.state.settings.auto) {
        if (defl) ecu.autoDir = 0;
        else if (pressed === 1 && j.b[0] >= 1) ecu.autoDir = 1;
        else if (pressed === 1 && j.b[1] >= 1) ecu.autoDir = -1;
        else if (pressed > 1) ecu.autoDir = 0;
        const angOk = ecu.ang && SIM.t - ecu.ang.t < 0.1;
        if (ecu.autoDir === 1 && angOk && ecu.ang.upper >= 1) ecu.autoDir = 0;
        if (ecu.autoDir === -1 && angOk && ecu.ang.lower >= 1) ecu.autoDir = 0;
      } else ecu.autoDir = 0;
      if (ecu.autoDir) { cmd = (ecu.autoDir * B.vauto) / B.vmax; ecu.mode = 'Automatik: Endlage ' + (ecu.autoDir > 0 ? 'oben' : 'unten') + ' anfahren'; }
      else if (Math.abs(j.y) > 50) { cmd = j.y / 1000; ecu.mode = 'Manuell'; }
      else ecu.mode = pressed > 1 ? 'Mehrere Taster → keine Bewegung' : 'Bereit';
    }
    w.boom.cmd = cmd;
    const target = CS.clamp(cmd, -1, 1) * B.vmax;
    const k = 1 - Math.exp(-dt / 0.15);
    let rate = w.boom.rate + (target - w.boom.rate) * k;
    let ang = w.boom.angle + rate * dt;
    if (ang >= B.max) { ang = B.max; if (rate > 0) rate = 0; }
    if (ang <= B.min) { ang = B.min; if (rate < 0) rate = 0; }
    w.boom.angle = ang; w.boom.rate = rate;
  }

  /* ---------------- Hauptschleife ---------------- */
  SIM.advance = function (simDt) {
    const tEnd = SIM.t + simDt;
    const sub = Math.max(1e-4, Math.min(0.005, simDt));
    let t = SIM.t;
    while (t < tEnd - 1e-12) {
      const tn = Math.min(tEnd, t + sub);
      physics(tn - t);
      for (const seg of SIM.segments) runSegment(seg, tn);
      t = tn; SIM.t = t;
      // Buslast in 100-ms-Fenstern
      if (SIM.t - SIM.load.binT >= 0.1) {
        const span = SIM.t - SIM.load.binT;
        SIM.load.bins.push(SIM.load.busy / span);
        if (SIM.load.bins.length > 10) SIM.load.bins.shift();
        SIM.load.value = SIM.load.bins.reduce((x, y) => x + y, 0) / SIM.load.bins.length;
        SIM.load.binT = SIM.t; SIM.load.busy = 0;
        SIM.hist.t.push(SIM.t);
        for (const id of Object.keys(SIM.nrt)) {
          const h = (SIM.hist.nodes[id] = SIM.hist.nodes[id] || { tec: [], rec: [] });
          while (h.tec.length < SIM.hist.t.length - 1) { h.tec.push(0); h.rec.push(0); }
          h.tec.push(SIM.nrt[id].tec); h.rec.push(SIM.nrt[id].rec);
        }
        if (SIM.hist.t.length > 1200) { SIM.hist.t.shift(); for (const h of Object.values(SIM.hist.nodes)) { h.tec.shift(); h.rec.shift(); } }
      }
    }
  };

  let lastReal = 0;
  function loop(ts) {
    if (!SIM.running) return;
    const dtReal = lastReal ? Math.min(0.1, (ts - lastReal) / 1000) : 0;
    lastReal = ts;
    if (dtReal > 0) SIM.advance(dtReal * SIM.speed);
    CS.emit('tick');
    requestAnimationFrame(loop);
  }
  SIM.start = function () {
    if (SIM.running) return;
    SIM.rebuild();
    SIM.running = true; lastReal = 0;
    CS.emit('sim-run', true);
    requestAnimationFrame(loop);
  };
  SIM.pause = function () { SIM.running = false; CS.emit('sim-run', false); CS.emit('tick'); };
  /** Einzelschritt: Simulation um dt weiterrechnen (auch im Pausenzustand) */
  SIM.step = function (dt) { if (!SIM.segments.length) SIM.rebuild(); SIM.advance(dt); CS.emit('tick'); };
  SIM.inject = function (type, msgKey) { SIM.faults.once.push({ type, msg: msgKey || null }); };

  // Netzwerk oder Botschaften geändert → Segmente neu bilden (Zähler bleiben erhalten)
  CS.on('changed', () => { SIM.rebuild(); });
})();
