// 画布绘图助手（UI/HUD/FX 共用）。加载时不碰 DOM；所有函数都接收 ctx。
(function (G) {
  'use strict';
  G.FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif';
  G.MIN_FONT = 14;

  // UI 语义色（取自 ENDESGA-32，见 ARCH.md §10）
  G.COL = {
    bg: '#181425', bg2: '#262b44', panel: '#262b44', panelDark: '#181425', edge: '#3a4466', edgeHi: '#5a6988',
    text: '#ffffff', dim: '#8b9bb4', faint: '#5a6988', gold: '#feae34', crystal: '#b55088', crystalHi: '#2ce8f5',
    hp: '#e43b44', hpDark: '#a22633', shield: '#c0cbdc', armor: '#ead4aa', energy: '#0099db', energyHi: '#2ce8f5',
    danger: '#ff0044', warn: '#f77622', ok: '#63c74d', sel: '#feae34', key: '#fee761'
  };
  G.RARITY = [
    null,
    { name: '普通', color: '#c0cbdc' },
    { name: '优秀', color: '#63c74d' },
    { name: '稀有', color: '#0099db' },
    { name: '史诗', color: '#b55088' },
    { name: '传说', color: '#feae34' }
  ];
  G.rarityColor = (r) => (G.RARITY[r] || G.RARITY[1]).color;
  G.rarityName = (r) => (G.RARITY[r] || G.RARITY[1]).name;

  const fontStr = (size, bold) => (bold ? 'bold ' : '') + size + 'px ' + G.FONT;

  G.gfx = {
    font: fontStr,
    // 文字：align 'left'|'center'|'right'；base 默认 'middle'；o.shadow=true 画 1px 暗色投影；o.alpha
    txt(ctx, s, x, y, size, color, align, bold, o) {
      s = String(s);
      ctx.font = fontStr(size, bold);
      ctx.textAlign = align || 'left';
      ctx.textBaseline = (o && o.base) || 'middle';
      if (o && o.shadow) { ctx.fillStyle = 'rgba(24,20,37,0.85)'; ctx.fillText(s, x + 1, y + 1); }
      ctx.fillStyle = color || G.COL.text;
      ctx.fillText(s, x, y);
    },
    measure(ctx, s, size, bold) { ctx.font = fontStr(size, bold); return ctx.measureText(String(s)).width; },
    // 自动换行（逐字），返回实际行数；o.maxLines 截断并加省略号
    wrapLines(ctx, s, w, size, bold) {
      ctx.font = fontStr(size, bold);
      const lines = []; let line = '';
      for (const ch of String(s)) {
        if (ch === '\n') { lines.push(line); line = ''; continue; }
        if (line && ctx.measureText(line + ch).width > w) { lines.push(line); line = ch.trim() ? ch : ''; }
        else line += ch;
      }
      if (line) lines.push(line);
      return lines;
    },
    wrap(ctx, s, x, y, w, size, color, align, o) {
      o = o || {};
      let lines = G.gfx.wrapLines(ctx, s, w, size, o.bold);
      if (o.maxLines && lines.length > o.maxLines) { lines = lines.slice(0, o.maxLines); lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…'; }
      const lh = o.lineH || Math.round(size * 1.4);
      lines.forEach((ln, i) => G.gfx.txt(ctx, ln, x, y + i * lh, size, color, align, o.bold, o));
      return lines.length;
    },
    rrect(ctx, x, y, w, h, r, fill, stroke, lw) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
    },
    // 像素风面板：暗底 + 2px 边框 + 顶部高光线
    panel(ctx, x, y, w, h, o) {
      o = o || {};
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
      ctx.fillStyle = o.shadow === false ? 'rgba(0,0,0,0)' : 'rgba(10,8,20,0.55)'; ctx.fillRect(x + 3, y + 3, w, h);
      ctx.fillStyle = o.fill || 'rgba(24,20,37,0.92)'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = o.edge || G.COL.edge;
      ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x, y, 2, h); ctx.fillRect(x + w - 2, y, 2, h);
      if (o.hi !== false) { ctx.fillStyle = o.hiColor || 'rgba(255,255,255,0.07)'; ctx.fillRect(x + 2, y + 2, w - 4, 2); }
      if (o.sel) { ctx.fillStyle = o.selColor || G.COL.sel; ctx.fillRect(x - 2, y - 2, w + 4, 2); ctx.fillRect(x - 2, y + h, w + 4, 2); ctx.fillRect(x - 2, y - 2, 2, h + 4); ctx.fillRect(x + w, y - 2, 2, h + 4); }
    },
    bar(ctx, x, y, w, h, frac, fg, bg, edge) {
      frac = G.clamp(isFinite(frac) ? frac : 0, 0, 1);
      ctx.fillStyle = bg || 'rgba(0,0,0,0.5)'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = fg || G.COL.hp; ctx.fillRect(x, y, Math.round(w * frac), h);
      if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
    },
    // 按键徽标，如 [E]；返回宽度
    keycap(ctx, label, x, y, size, color) {
      size = size || 14;
      const w = Math.max(size + 8, G.gfx.measure(ctx, label, size, true) + 10), h = size + 8;
      G.gfx.rrect(ctx, x, y - h / 2, w, h, 3, 'rgba(255,255,255,0.10)', color || G.COL.key, 1.5);
      G.gfx.txt(ctx, label, x + w / 2, y + 1, size, color || G.COL.key, 'center', true);
      return w;
    },
    circle(ctx, x, y, r, fill, stroke, lw) {
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
    },
    // 截断到宽度（加省略号）
    fit(ctx, s, w, size, bold) {
      s = String(s); ctx.font = fontStr(size, bold);
      if (ctx.measureText(s).width <= w) return s;
      while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
      return s + '…';
    }
  };
})(window.Game = window.Game || {});
