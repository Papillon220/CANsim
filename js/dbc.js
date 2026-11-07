/* ==========================================================================
   CANsim – CAN-Datenbank (DBC): Einlesen, Erzeugen, eingebettete Beispiele
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const DBC = (CS.dbc = {});

  const HEAD = 'VERSION ""\n\n\nNS_ : \n\tNS_DESC_\n\tCM_\n\tBA_DEF_\n\tBA_\n\tVAL_\n\tCAT_DEF_\n\tCAT_\n\tFILTER\n\tBA_DEF_DEF_\n\tEV_DATA_\n\tENVVAR_DATA_\n\tSGTYPE_\n\tSGTYPE_VAL_\n\tBA_DEF_SGTYPE_\n\tBA_SGTYPE_\n\tSIG_TYPE_REF_\n\tVAL_TABLE_\n\tSIG_GROUP_\n\tSIG_VALTYPE_\n\tSIGTYPE_VALTYPE_\n\tBO_TX_BU_\n\tBA_DEF_REL_\n\tBA_REL_\n\tBA_DEF_DEF_REL_\n\tBU_SG_REL_\n\tBU_EV_REL_\n\tBU_BO_REL_\n\tSG_MUL_VAL_\n\nBS_:\n\n';
  const TAIL_ATTR = 'BA_DEF_  "MultiplexExtEnabled" ENUM  "No","Yes";\nBA_DEF_  "BusType" STRING ;\nBA_DEF_DEF_  "MultiplexExtEnabled" "No";\nBA_DEF_DEF_  "BusType" "CAN";\n';

  /** Eingebettete Datenbanken (aus den Übungsunterlagen; J1939-Auszug mit EEC1 für die Vorlesungsbeispiele) */
  DBC.BUILTIN = {
    'BoomControl.dbc': HEAD + 'BU_:\n\n\nBO_ 292 Joystick: 5 Vector__XXX\n SG_ MSG_CNT : 28|4@1+ (1,0) [0|15] "" Vector__XXX\n SG_ CRC : 32|8@1+ (1,0) [0|255] "" Vector__XXX\n SG_ Button4 : 15|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ Button3 : 14|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ Button2 : 13|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ Button1 : 12|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ DrvDmd_Y : 16|12@1+ (1,-1000) [-1000|3095] "perm" Vector__XXX\n SG_ DrvDmd_X : 0|12@1+ (1,-1000) [-1000|3095] "perm" Vector__XXX\n\n\n\nCM_ SG_ 292 CRC "CRC according to SAE J1850.";\n' + TAIL_ATTR,
    'BoomControl_Loesung.dbc': HEAD + 'BU_:\n\n\nBO_ 294 Winkelsensor: 6 Vector__XXX\n SG_ MSG_CNT : 32|4@1+ (1,0) [0|15] "" Vector__XXX\n SG_ CRC : 40|8@1+ (1,0) [0|255] "" Vector__XXX\n SG_ flgUpperLim : 37|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ flgLowerLim : 36|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ Winkelgeschwindigkeit : 16|16@1+ (0.01,-300) [-300|355.35] "deg/s" Vector__XXX\n SG_ Winkel : 0|16@1+ (0.01,-300) [-300|355.35] "deg" Vector__XXX\n\nBO_ 292 Joystick: 5 Vector__XXX\n SG_ MSG_CNT : 28|4@1+ (1,0) [0|15] "" Vector__XXX\n SG_ CRC : 32|8@1+ (1,0) [0|255] "" Vector__XXX\n SG_ Button4 : 15|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ Button3 : 14|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ Button2 : 13|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ Button1 : 12|1@1+ (1,0) [0|1] "" Vector__XXX\n SG_ DrvDmd_Y : 16|12@1+ (1,-1000) [-1000|3095] "perm" Vector__XXX\n SG_ DrvDmd_X : 0|12@1+ (1,-1000) [-1000|3095] "perm" Vector__XXX\n\n\n\nCM_ SG_ 294 CRC "CRC according to SAE J1850.";\nCM_ SG_ 292 CRC "CRC according to SAE J1850.";\n' + TAIL_ATTR,
    'MM710_Rexroth.dbc': HEAD + 'BU_:\n\n\n' +
      'BO_ 2566858032 MM710_J1939_TX3: 8 Vector__XXX\n SG_ HW_Index : 16|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ PITCH_RATE_STAT : 20|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ PITCH_RATE : 0|16@1+ (0.005,-163.84) [-163.84|163.83] "deg/s" Vector__XXX\n SG_ MSG_CNT : 48|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CRC : 56|8@1+ (1,0) [0|0] "" Vector__XXX\n SG_ AZ_STAT : 52|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ AZ : 32|16@1+ (0.00125,-40.957) [-40.957|40.958] "m/s^2" Vector__XXX\n\n' +
      'BO_ 2566857776 MM710_J1939_TX2: 8 Vector__XXX\n SG_ AX : 32|16@1+ (0.00125,-40.957) [-40.957|40.958] "m/s^2" Vector__XXX\n SG_ MSG_CNT : 48|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CRC : 56|8@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CLU_STAT5 : 16|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CLU_DIAG : 24|8@1+ (1,0) [0|0] "" Vector__XXX\n SG_ ROLL_RATE_STAT : 20|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ AX_STAT : 52|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ ROLL_RATE : 0|16@1+ (0.005,-163.84) [-163.84|163.83] "deg/s" Vector__XXX\n\n' +
      'BO_ 2566857520 MM710_J1939_TX1: 8 Vector__XXX\n SG_ TEMP_RATE_Z : 24|8@1+ (1,-50) [-50|150] "°C" Vector__XXX\n SG_ MSG_CNT : 48|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CRC : 56|8@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CLU_STAT : 16|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ YAW_RATE_STAT : 20|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ AY_STAT : 52|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ YAW_RATE : 0|16@1+ (0.005,-163.84) [-163.84|163.83] "deg/s" Vector__XXX\n SG_ AY : 32|16@1+ (0.00125,-40.957) [-40.957|40.958] "m/s^2" Vector__XXX\n\n' +
      'BO_ 380 MM710_TX3: 8 Vector__XXX\n SG_ HW_Index : 16|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ PITCH_RATE_STAT : 20|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ PITCH_RATE : 0|16@1+ (0.005,-163.84) [-163.84|163.83] "deg/s" Vector__XXX\n SG_ MSG_CNT : 48|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CRC : 56|8@1+ (1,0) [0|0] "" Vector__XXX\n SG_ AZ_STAT : 52|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ AZ : 32|16@1+ (0.00125,-40.957) [-40.957|40.958] "m/s^2" Vector__XXX\n\n' +
      'BO_ 376 MM710_TX2: 8 Vector__XXX\n SG_ AX : 32|16@1+ (0.00125,-40.957) [-40.957|40.958] "m/s^2" Vector__XXX\n SG_ MSG_CNT : 48|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CRC : 56|8@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CLU_STAT5 : 16|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CLU_DIAG : 24|8@1+ (1,0) [0|0] "" Vector__XXX\n SG_ ROLL_RATE_STAT : 20|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ AX_STAT : 52|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ ROLL_RATE : 0|16@1+ (0.005,-163.84) [-163.84|163.83] "deg/s" Vector__XXX\n\n' +
      'BO_ 372 MM710_TX1: 8 Vector__XXX\n SG_ TEMP_RATE_Z : 24|8@1+ (1,-50) [-50|150] "°C" Vector__XXX\n SG_ MSG_CNT : 48|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CRC : 56|8@1+ (1,0) [0|0] "" Vector__XXX\n SG_ CLU_STAT : 16|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ YAW_RATE_STAT : 20|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ AY_STAT : 52|4@1+ (1,0) [0|0] "" Vector__XXX\n SG_ YAW_RATE : 0|16@1+ (0.005,-163.84) [-163.84|163.83] "deg/s" Vector__XXX\n SG_ AY : 32|16@1+ (0.00125,-40.957) [-40.957|40.958] "m/s^2" Vector__XXX\n\n\n\n' +
      'CM_ SG_ 2566857520 CRC "CRC-8 SAE J1850 über Byte 0-6.";\n' + TAIL_ATTR,
    'J1939_Auszug.dbc': HEAD + 'BU_: Engine\n\n\nBO_ 2364539905 EEC1: 8 Engine\n SG_ EngTorqueMode : 0|4@1+ (1,0) [0|15] "" Vector__XXX\n SG_ DriversDemandEngPercentTorque : 8|8@1+ (1,-125) [-125|125] "%" Vector__XXX\n SG_ ActualEnginePercentTorque : 16|8@1+ (1,-125) [-125|125] "%" Vector__XXX\n SG_ EngSpeed : 24|16@1+ (0.125,0) [0|8031.875] "rpm" Vector__XXX\n SG_ SrcAddrssOfCtrllngDvcForEngCtrl : 40|8@1+ (1,0) [0|255] "" Vector__XXX\n SG_ EngStarterMode : 48|4@1+ (1,0) [0|15] "" Vector__XXX\n SG_ EngDemandPercentTorque : 56|8@1+ (1,-125) [-125|125] "%" Vector__XXX\n\n\n\nCM_ BO_ 2364539905 "Electronic Engine Controller 1 (PGN 61444 = 0xF004)";\nCM_ SG_ 2364539905 EngSpeed "SPN 190 - Engine Speed";\nBA_ "GenMsgCycleTime" BO_ 2364539905 10;\n' + TAIL_ATTR
  };

  const num = (s) => Number(String(s).trim());

  /** DBC-Text einlesen → {messages:[…], byKey:Map} */
  DBC.parse = function (text, fileName) {
    const db = { name: fileName || 'Datenbank', messages: [], byKey: new Map(), nodes: [], warnings: [] };
    const byRawId = new Map();
    let cur = null;
    const lines = String(text).replace(/\r/g, '').split('\n');
    for (let ln = 0; ln < lines.length; ln++) {
      const line = lines[ln];
      let m;
      if ((m = line.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/))) {
        const raw = Number(m[1]);
        if (m[2] === 'VECTOR__INDEPENDENT_SIG_MSG') { cur = null; continue; }
        const ext = raw >= 0x80000000;
        cur = { id: ext ? raw - 0x80000000 : raw, ext, name: m[2], dlc: Number(m[3]), sender: m[4], cycle: null, comment: '', signals: [] };
        db.messages.push(cur);
        byRawId.set(raw, cur);
      } else if ((m = line.match(/^\s+SG_\s+(\w+)\s*(M|m\d+)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(\s*([^,]+),\s*([^)]+)\)\s*\[\s*([^|]*)\|([^\]]*)\]\s*"([^"]*)"/))) {
        if (!cur) continue;
        cur.signals.push({
          name: m[1], mux: m[2] || null, start: Number(m[3]), len: Number(m[4]), order: m[5] === '0' ? 'motorola' : 'intel', signed: m[6] === '-',
          factor: num(m[7]), offset: num(m[8]), min: num(m[9]), max: num(m[10]), unit: m[11], comment: '', values: null
        });
      } else if (/^BU_\s*:/.test(line)) {
        db.nodes = line.replace(/^BU_\s*:/, '').trim().split(/\s+/).filter(Boolean);
      } else if ((m = line.match(/^CM_\s+(SG_|BO_)\s+(\d+)\s+(\w+)?\s*"((?:[^"\\]|\\.)*)/))) {
        // Kommentar ggf. über mehrere Zeilen
        let txt = m[4], full = line;
        while (!/";\s*$/.test(full) && ln + 1 < lines.length) { full = lines[++ln]; txt += '\n' + full.replace(/";\s*$/, ''); }
        txt = txt.replace(/";\s*$/, '');
        const msg = byRawId.get(Number(m[2]));
        if (!msg) continue;
        if (m[1] === 'BO_') msg.comment = (m[3] ? m[3] + ' ' : '') + txt;
        else { const s = msg.signals.find((x) => x.name === m[3]); if (s) s.comment = txt; }
      } else if ((m = line.match(/^BA_\s+"GenMsgCycleTime"\s+BO_\s+(\d+)\s+(\d+)/))) {
        const msg = byRawId.get(Number(m[1])); if (msg) msg.cycle = Number(m[2]);
      } else if ((m = line.match(/^VAL_\s+(\d+)\s+(\w+)\s+(.*);/))) {
        const msg = byRawId.get(Number(m[1])); if (!msg) continue;
        const s = msg.signals.find((x) => x.name === m[2]); if (!s) continue;
        s.values = {};
        const re = /(-?\d+)\s+"([^"]*)"/g; let v;
        while ((v = re.exec(m[3]))) s.values[v[1]] = v[2];
      }
    }
    for (const msg of db.messages) {
      db.byKey.set(DBC.key(msg.id, msg.ext), msg);
      for (const s of msg.signals) {
        s.isCrc = /^crc/i.test(s.name) || /crc/i.test(s.comment);
        s.isCnt = /(msg_?cnt|counter|zaehler|zähler|alive)/i.test(s.name);
      }
    }
    if (!db.messages.length) db.warnings.push('Keine Botschaften (BO_) gefunden.');
    return db;
  };
  DBC.key = (id, ext) => (ext ? 'x' : 's') + id;
  /** J1939-PGN eines 29-bit-Identifiers (PDU1: ohne Zieladresse) */
  DBC.pgn = function (id) { const pf = (id >>> 16) & 0xff; return (id >>> 8) & (pf < 240 ? 0x3ff00 : 0x3ffff); };
  /** Botschaft zu einer ID finden: exakt oder – bei 29-bit-IDs – über die J1939-PGN (Priorität/Source Address egal) */
  DBC.find = function (db, id, ext) {
    if (!db) return null;
    const m = db.byKey.get(DBC.key(id, ext));
    if (m || !ext) return m || null;
    const k = 'p' + DBC.pgn(id);
    if (!db._pgn) { db._pgn = new Map(); for (const x of db.messages) if (x.ext && !db._pgn.has('p' + DBC.pgn(x.id))) db._pgn.set('p' + DBC.pgn(x.id), x); }
    return db._pgn.get(k) || null;
  };

  /** Botschaft dekodieren → [{sig, raw, phys, text}] */
  DBC.decode = function (msg, data) {
    return msg.signals.map((s) => {
      const raw = CS.sig.getRaw(data, s);
      const phys = CS.sig.toPhys(s, raw);
      const text = s.values && s.values[raw] != null ? s.values[raw] : null;
      return { sig: s, raw, phys, text };
    });
  };

  const fmtN = (v) => String(+Number(v).toPrecision(12));
  /** DBC-Text aus der eigenen Botschaftskonfiguration erzeugen */
  DBC.fromConfig = function (messages, nodeName) {
    const nodes = [...new Set(messages.map((m) => nodeName(m.node).replace(/\W+/g, '_')))];
    let t = HEAD + 'BU_: ' + nodes.join(' ') + '\n\n\n';
    const cms = [], bas = [];
    for (const m of messages) {
      const raw = m.ext ? m.id + 0x80000000 : m.id;
      t += `BO_ ${raw} ${m.name.replace(/\W+/g, '_')}: ${m.dlc} ${nodeName(m.node).replace(/\W+/g, '_')}\n`;
      for (const s of m.signals) {
        const [a, b] = CS.sig.physRange(s);
        t += ` SG_ ${s.name.replace(/\W+/g, '_')} : ${s.start}|${s.len}@${s.order === 'motorola' ? 0 : 1}${s.signed ? '-' : '+'} (${fmtN(s.factor)},${fmtN(s.offset)}) [${fmtN(a)}|${fmtN(b)}] "${s.unit || ''}" Vector__XXX\n`;
        if (s.src === 'crc') cms.push(`CM_ SG_ ${raw} ${s.name.replace(/\W+/g, '_')} "CRC according to SAE J1850.";`);
        if (s.src === 'counter') cms.push(`CM_ SG_ ${raw} ${s.name.replace(/\W+/g, '_')} "Message counter.";`);
      }
      t += '\n';
      if (m.cycle) bas.push(`BA_ "GenMsgCycleTime" BO_ ${raw} ${m.cycle};`);
    }
    t += '\n\n' + cms.join('\n') + (cms.length ? '\n' : '');
    t += TAIL_ATTR.replace('BA_DEF_DEF_  "BusType" "CAN";\n', 'BA_DEF_DEF_  "BusType" "CAN";\n') + 'BA_DEF_ BO_  "GenMsgCycleTime" INT 0 65535;\nBA_DEF_DEF_  "GenMsgCycleTime" 0;\n' + bas.join('\n') + '\n';
    return t;
  };

  /** Datei herunterladen */
  CS.download = function (name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
})();
