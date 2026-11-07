/* ==========================================================================
   CANsim – Zeitverläufe auf Canvas (mehrere Teilfenster, Fadenkreuz, Legende)
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;

  function niceStep(range, n) {
    const raw = range / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  /**
   * Plot-Objekt. draw(spec) mit spec = { t0, t1, panels:[{ title, series:[{name, unit, color, t, v, step}] }] }
   * Die Reihen enthalten Zeit- und Wertarrays (gleich lang).
   */
  CS.Plot = function (canvas, opts) {
    opts = opts || {};
    const self = { spec: null, hoverX: null };
    const tip = CS.h('div', { class: 'tooltip', hidden: true });
    document.body.append(tip);
    const PAD = { l: 58, r: 14, t: 22, b: 24 };

    function layout(h, n) {
      const gap = 10, avail = h - PAD.b - (n - 1) * gap;
      const ph = avail / n;
      return Array.from({ length: n }, (_, i) => ({ y: i * (ph + gap), h: ph }));
    }

    self.draw = function (spec) {
      self.spec = spec;
      const { ctx, w, h } = CS.fitCanvas(canvas);
      ctx.clearRect(0, 0, w, h);
      const panels = spec.panels || [];
      if (!panels.length) return;
      const rows = layout(h, panels.length);
      const t0 = spec.t0, t1 = spec.t1;
      const X = (t) => PAD.l + ((t - t0) / (t1 - t0)) * (w - PAD.l - PAD.r);
      self._geo = { rows, X, t0, t1, w, h };
      const cGrid = CS.css('--grid'), cAxis = CS.css('--axis'), cMuted = CS.css('--muted'), cInk = CS.css('--ink-2'), cSurf = CS.css('--surface');
      ctx.font = '11px ' + CS.css('--font');
      panels.forEach((pn, pi) => {
        const r = rows[pi], top = r.y + PAD.t, bot = r.y + r.h, ph = bot - top;
        // y-Bereich aus sichtbaren Daten
        let lo = Infinity, hi = -Infinity;
        for (const s of pn.series) for (let i = 0; i < s.t.length; i++) if (s.t[i] >= t0 - 1 && s.t[i] <= t1) { const v = s.v[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        if (pn.yMin != null) lo = Math.min(lo, pn.yMin);
        if (pn.yMax != null) hi = Math.max(hi, pn.yMax);
        if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
        const m = (hi - lo) * 0.08; lo -= m; hi += m;
        const Y = (v) => bot - ((v - lo) / (hi - lo)) * ph;
        r.Y = Y; r.lo = lo; r.hi = hi; r.top = top; r.bot = bot;
        // Raster
        ctx.fillStyle = cSurf; ctx.fillRect(PAD.l, top, w - PAD.l - PAD.r, ph);
        ctx.strokeStyle = cGrid; ctx.lineWidth = 1; ctx.fillStyle = cMuted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const ys = niceStep(hi - lo, Math.max(2, Math.floor(ph / 32)));
        for (let v = Math.ceil(lo / ys) * ys; v <= hi; v += ys) {
          const y = Math.round(Y(v)) + 0.5;
          ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
          ctx.fillText(CS.fmt(+v.toPrecision(6)), PAD.l - 6, y);
        }
        const xs = niceStep(t1 - t0, Math.max(2, Math.floor((w - PAD.l) / 90)));
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let t = Math.ceil(t0 / xs) * xs; t <= t1; t += xs) {
          const x = Math.round(X(t)) + 0.5;
          ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
          if (pi === panels.length - 1) ctx.fillText(CS.fmt(+t.toPrecision(6)) + ' s', x, bot + 5);
        }
        ctx.strokeStyle = cAxis; ctx.strokeRect(PAD.l + 0.5, top + 0.5, w - PAD.l - PAD.r - 1, ph - 1);
        // Titel / Legende
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        let lx = PAD.l;
        if (!pn.series.length) { ctx.fillStyle = cMuted; ctx.fillText(pn.empty || 'Kein Signal zugeordnet', lx + 4, top - 6); }
        for (const s of pn.series) {
          ctx.fillStyle = s.color; ctx.fillRect(lx, top - 12, 14, 3);
          ctx.fillStyle = cInk;
          const lab = s.name + (s.unit ? ' [' + s.unit + ']' : '');
          ctx.fillText(lab, lx + 18, top - 7);
          lx += ctx.measureText(lab).width + 34;
        }
        // Kurven
        ctx.save();
        ctx.beginPath(); ctx.rect(PAD.l, top, w - PAD.l - PAD.r, ph); ctx.clip();
        ctx.lineWidth = 2; ctx.lineJoin = 'round';
        for (const s of pn.series) {
          ctx.strokeStyle = s.color; ctx.beginPath();
          let started = false, py = 0;
          let i0 = 0;
          while (i0 < s.t.length && s.t[i0] < t0) i0++;
          if (i0 > 0) i0--;
          for (let i = i0; i < s.t.length; i++) {
            const x = X(s.t[i]), y = Y(s.v[i]);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else if (s.step) { ctx.lineTo(x, py); ctx.lineTo(x, y); }
            else ctx.lineTo(x, y);
            py = y;
          }
          if (s.step && started && s.t.length) ctx.lineTo(X(Math.min(t1, spec.tNow != null ? spec.tNow : t1)), py);
          ctx.stroke();
        }
        ctx.restore();
      });
      // Fadenkreuz
      if (self.hoverX != null && self.hoverX > PAD.l && self.hoverX < w - PAD.r) {
        ctx.strokeStyle = CS.css('--muted'); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(self.hoverX + 0.5, 0); ctx.lineTo(self.hoverX + 0.5, h - PAD.b); ctx.stroke(); ctx.setLineDash([]);
        const t = t0 + ((self.hoverX - PAD.l) / (w - PAD.l - PAD.r)) * (t1 - t0);
        const lines = ['t = ' + CS.fmtFix(t, 3) + ' s'];
        panels.forEach((pn, pi) => {
          for (const s of pn.series) {
            let k = -1;
            for (let i = s.t.length - 1; i >= 0; i--) if (s.t[i] <= t) { k = i; break; }
            if (k < 0) continue;
            ctx.fillStyle = s.color; ctx.strokeStyle = CS.css('--surface'); ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(self.hoverX, rows[pi].Y(s.v[k]), 4, 0, 7); ctx.fill(); ctx.stroke();
            lines.push(s.name + ': ' + CS.fmt(s.v[k]) + (s.unit ? ' ' + s.unit : ''));
          }
        });
        self._tip = lines.join('\n');
      } else self._tip = null;
    };

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      self.hoverX = e.clientX - r.left;
      if (self.spec) self.draw(self.spec);
      if (self._tip) {
        tip.hidden = false; tip.textContent = self._tip;
        const tw = tip.offsetWidth;
        tip.style.left = (e.clientX + 14 + tw > innerWidth ? e.clientX - tw - 14 : e.clientX + 14) + 'px';
        tip.style.top = e.clientY + 12 + 'px';
      } else tip.hidden = true;
    });
    canvas.addEventListener('mouseleave', () => { self.hoverX = null; tip.hidden = true; if (self.spec) self.draw(self.spec); });
    return self;
  };
})();
