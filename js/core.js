/* ==========================================================================
   CANsim – Kern: Hilfsfunktionen, CAN-Rahmen (Bitstuffing, CRC-15),
   CRC-8 (SAE J1850), Signal-Packing (Intel/Motorola), Szenarien, Zustand
   ========================================================================== */
(function () {
  'use strict';
  const CS = (window.CS = window.CS || {});
  CS.VERSION = 'V1.0';

  /* ---------------- DOM- und Format-Helfer ---------------- */
  CS.$ = (sel, root) => (root || document).querySelector(sel);
  CS.$$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  /** Element erzeugen: h('div', {class:'x', onclick:fn}, [kinder|text]) */
  CS.h = function (tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    if (children != null) for (const c of [].concat(children)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  };
  CS.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CS.hex = (n, w) => (n >>> 0).toString(16).toUpperCase().padStart(w || 1, '0');
  CS.hexId = (id, ext) => '0x' + CS.hex(id, ext ? 8 : 3);
  CS.bytesHex = (d) => [...d].map((b) => CS.hex(b, 2)).join(' ');
  CS.parseHexBytes = function (s) {
    const t = String(s).replace(/0x/gi, '').replace(/[^0-9a-f]/gi, ' ').trim();
    if (!t) return [];
    let parts = t.split(/\s+/);
    if (parts.length === 1 && parts[0].length > 2) parts = parts[0].match(/.{1,2}/g);
    return parts.map((p) => parseInt(p, 16) & 0xff);
  };
  CS.parseNum = function (s) {
    if (typeof s === 'number') return s;
    s = String(s).trim().replace(',', '.');
    if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
    if (/^0b[01]+$/i.test(s)) return parseInt(s.slice(2), 2);
    return Number(s);
  };
  /** Zahl deutsch formatieren, Nachkommastellen d (oder automatisch) */
  CS.fmt = function (v, d) {
    if (v == null || !isFinite(v)) return '–';
    if (d == null) d = Math.abs(v) >= 1000 ? 1 : Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 1 ? 3 : 4;
    return v.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d });
  };
  CS.fmtFix = (v, d) => (v == null || !isFinite(v) ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
  CS.fmtOhm = function (r) {
    if (!isFinite(r)) return '∞ Ω';
    if (r >= 1e3) return CS.fmt(r / 1e3, 2) + ' kΩ';
    return CS.fmt(r, 1) + ' Ω';
  };
  CS.fmtBaud = (b) => (b >= 1e6 ? b / 1e6 + ' Mbit/s' : b / 1e3 + ' kbit/s');
  CS.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  CS.uid = (p) => (p || 'x') + Math.random().toString(36).slice(2, 8);
  CS.deepClone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------------- Ereignisse ---------------- */
  const listeners = {};
  CS.on = (evt, fn) => (listeners[evt] = listeners[evt] || []).push(fn);
  CS.emit = (evt, data) => (listeners[evt] || []).forEach((fn) => fn(data));

  CS.toast = function (msg, kind) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(CS._toastT);
    CS._toastT = setTimeout(() => (t.className = 'toast'), 3200);
  };

  /** Farbwerte aus CSS-Variablen (für Canvas-Zeichnungen) */
  CS.css = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  };
  CS.seriesColor = (i) => CS.css('--s' + ((i % 5) + 1));

  /** Canvas an CSS-Größe und Pixeldichte anpassen, liefert 2D-Kontext */
  CS.fitCanvas = function (cv) {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  };

  /* ======================================================================
     CAN-Rahmen (Classical CAN, ISO 11898-1)
     ====================================================================== */
  const CAN = (CS.can = {});
  CAN.CRC15_POLY = 0x4599; // x^15 + x^14 + x^10 + x^8 + x^7 + x^4 + x^3 + 1

  /** CRC-15 über eine Bitfolge (ohne Stuff-Bits). Optional Schritte protokollieren. */
  CAN.crc15 = function (bits, steps) {
    let c = 0;
    for (let i = 0; i < bits.length; i++) {
      const msb = (c >> 14) & 1, nxt = bits[i] ^ msb;
      c = (c << 1) & 0x7fff;
      if (nxt) c ^= CAN.CRC15_POLY;
      if (steps) steps.push({ i, bit: bits[i], msb, xor: nxt, reg: c });
    }
    return c;
  };
  const pushBits = (arr, val, n, field) => { for (let i = n - 1; i >= 0; i--) arr.push({ v: (val >>> i) & 1, f: field, k: n - 1 - i }); };

  /**
   * Baut einen Data-/Remote-Frame auf.
   * Ergebnis: { raw: Bits ohne Stuffing bis inkl. CRC, bits: gesamter Rahmen mit Stuffbits und Feldern,
   *   nStuff, nTotal (inkl. IFS), crc, stuffEnd (Index des letzten gestopften Bits) }
   */
  CAN.buildFrame = function (fr) {
    const id = fr.id >>> 0, ext = !!fr.ext, rtr = !!fr.rtr, dlc = fr.dlc | 0;
    const data = fr.data || [];
    const pre = [];
    pre.push({ v: 0, f: 'SOF', k: 0 });
    if (!ext) {
      pushBits(pre, id & 0x7ff, 11, 'ID');
      pre.push({ v: rtr ? 1 : 0, f: 'RTR', k: 0 });
      pre.push({ v: 0, f: 'IDE', k: 0 });
      pre.push({ v: 0, f: 'r0', k: 0 });
    } else {
      pushBits(pre, (id >>> 18) & 0x7ff, 11, 'ID');
      pre.push({ v: 1, f: 'SRR', k: 0 });
      pre.push({ v: 1, f: 'IDE', k: 0 });
      pushBits(pre, id & 0x3ffff, 18, 'IDx');
      pre.push({ v: rtr ? 1 : 0, f: 'RTR', k: 0 });
      pre.push({ v: 0, f: 'r1', k: 0 });
      pre.push({ v: 0, f: 'r0', k: 0 });
    }
    pushBits(pre, dlc, 4, 'DLC');
    if (!rtr) for (let b = 0; b < Math.min(8, dlc); b++) {
      const s = pre.length;
      pushBits(pre, data[b] || 0, 8, 'DATA');
      for (let j = 0; j < 8; j++) pre[s + j].byte = b;
    }
    const crc = CAN.crc15(pre.map((b) => b.v));
    pushBits(pre, crc, 15, 'CRC');
    // Bitstuffing von SOF bis Ende CRC-Sequenz
    const bits = [];
    let run = 0, last = -1, nStuff = 0;
    for (const b of pre) {
      bits.push(b);
      if (b.v === last) run++; else { run = 1; last = b.v; }
      if (run === 5) {
        const s = { v: 1 - last, f: 'STUFF', k: 0, stuffIn: b.f };
        bits.push(s); nStuff++;
        last = s.v; run = 1;
      }
    }
    const stuffEnd = bits.length - 1;
    bits.push({ v: 1, f: 'CRCdel', k: 0 });
    bits.push({ v: 0, f: 'ACK', k: 0 });
    bits.push({ v: 1, f: 'ACKdel', k: 0 });
    for (let i = 0; i < 7; i++) bits.push({ v: 1, f: 'EOF', k: i });
    for (let i = 0; i < 3; i++) bits.push({ v: 1, f: 'IFS', k: i });
    return { raw: pre, bits, nStuff, nTotal: bits.length, nNoStuff: pre.length + 13, crc, stuffEnd };
  };

  /** Bitstuffing auf beliebige Bitfolge (für Übungen) */
  CAN.stuff = function (arr) {
    const out = []; let run = 0, last = -1;
    for (const v of arr) {
      out.push({ v, s: false });
      if (v === last) run++; else { run = 1; last = v; }
      if (run === 5) { out.push({ v: 1 - v, s: true }); last = 1 - v; run = 1; }
    }
    return out;
  };
  /** Entstuffen; liefert {bits, error: Index des Stuff-Fehlers oder -1} */
  CAN.destuff = function (arr) {
    const out = []; let run = 0, last = -1, skip = false;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (skip) {
        if (v === last) return { bits: out, error: i };
        skip = false; last = v; run = 1; continue;
      }
      out.push(v);
      if (v === last) run++; else { run = 1; last = v; }
      if (run === 5) skip = true;
    }
    return { bits: out, error: -1 };
  };

  /** Arbitrierungsbits (ID-Feld inkl. RTR/SRR/IDE) – für den Prioritätsvergleich */
  CAN.arbBits = function (id, ext, rtr) {
    const b = [];
    if (!ext) { pushBits(b, id & 0x7ff, 11, 'ID'); b.push({ v: rtr ? 1 : 0, f: 'RTR' }); b.push({ v: 0, f: 'IDE' }); }
    else {
      pushBits(b, (id >>> 18) & 0x7ff, 11, 'ID'); b.push({ v: 1, f: 'SRR' }); b.push({ v: 1, f: 'IDE' });
      pushBits(b, id & 0x3ffff, 18, 'IDx'); b.push({ v: rtr ? 1 : 0, f: 'RTR' });
    }
    return b;
  };
  /** Vergleich zweier Rahmen in der Arbitrierung: <0 wenn a gewinnt */
  CAN.arbCompare = function (a, b) {
    const x = CAN.arbBits(a.id, a.ext, a.rtr), y = CAN.arbBits(b.id, b.ext, b.rtr);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i] ? x[i].v : 1, q = y[i] ? y[i].v : 1;
      if (p !== q) return p - q;
    }
    return 0;
  };

  CAN.FIELD_NAMES = {
    SOF: 'Start of Frame', ID: 'Identifier', IDx: 'Identifier (Erweiterung, 18 bit)', SRR: 'Substitute Remote Request', RTR: 'Remote Transmission Request',
    IDE: 'Identifier Extension', r0: 'reserviert (r0)', r1: 'reserviert (r1)', DLC: 'Data Length Code', DATA: 'Datenfeld', CRC: 'CRC-Sequenz (15 bit)',
    CRCdel: 'CRC-Delimiter', ACK: 'ACK-Slot', ACKdel: 'ACK-Delimiter', EOF: 'End of Frame', IFS: 'Intermission (IFS)', STUFF: 'Stuff-Bit'
  };

  /* ======================================================================
     CRC-8 für die Ende-zu-Ende-Absicherung im Datenfeld (z. B. SAE J1850)
     ====================================================================== */
  CS.CRC8_PRESETS = {
    j1850: { name: 'SAE J1850 (Poly 0x1D, Init 0xFF, XorOut 0xFF)', poly: 0x1d, init: 0xff, xorout: 0xff },
    j1850z: { name: 'SAE J1850 Zero (Init 0x00, XorOut 0x00)', poly: 0x1d, init: 0x00, xorout: 0x00 },
    h2f: { name: 'AUTOSAR CRC8H2F (Poly 0x2F, Init 0xFF, XorOut 0xFF)', poly: 0x2f, init: 0xff, xorout: 0xff },
    smbus: { name: 'CRC-8 SMBus (Poly 0x07, Init 0x00, XorOut 0x00)', poly: 0x07, init: 0x00, xorout: 0x00 }
  };
  CS.crc8 = function (bytes, p, steps) {
    p = p || CS.CRC8_PRESETS.j1850;
    let c = p.init & 0xff;
    for (let i = 0; i < bytes.length; i++) {
      const before = c;
      c ^= bytes[i];
      const bitSteps = [];
      for (let j = 0; j < 8; j++) {
        const msb = (c & 0x80) !== 0;
        c = msb ? ((c << 1) ^ p.poly) & 0xff : (c << 1) & 0xff;
        bitSteps.push({ msb, reg: c });
      }
      if (steps) steps.push({ i, byte: bytes[i], before, afterXor: before ^ bytes[i], bitSteps, reg: c });
    }
    return (c ^ p.xorout) & 0xff;
  };
  CS.polyStr8 = function (poly) {
    const t = ['x⁸'];
    const sup = ['', '', '²', '³', '⁴', '⁵', '⁶', '⁷'];
    for (let i = 7; i >= 0; i--) if ((poly >> i) & 1) t.push(i === 0 ? '1' : i === 1 ? 'x' : 'x' + sup[i]);
    return t.join(' + ');
  };

  /* ======================================================================
     Signale: Rohwert <-> Datenfeld (DBC-Konventionen)
     ====================================================================== */
  const SIG = (CS.sig = {});
  /** Bitpositionen (DBC-Nummerierung: Byte*8 + Bit, Bit 0 = LSB) vom LSB zum MSB des Signals */
  SIG.positions = function (s) {
    const out = [];
    if (s.order !== 'motorola') {
      for (let k = 0; k < s.len; k++) out.push(s.start + k);
    } else {
      // Motorola: Startbit ist das MSB, Folge im "Sägezahn"-Schema
      let pos = s.start; const msbFirst = [];
      for (let k = 0; k < s.len; k++) {
        msbFirst.push(pos);
        if (pos % 8 === 0) pos += 15; else pos -= 1;
      }
      for (let k = msbFirst.length - 1; k >= 0; k--) out.push(msbFirst[k]);
    }
    return out;
  };
  SIG.getRaw = function (data, s) {
    const pos = SIG.positions(s);
    let raw = 0;
    for (let k = 0; k < pos.length; k++) {
      const p = pos[k], byte = data[p >> 3] || 0;
      if ((byte >> (p & 7)) & 1) raw += Math.pow(2, k);
    }
    if (s.signed && raw >= Math.pow(2, s.len - 1)) raw -= Math.pow(2, s.len);
    return raw;
  };
  SIG.setRaw = function (data, s, raw) {
    const pos = SIG.positions(s);
    let u = Math.round(raw);
    if (u < 0) u += Math.pow(2, s.len);
    for (let k = 0; k < pos.length; k++) {
      const p = pos[k], bi = p >> 3;
      if (bi >= data.length) continue;
      const bit = Math.floor(u / Math.pow(2, k)) % 2;
      if (bit) data[bi] |= 1 << (p & 7); else data[bi] &= ~(1 << (p & 7)) & 0xff;
    }
  };
  SIG.rawRange = function (s) {
    if (s.signed) return [-Math.pow(2, s.len - 1), Math.pow(2, s.len - 1) - 1];
    return [0, Math.pow(2, s.len) - 1];
  };
  /** Physikalischer Wertebereich, der mit Länge/Faktor/Offset darstellbar ist */
  SIG.physRange = function (s) {
    const [a, b] = SIG.rawRange(s);
    const p = [s.offset + s.factor * a, s.offset + s.factor * b];
    return [Math.min(...p), Math.max(...p)];
  };
  SIG.toPhys = (s, raw) => s.offset + s.factor * raw;
  SIG.toRaw = function (s, phys) {
    const [a, b] = SIG.rawRange(s);
    return CS.clamp(Math.round((phys - s.offset) / (s.factor || 1)), a, b);
  };
  /** Bytes, die ein Signal belegt */
  SIG.bytes = (s) => [...new Set(SIG.positions(s).map((p) => p >> 3))];

  /* ======================================================================
     Knotentypen & Szenarien
     ====================================================================== */
  CS.NODE_TYPES = {
    joystick: { label: 'Joystick', short: 'JOY', desc: 'Bedienelement der Arbeitsmaschine. Sendet Fahranforderungen (X/Y in ‰) und vier Taster.', sources: { x: 'Auslenkung X [‰]', y: 'Auslenkung Y [‰]', b1: 'Taster 1', b2: 'Taster 2', b3: 'Taster 3', b4: 'Taster 4' } },
    angle: { label: 'Winkelsensor', short: 'WS', desc: 'Neigungssensor am Ausleger. Misst Winkel und Winkelgeschwindigkeit, meldet die Endlagen.', sources: { angle: 'Winkel [°]', rate: 'Winkelgeschwindigkeit [°/s]', upper: 'Flag obere Endlage', lower: 'Flag untere Endlage' } },
    ecu: { label: 'Maschinensteuerung', short: 'ECU', desc: 'Steuergerät (SPS/ECU). Empfängt Joystick und Winkelsensor und steuert das Ventil des Hubzylinders.', term: true, sources: {} },
    pc: { label: 'CAN-Interface (PC)', short: 'PC', desc: 'USB-CAN-Interface am Laptop mit Trace-Software (vgl. CAN-Explorer). Hat einen zuschaltbaren 120-Ω-Abschluss und einen „Silent Mode“.', term: true, silent: true, sources: {} },
    imu: { label: 'IMU MM7.10', short: 'IMU', desc: 'Inertialsensor (Drehraten und Beschleunigungen in 3 Achsen) mit J1939-Botschaften, Zähler und CRC.', sources: { yaw: 'Gierrate [°/s]', roll: 'Rollrate [°/s]', pitch: 'Nickrate [°/s]', ax: 'Beschl. X [m/s²]', ay: 'Beschl. Y [m/s²]', az: 'Beschl. Z [m/s²]', temp: 'Temperatur [°C]' } },
    gen: { label: 'Steuergerät', short: 'SG', desc: 'Frei konfigurierbarer CAN-Knoten mit Testsignalen (Sinus, Rampe, Konstante, Zufall).', term: true, multi: true, sources: {} }
  };
  CS.GENERIC_SOURCES = { sine: 'Sinus (Min…Max, 4 s)', ramp: 'Rampe (Min…Max, 10 s)', square: 'Rechteck (1 Hz)', random: 'Zufall', const: 'Konstante' };
  CS.SPECIAL_SOURCES = { counter: 'Botschaftszähler', crc: 'CRC-8 (SAE J1850)' };

  const sg = (name, start, len, factor, offset, unit, src, extra) => Object.assign({ name, start, len, order: 'intel', signed: false, factor, offset, unit: unit || '', src: src || 'const', val: 0 }, extra || {});

  /** Joystick-Botschaft gemäß BoomControl.dbc (vorgegeben) */
  const MSG_JOYSTICK = () => ({
    key: 'joy1', node: 'joy', name: 'Joystick', id: 0x124, ext: false, dlc: 5, cycle: 20, locked: true, hideCycle: true,
    signals: [
      sg('DrvDmd_X', 0, 12, 1, -1000, 'perm', 'x'), sg('Button1', 12, 1, 1, 0, '', 'b1'), sg('Button2', 13, 1, 1, 0, '', 'b2'),
      sg('Button3', 14, 1, 1, 0, '', 'b3'), sg('Button4', 15, 1, 1, 0, '', 'b4'), sg('DrvDmd_Y', 16, 12, 1, -1000, 'perm', 'y'),
      sg('MSG_CNT', 28, 4, 1, 0, '', 'counter'), sg('CRC', 32, 8, 1, 0, '', 'crc')
    ]
  });
  /** Musterlösung Winkelsensor (entspricht BoomControl_Loesung.dbc) */
  CS.MSG_ANGLE_SOLUTION = () => ({
    key: 'ang1', node: 'ang', name: 'Winkelsensor', id: 0x126, ext: false, dlc: 6, cycle: 10, locked: false,
    signals: [
      sg('Winkel', 0, 16, 0.01, -300, 'deg', 'angle'), sg('Winkelgeschwindigkeit', 16, 16, 0.01, -300, 'deg/s', 'rate'),
      sg('flgLowerLim', 36, 1, 1, 0, '', 'lower'), sg('flgUpperLim', 37, 1, 1, 0, '', 'upper'),
      sg('MSG_CNT', 32, 4, 1, 0, '', 'counter'), sg('CRC', 40, 8, 1, 0, '', 'crc')
    ]
  });
  const imuMsg = (key, name, id, sigs) => ({ key, node: 'imu', name, id, ext: true, dlc: 8, cycle: 10, locked: true, signals: sigs });
  const MSG_IMU = () => [
    imuMsg('imu1', 'MM710_J1939_TX1', 0x18ff2331, [
      sg('YAW_RATE', 0, 16, 0.005, -163.84, 'deg/s', 'yaw'), sg('CLU_STAT', 16, 4, 1, 0, '', 'const'), sg('YAW_RATE_STAT', 20, 4, 1, 0, '', 'const'),
      sg('TEMP_RATE_Z', 24, 8, 1, -50, '°C', 'temp'), sg('AY', 32, 16, 0.00125, -40.957, 'm/s^2', 'ay'), sg('MSG_CNT', 48, 4, 1, 0, '', 'counter'),
      sg('AY_STAT', 52, 4, 1, 0, '', 'const'), sg('CRC', 56, 8, 1, 0, '', 'crc')]),
    imuMsg('imu2', 'MM710_J1939_TX2', 0x18ff2431, [
      sg('ROLL_RATE', 0, 16, 0.005, -163.84, 'deg/s', 'roll'), sg('CLU_STAT5', 16, 4, 1, 0, '', 'const'), sg('ROLL_RATE_STAT', 20, 4, 1, 0, '', 'const'),
      sg('CLU_DIAG', 24, 8, 1, 0, '', 'const'), sg('AX', 32, 16, 0.00125, -40.957, 'm/s^2', 'ax'), sg('MSG_CNT', 48, 4, 1, 0, '', 'counter'),
      sg('AX_STAT', 52, 4, 1, 0, '', 'const'), sg('CRC', 56, 8, 1, 0, '', 'crc')]),
    imuMsg('imu3', 'MM710_J1939_TX3', 0x18ff2531, [
      sg('PITCH_RATE', 0, 16, 0.005, -163.84, 'deg/s', 'pitch'), sg('HW_Index', 16, 4, 1, 0, '', 'const', { val: 1 }), sg('PITCH_RATE_STAT', 20, 4, 1, 0, '', 'const'),
      sg('AZ', 32, 16, 0.00125, -40.957, 'm/s^2', 'az'), sg('MSG_CNT', 48, 4, 1, 0, '', 'counter'), sg('AZ_STAT', 52, 4, 1, 0, '', 'const'), sg('CRC', 56, 8, 1, 0, '', 'crc')])
  ];

  CS.SCENARIOS = {
    boom: {
      name: 'Hubwerk – Teilautomation (Übung 2.2)',
      desc: 'Joystick, Winkelsensor und Maschinensteuerung einer mobilen Arbeitsmaschine kommunizieren über High-Speed-CAN. Ein CAN-Interface am PC zeichnet den Verkehr auf.',
      nodes: ['joy', 'ang', 'ecu', 'pc'],
      nodeTypes: { joy: 'joystick', ang: 'angle', ecu: 'ecu', pc: 'pc' },
      baud: 500000, busLength: 12,
      messages: () => [MSG_JOYSTICK()],
      dbcs: ['BoomControl.dbc', 'BoomControl_Loesung.dbc'],
      task: 'angle'
    },
    imu: {
      name: 'Inertialsensor MM7.10 (Übung 2.1)',
      desc: 'Ein Inertialsensor sendet Drehraten, Beschleunigungen und Temperatur als J1939-Botschaften (Extended Identifier) mit Zähler und CRC. Der Sensor liegt in Ruhe – die Drehraten zeigen Offsets.',
      nodes: ['imu', 'ecu', 'pc'],
      nodeTypes: { imu: 'imu', ecu: 'ecu', pc: 'pc' },
      baud: 250000, busLength: 20,
      messages: MSG_IMU,
      dbcs: ['MM710_Rexroth.dbc']
    },
    free: {
      name: 'Freies Netzwerk',
      desc: 'Eigenes Netzwerk mit beliebigen Steuergeräten und Botschaften aufbauen. Alle Knotentypen stehen zur Verfügung.',
      nodes: [], nodeTypes: {}, free: true,
      baud: 500000, busLength: 20,
      messages: () => [],
      dbcs: ['BoomControl_Loesung.dbc', 'MM710_Rexroth.dbc', 'J1939_Auszug.dbc']
    }
  };

  /* ======================================================================
     Anwendungszustand (wird im Browser gespeichert)
     ====================================================================== */
  const KEY = 'cansim-state-v1';
  CS.newState = function (scn) {
    const S = CS.SCENARIOS[scn] || CS.SCENARIOS.boom;
    return {
      scenario: scn,
      net: { baud: S.baud, busLength: S.busLength, samplePoint: 0.875, nodes: [], res: [] },
      messages: S.messages(),
      settings: { auto: false }
    };
  };
  CS.state = null;
  CS.load = function () {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.scenario && s.net && s.messages) { CS.state = s; return; }
    } catch (e) { /* ignorieren */ }
    CS.state = CS.newState('boom');
  };
  let saveT = 0;
  CS.save = function () {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(CS.state)); } catch (e) { /* ignorieren */ } }, 300);
  };
  /** Zustand geändert: speichern und Ansichten informieren */
  CS.changed = function (what) { CS.save(); CS.emit('changed', what || 'all'); };

  CS.nodeById = (id) => CS.state.net.nodes.find((n) => n.id === id);
  CS.nodeLabel = function (id) {
    const n = CS.nodeById(id);
    if (n) return n.name;
    const scn = CS.SCENARIOS[CS.state.scenario];
    const t = scn.nodeTypes[id];
    return t ? CS.NODE_TYPES[t].label : id;
  };
  CS.nodeType = function (id) {
    const n = CS.nodeById(id);
    if (n) return n.type;
    return CS.SCENARIOS[CS.state.scenario].nodeTypes[id] || 'gen';
  };
  /** Mögliche Sender (für Botschaften): Szenario-Knoten + im Netz platzierte Knoten */
  CS.senderList = function () {
    const scn = CS.SCENARIOS[CS.state.scenario];
    const ids = new Set(scn.nodes.filter((id) => !['ecu', 'pc'].includes(id) || true));
    CS.state.net.nodes.forEach((n) => ids.add(n.id));
    return [...ids].filter((id) => CS.nodeType(id) !== 'pc');
  };
  CS.sourcesFor = function (nodeId) {
    const t = CS.NODE_TYPES[CS.nodeType(nodeId)];
    return Object.assign({}, t && t.sources, CS.GENERIC_SOURCES, CS.SPECIAL_SOURCES);
  };
})();
