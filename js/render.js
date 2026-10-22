// render.js — 世界渲染（房间局部坐标；main.js 已 translate）（render 助手 a06）
// 地砖/墙(顶面+立面)/门/道具/拾取物/危险区/延迟打击/预警/敌人/玩家/手持武器/子弹/光束/挥砍。只读 S。
(function (G) {
  'use strict';
  const TAU = Math.PI * 2;
  let ctx = null, S = null;

  // ---------- 小工具 ----------
  const snap = (v) => Math.round(v / 2) * 2;
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  function mkCanvas(w, h) {
    try {
      if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
    } catch (e) { /* */ }
    return null;
  }
  function hash(a, b, c) { let h = (a * 374761393 + b * 668265263 + (c | 0) * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  const SP = () => G.Sprites;
  const fcache = {};
  function hasF(name, f) {
    const k = name + '|' + f;
    let v = fcache[k];
    if (v === undefined) {
      try { const sp = SP(); v = !!(sp && sp.get && sp.get(name, f)); } catch (e) { v = false; }
      fcache[k] = v;
    }
    return v;
  }
  const scache = {};
  function sizeOf(name) {
    let v = scache[name];
    if (!v) {
      try { const sp = SP(); v = sp && sp.size ? sp.size(name) : null; } catch (e) { v = null; }
      if (!v) v = [16, 16];
      scache[name] = v;
    }
    return v;
  }
  function spr(name, frame, x, y, o) {
    const sp = SP();
    if (sp && sp.draw) { sp.draw(ctx, name, frame, snap(x), snap(y), o || {}); return; }
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(snap(x) - 8, snap(y) - 8, 16, 16);
  }
  function circ(x, y, r, fill, stroke, lw) {
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function shadow(x, y, w, a) {
    ctx.globalAlpha = a === undefined ? 0.35 : a; ctx.fillStyle = '#181425';
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(1, w), Math.max(1, w * 0.4), 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }
  function txt(s, x, y, size, color) {
    if (G.gfx && G.gfx.txt) G.gfx.txt(ctx, s, x, y, size, color, 'center', true, { shadow: true });
    else { ctx.font = 'bold ' + size + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(s, x, y); }
  }

  // ---------- 主题兜底色 ----------
  const THEME = {
    moss: { f: ['#193c3e', '#1d4345'], top: '#5a6988', face: '#3a4466', faceHi: '#8b9bb4', block: '#3e8948', line: '#265c42' },
    lava: { f: ['#3e2731', '#46303a'], top: '#733e39', face: '#3e2731', faceHi: '#b86f50', block: '#be4a2f', line: '#5a2f30' },
    abyss: { f: ['#181425', '#1f1a30'], top: '#3a4466', face: '#262b44', faceHi: '#68386c', block: '#68386c', line: '#262b44' }
  };
  function themeOf() { return (S.fdef && S.fdef.theme) || 'moss'; }

  // ---------- 房间静态层缓存（地面+墙+障碍块） ----------
  const roomCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function tileAt(room, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= G.COLS || ty >= G.ROWS) return 1;
    return room.tiles[ty * G.COLS + tx];
  }
  function drawTileSet(c, room, theme) {
    const T = G.T, th = THEME[theme] || THEME.moss, sp = SP();
    const useSp = !!(sp && sp.draw && hasF('tile_' + theme + '_floor', '0'));
    const fl = 'tile_' + theme + '_floor', wl = 'tile_' + theme + '_wall', wf = 'tile_' + theme + '_wallface', bl = 'tile_' + theme + '_block';
    const hasFace = useSp && hasF(wf, '0'), hasBlock = useSp && hasF(bl, '0'), hasWall = useSp && hasF(wl, '0');
    const sx = room.gx | 0, sy = room.gy | 0;
    for (let ty = 0; ty < G.ROWS; ty++) for (let tx = 0; tx < G.COLS; tx++) {
      const t = tileAt(room, tx, ty), x = tx * T, y = ty * T, cx = x + T / 2, cy = y + T / 2;
      if (t !== 1) {
        // 地面（变体按格子哈希）
        const h = hash(tx + sx * 31, ty + sy * 17, 7);
        const v = h < 0.62 ? 0 : h < 0.75 ? 1 : h < 0.88 ? 2 : 3;
        if (useSp) sp.draw(c, fl, v, cx, cy, { anchor: 'center' });
        else { c.fillStyle = th.f[(tx + ty) & 1]; c.fillRect(x, y, T, T); }
        // 墙投下的阴影（3/4 俯视：上方墙在地面上投影）
        if (tileAt(room, tx, ty - 1) === 1) { c.fillStyle = 'rgba(24,20,37,0.45)'; c.fillRect(x, y, T, 8); c.fillStyle = 'rgba(24,20,37,0.2)'; c.fillRect(x, y + 8, T, 6); }
        if (tileAt(room, tx - 1, ty) === 1) { c.fillStyle = 'rgba(24,20,37,0.25)'; c.fillRect(x, y, 6, T); }
        if (t === 2) {
          if (hasBlock) sp.draw(c, bl, 0, cx, cy, { anchor: 'center' });
          else { c.fillStyle = th.face; c.fillRect(x + 2, y + 6, T - 4, T - 6); c.fillStyle = th.block; c.fillRect(x + 2, y + 2, T - 4, T - 16); }
        }
        if (t === 2 && tileAt(room, tx, ty + 1) !== 1 && ty + 1 < G.ROWS) { c.fillStyle = 'rgba(24,20,37,0.35)'; c.fillRect(x + 2, y + T, T - 4, 6); }
      } else {
        const below = tileAt(room, tx, ty + 1);
        const faceShown = ty + 1 < G.ROWS && below !== 1;
        if (faceShown) {
          if (hasFace) sp.draw(c, wf, 0, cx, cy, { anchor: 'center' });
          else { c.fillStyle = th.top; c.fillRect(x, y, T, 10); c.fillStyle = th.face; c.fillRect(x, y + 10, T, T - 10); c.fillStyle = th.faceHi; c.fillRect(x, y + 10, T, 2); for (let i = 0; i < 3; i++) c.fillRect(x + ((i & 1) ? 0 : 20), y + 20 + i * 8, 2, 8); }
        } else {
          if (hasWall) sp.draw(c, wl, 0, cx, cy, { anchor: 'center' });
          else { c.fillStyle = th.top; c.fillRect(x, y, T, T); c.fillStyle = 'rgba(24,20,37,0.25)'; c.fillRect(x, y + T - 2, T, 2); }
        }
      }
    }
    // 墙顶与地面交界的暗边（左右墙、下墙的内侧）
    c.fillStyle = '#181425';
    for (let ty = 0; ty < G.ROWS; ty++) for (let tx = 0; tx < G.COLS; tx++) {
      if (tileAt(room, tx, ty) !== 1) continue;
      const x = tx * T, y = ty * T;
      if (tileAt(room, tx + 1, ty) !== 1 && tx + 1 < G.COLS) c.fillRect(x + T - 2, y, 2, T);
      if (tileAt(room, tx - 1, ty) !== 1 && tx > 0) c.fillRect(x, y, 2, T);
      if (tileAt(room, tx, ty - 1) !== 1 && ty > 0) c.fillRect(x, y, T, 2);
    }
  }
  function drawRoomBase(room) {
    const theme = themeOf();
    let ent = roomCache && roomCache.get(room);
    if (!ent || ent.theme !== theme) {
      const c = mkCanvas(G.RW, G.RH);
      if (!c) { drawTileSet(ctx, room, theme); return; }
      const cx = c.getContext('2d'); cx.imageSmoothingEnabled = false;
      try { drawTileSet(cx, room, theme); } catch (e) { G.reportError && G.reportError(e); }
      ent = { c: c, theme: theme };
      if (roomCache) roomCache.set(room, ent);
    }
    ctx.drawImage(ent.c, 0, 0);
  }
  const DOOR_ROT = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  function drawDoors(room) {
    const T = G.T;
    for (let d = 0; d < 4; d++) {
      if (!room.doors || !room.doors[d]) continue;
      const dt = G.DOOR_TILE[d], tx = dt[0], ty = dt[1];
      if (tileAt(room, tx, ty) !== 3) continue;
      const cx = tx * T + T / 2, cy = ty * T + T / 2;
      const name = room.locked ? 'door_locked' : 'door_open';
      if (hasF(name, '0')) spr(name, 0, cx, cy, { rot: DOOR_ROT[d], anchor: 'center' });
      else {
        ctx.fillStyle = '#181425'; ctx.fillRect(cx - 20, cy - 20, 40, 40);
        if (room.locked) { ctx.fillStyle = '#b86f50'; ctx.fillRect(cx - 16, cy - 16, 32, 32); ctx.fillStyle = '#feae34'; ctx.fillRect(cx - 3, cy - 4, 6, 8); }
      }
      if (room.locked) {
        // 锁门红光，提示“清完才能走”
        const a = 0.25 + 0.15 * Math.sin(S.time * 4);
        ctx.globalAlpha = a; ctx.fillStyle = '#ff0044';
        if (d === 0) ctx.fillRect(cx - 20, cy + 16, 40, 4); else if (d === 2) ctx.fillRect(cx - 20, cy - 20, 40, 4);
        else if (d === 1) ctx.fillRect(cx - 20, cy - 20, 4, 40); else ctx.fillRect(cx + 16, cy - 20, 4, 40);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---------- 危险区 ----------
  const HZ = {
    fire: ['#f77622', '#feae34', '#be4a2f'], lava: ['#be4a2f', '#f77622', '#3e2731'], poison: ['#3e8948', '#63c74d', '#265c42'],
    ice: ['#0099db', '#2ce8f5', '#c0cbdc'], void: ['#68386c', '#b55088', '#181425'], acid: ['#3e8948', '#63c74d', '#265c42'], slime: ['#3e8948', '#63c74d', '#265c42']
  };
  function drawHazards() {
    const tm = S.time;
    for (const h of S.hazards) {
      if (!h || h.dead) continue;
      const c = HZ[h.kind] || HZ.fire, mine = h.own === 'p';
      const max = h.max || 1, t = h.t === undefined ? max : h.t;
      if ((h.kind === 'ice' || h.kind === 'shock') && !(h.dps > 0)) {
        // 扩散冲击环（寒冰新星/护盾冲击波）
        const u = clamp01(1 - t / max), rr = (h.rad || 60) * (0.25 + 0.75 * u), col = h.kind === 'ice' ? '#2ce8f5' : '#c0cbdc';
        ctx.globalAlpha = 0.25 * (1 - u); circ(h.x, h.y, rr, col);
        ctx.globalAlpha = 0.9 * (1 - u * 0.7); circ(h.x, h.y, rr, null, col, 4 * (1 - u) + 1);
        ctx.globalAlpha = 1; continue;
      }
      const fade = clamp01(t / 0.35) * clamp01((max - t) / 0.15 + 0.3);
      const r = h.rad || 30;
      ctx.globalAlpha = (mine ? 0.3 : 0.42) * fade; circ(h.x, h.y, r, c[0]);
      ctx.globalAlpha = (mine ? 0.35 : 0.55) * fade;
      // 内部翻滚的斑块（确定性：由模拟时间与位置决定）
      for (let i = 0; i < 5; i++) {
        const a = i * 1.257 + tm * (0.6 + i * 0.13) + h.x * 0.01, d = r * (0.25 + 0.4 * ((i * 0.37 + tm * 0.3) % 1));
        circ(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d * 0.8, r * (0.18 + 0.08 * Math.sin(tm * 5 + i)), c[1]);
      }
      if (!mine) { ctx.globalAlpha = 0.75 * fade; circ(h.x, h.y, r, null, c[1], 2); }
      ctx.globalAlpha = 1;
    }
  }
  // ---------- 延迟打击（落点圈随 1-t/max 填满） ----------
  function drawStrikes() {
    for (const s of S.strikes) {
      if (!s) continue;
      const max = s.max || 1, k = clamp01(1 - (s.t || 0) / max), r = s.rad || 40;
      const mine = s.own === 'p', col = mine ? '#feae34' : '#ff0044';
      const blink = k > 0.7 ? (Math.sin(S.time * 40) > 0 ? 1 : 0.55) : 1;
      ctx.globalAlpha = 0.14; circ(s.x, s.y, r, col);
      ctx.globalAlpha = 0.22 + 0.25 * k; circ(s.x, s.y, r * k, col);
      ctx.globalAlpha = 0.9 * blink; circ(s.x, s.y, r, null, col, 2);
      ctx.globalAlpha = 0.6; ctx.fillStyle = col;
      ctx.fillRect(s.x - 6, s.y - 1, 12, 2); ctx.fillRect(s.x - 1, s.y - 6, 2, 12);
      ctx.globalAlpha = 1;
      if (s.kind === 'meteor' || s.kind === 'pillar' || s.kind === 'lava') {
        // 从天而降的落石/熔岩块（最后 45% 时间）
        if (k > 0.55) {
          const u = (k - 0.55) / 0.45, hgt = (1 - u) * 260, rr = Math.max(4, r * 0.35);
          shadow(s.x, s.y + 2, rr * (0.6 + u * 0.6), 0.25 + 0.3 * u);
          circ(s.x, s.y - hgt, rr, '#181425'); circ(s.x, s.y - hgt, rr - 2, s.kind === 'pillar' ? '#8b9bb4' : '#be4a2f'); circ(s.x - rr * 0.25, s.y - hgt - rr * 0.25, rr * 0.4, s.kind === 'pillar' ? '#c0cbdc' : '#feae34');
        }
      }
    }
  }

  // ---------- 敌人预警（6 种；k=进度；闪烁用模拟时间） ----------
  function teleStyle(k) {
    const blink = 0.5 + 0.5 * Math.sin(S.time * (10 + 34 * k));
    return { fillA: 0.18 + 0.22 * k, lineA: 0.45 + 0.5 * (k > 0.75 ? blink : k), col: '#ff0044' };
  }
  // 首领与第 3 层：描边 3px + 外圈 1px 深色（#181425）提高对比度（评审第 6 项）
  const TELE_DARK = '#181425';
  let teleStrong = false, teleLW = 2;
  function teleStroke(lw) {
    const w = lw || teleLW;
    if (teleStrong) { const a = ctx.globalAlpha, c = ctx.strokeStyle; ctx.globalAlpha = Math.min(1, a + 0.25); ctx.strokeStyle = TELE_DARK; ctx.lineWidth = w + 2; ctx.stroke(); ctx.globalAlpha = a; ctx.strokeStyle = c; }
    ctx.lineWidth = w; ctx.stroke();
  }
  function teleRect(x, y, w, h) { ctx.beginPath(); ctx.rect(x, y, w, h); teleStroke(); }
  function teleRing(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, TAU); teleStroke(); }
  function drawTele(e) {
    const tl = e.tele; if (!tl) return;
    const k = clamp01(tl.k === undefined ? 0.5 : tl.k), st = teleStyle(k);
    ctx.save();
    teleStrong = !!(e.boss || (S.floor || 0) >= 2); teleLW = teleStrong ? 3 : 2;
    ctx.fillStyle = st.col; ctx.strokeStyle = st.col; ctx.lineWidth = teleLW;
    const ty = tl.type;
    if (ty === 'line') {
      const len = tl.len || 200, w = tl.w || e.r * 1.6;
      ctx.translate(e.x, e.y); ctx.rotate(tl.ang || 0);
      ctx.globalAlpha = st.fillA * 0.6; ctx.fillRect(0, -w / 2, len, w);
      ctx.globalAlpha = st.fillA + 0.15; ctx.fillRect(0, -w / 2, len * k, w);
      ctx.globalAlpha = st.lineA; teleRect(0, -w / 2, len, w);
      // 箭头
      ctx.beginPath(); ctx.moveTo(len - 4, 0); ctx.lineTo(len - 16, -w * 0.35); ctx.moveTo(len - 4, 0); ctx.lineTo(len - 16, w * 0.35); teleStroke();
    } else if (ty === 'cone') {
      const len = tl.len || 120, arc = tl.arc || 1, a = tl.ang || 0;
      ctx.translate(e.x, e.y);
      ctx.globalAlpha = st.fillA * 0.6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, len, a - arc / 2, a + arc / 2); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = st.fillA + 0.15; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, Math.max(1, len * k), a - arc / 2, a + arc / 2); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = st.lineA; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, len, a - arc / 2, a + arc / 2); ctx.closePath(); teleStroke();
      if (tl.laser && tl.from !== undefined) {
        // 扫射起始边加亮 + 沿扫射方向的箭头
        const f = tl.from, dir = tl.dir || 1;
        ctx.globalAlpha = 0.6 + 0.4 * (k > 0.7 ? 0.5 + 0.5 * Math.sin(S.time * 40) : 1);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(f) * len, Math.sin(f) * len); teleStroke(teleLW + 2);
        for (let i = 1; i <= 3; i++) {
          const ra = len * i / 4, a1 = f + dir * 0.18, ax = Math.cos(a1) * ra, ay = Math.sin(a1) * ra;
          const tx = -Math.sin(a1) * dir, tyy = Math.cos(a1) * dir, nx = Math.cos(a1), ny = Math.sin(a1);
          ctx.beginPath(); ctx.moveTo(ax + tx * 6, ay + tyy * 6); ctx.lineTo(ax - tx * 4 + nx * 6, ay - tyy * 4 + ny * 6); ctx.moveTo(ax + tx * 6, ay + tyy * 6); ctx.lineTo(ax - tx * 4 - nx * 6, ay - tyy * 4 - ny * 6); teleStroke();
        }
      }
    } else if (ty === 'circle') {
      const r = tl.rad || 60;
      ctx.globalAlpha = st.fillA * 0.6; circ(e.x, e.y, r, st.col);
      ctx.globalAlpha = st.fillA + 0.15; circ(e.x, e.y, r * k, st.col);
      ctx.globalAlpha = st.lineA; teleRing(e.x, e.y, r);
    } else if (ty === 'target') {
      const r = tl.rad || 40, x = tl.x === undefined ? e.x : tl.x, y = tl.y === undefined ? e.y : tl.y;
      ctx.globalAlpha = st.fillA * 0.6; circ(x, y, r, st.col);
      ctx.globalAlpha = st.fillA + 0.15; circ(x, y, r * k, st.col);
      ctx.globalAlpha = st.lineA; teleRing(x, y, r);
      if (teleStrong) { ctx.fillStyle = TELE_DARK; ctx.fillRect(x - r * 0.3 - 1, y - 2, r * 0.6 + 2, 4); ctx.fillRect(x - 2, y - r * 0.3 - 1, 4, r * 0.6 + 2); ctx.fillStyle = st.col; }
      ctx.fillRect(x - r * 0.3, y - 1, r * 0.6, 2); ctx.fillRect(x - 1, y - r * 0.3, 2, r * 0.6);
    } else if (ty === 'rays') {
      const n = tl.n || 4, len = tl.len || 400, w = tl.w || 14;
      ctx.translate(e.x, e.y);
      for (let i = 0; i < n; i++) {
        ctx.save(); ctx.rotate((tl.base || 0) + i * TAU / n);
        ctx.globalAlpha = st.fillA * 0.6; ctx.fillRect(0, -w / 2, len, w);
        ctx.globalAlpha = st.fillA + 0.15; ctx.fillRect(0, -w / 2, len * k, w);
        ctx.globalAlpha = st.lineA; teleRect(0, -w / 2, len, w);
        ctx.restore();
      }
    } else if (ty === 'aim') {
      const len = tl.len || 600, a = tl.ang || 0;
      ctx.translate(e.x, e.y); ctx.rotate(a);
      const lock = !!tl.lock;
      const aimA = 0.35 + 0.6 * ((k > 0.75 || lock) ? (0.5 + 0.5 * Math.sin(S.time * 50)) : k);
      if (teleStrong) { ctx.globalAlpha = Math.min(1, aimA + 0.2); ctx.fillStyle = TELE_DARK; ctx.fillRect(0, -1.5 - k - (lock ? 1 : 0), len, 3 + 2 * k + (lock ? 2 : 0)); ctx.fillStyle = st.col; }
      ctx.globalAlpha = aimA;
      ctx.fillRect(0, -0.5 - k - (lock ? 1 : 0), len, 1 + 2 * k + (lock ? 2 : 0));
      ctx.globalAlpha = 0.18 + 0.22 * k; ctx.fillRect(0, -4, len, 8);
      // 枪口蓄能点
      ctx.globalAlpha = 0.9; circ(e.r * 0.9, 0, 2 + 4 * k, '#ffffff', st.col, 2);
    }
    ctx.restore();
  }

  // ---------- 拾取物与可交互物 ----------
  const CHEST_COL = { relic: '#b55088', weapon: '#0099db', gold: '#feae34' };
  function glow(x, y, r, col, a) { ctx.globalAlpha = a; circ(x, y, r, col); ctx.globalAlpha = a * 1.4; circ(x, y, r * 0.55, col); ctx.globalAlpha = 1; }
  function shopGoods(it, x, y) {
    const w = it.what;
    if (w === 'weapon' && it.ref) spr('weapon_' + it.ref, 0, x, y, { anchor: 'center' });
    else if (w === 'relic' && it.ref) spr('icon_' + it.ref, 0, x, y, { anchor: 'center' });
    else if (w === 'active' && it.ref) spr('icon_active_' + it.ref, 0, x, y, { anchor: 'center' });
    else if (w === 'heart') spr('item_heart', 0, x, y, { anchor: 'center' });
    else if (w === 'armor') spr('item_armor', 0, x, y, { anchor: 'center' });
    else if (w === 'energy') spr('item_energy', 0, x, y, { anchor: 'center' });
    else spr('item_' + w, 0, x, y, { anchor: 'center' });
  }
  function rarityCol(kind, id) {
    let r = 1;
    try {
      if (G.Items && G.Items.rarityOf) r = G.Items.rarityOf(kind, id) || 1;
      else { const d = kind === 'weapon' ? G.WEAPONS && G.WEAPONS[id] : G.RELICS && G.RELICS[id]; r = (d && d.rarity) || 1; }
    } catch (e) { r = 1; }
    return { r: r, c: G.rarityColor ? G.rarityColor(r) : '#c0cbdc' };
  }
  function drawItems(tags) {
    const tm = S.time, items = S.room.items || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; if (!it || it.dead) continue;
      const bob = Math.round(Math.sin(tm * 3 + it.x * 0.07 + it.y * 0.05) * 2) * 1.5;
      const x = it.x, y = it.y;
      switch (it.kind) {
        case 'coin': shadow(x, y + 6, 5, 0.3); spr('item_coin', Math.floor(tm * 8 + x * 0.1) % 4, x, y - 2 + bob * 0.6, { anchor: 'center' }); break;
        case 'heart': shadow(x, y + 8, 7, 0.3); spr('item_heart', 0, x, y - 2 + bob, { anchor: 'center' }); break;
        case 'armor': shadow(x, y + 8, 7, 0.3); spr('item_armor', 0, x, y - 2 + bob, { anchor: 'center' }); break;
        case 'energy': shadow(x, y + 6, 5, 0.3); glow(x, y - 2 + bob, 8, '#0099db', 0.18); spr('item_energy', Math.floor(tm * 4) % 2, x, y - 2 + bob, { anchor: 'center' }); break;
        case 'weapon': {
          const rc = rarityCol('weapon', it.wid), pulse = 0.18 + 0.08 * Math.sin(tm * 4 + x);
          if (rc.r >= 4) { ctx.globalAlpha = 0.12 + 0.05 * Math.sin(tm * 3); ctx.fillStyle = rc.c; ctx.fillRect(x - 6, y - 70, 12, 70); ctx.globalAlpha = 1; }
          shadow(x, y + 10, 14, 0.3);
          ctx.globalAlpha = pulse; ctx.fillStyle = rc.c; ctx.beginPath(); ctx.ellipse(x, y + 6, 22, 9, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
          spr('weapon_' + it.wid, 0, x, y - 4 + bob, { anchor: 'center', outline: rc.r >= 2 ? rc.c : undefined, alpha: it.cd > 0 ? 0.6 : 1 });
          break;
        }
        case 'chest': {
          const col = CHEST_COL[it.tier] || '#feae34';
          glow(x, y + 4, 22, col, 0.12 + 0.05 * Math.sin(tm * 3 + x));
          shadow(x, y + 14, 18, 0.35);
          spr(it.opened && hasF('item_chest_open', '0') ? 'item_chest_open' : 'item_chest', 0, x, y, { anchor: 'center', tint: it.tier === 'gold' ? undefined : col, tintA: 0.25 });
          break;
        }
        case 'shop': {
          shadow(x, y + 18, 20, 0.35);
          spr('shop_stand', 0, x, y + 6, { anchor: 'center' });
          if (!it.sold) {
            shopGoods(it, x, y - 14 + bob);
            let price = it.price || 0;
            try { if (G.shopPrice && S.p) price = G.shopPrice(S, it); } catch (e) { /* */ }
            const afford = !S.p || S.p.gold >= price;
            tags.push([String(price), x, y + 36, afford ? '#fee761' : '#e43b44']);
          }
          break;
        }
        case 'altar': {
          const col = it.what === 'blood' ? '#e43b44' : '#feae34';
          if (!it.used) glow(x, y, 26, col, 0.12 + 0.06 * Math.sin(tm * 2.5));
          shadow(x, y + 16, 20, 0.35);
          spr(it.what === 'blood' ? 'altar_blood' : 'altar_gold', 0, x, y, { anchor: 'center', alpha: it.used ? 0.55 : 1 });
          break;
        }
        case 'portal': {
          for (let j = 0; j < 3; j++) {
            ctx.globalAlpha = 0.5 + 0.2 * j; ctx.strokeStyle = ['#68386c', '#b55088', '#2ce8f5'][j]; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(x, y, 34 - j * 9, tm * (2 + j) + j, tm * (2 + j) + j + 4.2); ctx.stroke();
          }
          ctx.globalAlpha = 1;
          spr('item_portal', Math.floor(tm * 8) % 4, x, y, { anchor: 'center' });
          for (let j = 0; j < 6; j++) { const a = tm * 1.7 + j * 1.047, d = 30 + 8 * Math.sin(tm * 3 + j); ctx.fillStyle = j & 1 ? '#2ce8f5' : '#b55088'; ctx.fillRect(snap(x + Math.cos(a) * d) - 2, snap(y + Math.sin(a) * d) - 2, 4, 4); }
          break;
        }
        case 'active': {   // 主动道具：石台 + 光圈 + 图标（lead 补充）
          const ad = G.ACTIVES && G.ACTIVES[it.id], col = G.rarityColor ? G.rarityColor((ad && ad.rarity) || 2) : '#63c74d';
          shadow(x, y + 14, 16, 0.35);
          ctx.fillStyle = '#3a4466'; ctx.fillRect(snap(x) - 14, snap(y) + 4, 28, 10); ctx.fillStyle = '#5a6988'; ctx.fillRect(snap(x) - 14, snap(y) + 4, 28, 2);
          glow(x, y - 8 + bob, 16, col, 0.16 + 0.06 * Math.sin(tm * 3 + x));
          spr('icon_active_' + it.id, 0, x, y - 10 + bob, { anchor: 'center', outline: col, alpha: it.cd > 0 ? 0.6 : 1 });
          break;
        }
        case 'deco': break;   // 装饰（商店老板）在 y 排序层画
        default: spr('item_' + it.kind, 0, x, y + bob, { anchor: 'center' });
      }
    }
  }
  function drawTags(tags) {
    if (!tags.length) return;
    const L = (typeof UILint !== 'undefined') ? UILint : null;
    if (L) L.layer('world');
    for (const t of tags) {
      const w = 14 + (G.gfx && G.gfx.measure ? G.gfx.measure(ctx, t[0], 14, true) : t[0].length * 8);
      ctx.globalAlpha = 0.8; ctx.fillStyle = '#181425'; ctx.fillRect(Math.round(t[1] - w / 2 - 6), t[2] - 10, Math.round(w + 12), 20); ctx.globalAlpha = 1;
      if (hasF('ui_coin', '0')) spr('ui_coin', 0, t[1] - w / 2 + 2, t[2], { anchor: 'center', scale: 1 });
      else circ(t[1] - w / 2 + 2, t[2], 4, '#feae34');
      txt(t[0], t[1] + 7, t[2] + 1, 14, t[3]);
    }
    if (L) L.layer('ui');
  }

  // ---------- 敌人 ----------
  const ATK_RE = /atk|attack|charge|dash|fire|shoot|wind|aim|cast|slam|swing|jump|leap|spit|laser|summon|fuse|burst|lunge/;
  const wcount = {};
  function walkFrames(base) {
    let n = wcount[base];
    if (n === undefined) { n = hasF(base, 'walk3') ? 4 : hasF(base, 'walk2') ? 3 : hasF(base, 'walk1') ? 2 : hasF(base, 'walk0') ? 1 : 0; wcount[base] = n; }
    return n;
  }
  function enemyFrame(e, base) {
    const p2 = e.boss && e.phase >= 2 && hasF(base, 'p2_idle0') ? 'p2_' : '';
    const tl = e.tele || e.st === 'tele';
    // Boss 预警时优先显示攻击姿态（可读性优先于受击帧）
    if (e.flash > 0.05 && !(e.boss && tl) && hasF(base, p2 + 'hurt')) return p2 + 'hurt';
    if ((e.tele || e.st === 'tele' || ATK_RE.test(e.st || '')) && hasF(base, p2 + 'atk')) return p2 + 'atk';
    if ((e.tele || e.st === 'tele' || ATK_RE.test(e.st || '')) && hasF(base, 'atk')) return 'atk';
    const an = e.anim || S.time;
    if (e.moving && !p2) { const n = walkFrames(base); if (n) return 'walk' + (Math.floor(an * 8) % n); }
    return p2 + 'idle' + (Math.floor(an * 3) % 2);
  }
  function statusFx(e, o, x, top) {
    const s = e.status || {};
    if (s.freeze > 0) { o.tint = '#c0cbdc'; o.tintA = 0.6; }
    else if (s.chill > 0) { o.tint = '#2ce8f5'; o.tintA = 0.3; }
    else if (s.burn && s.burn.t > 0) { o.tint = '#f77622'; o.tintA = 0.2 + 0.15 * Math.sin(S.time * 18 + e.id); }
    else if (s.poison && s.poison.t > 0) { o.tint = '#63c74d'; o.tintA = 0.32; }
    if (s.burn && s.burn.t > 0) {
      for (let i = 0; i < 3; i++) {
        const u = (S.time * 2.2 + i / 3 + e.id * 0.17) % 1;
        ctx.globalAlpha = 1 - u; ctx.fillStyle = u < 0.4 ? '#fee761' : '#f77622';
        ctx.fillRect(snap(x - 8 + i * 8 + Math.sin(u * 9 + i) * 2), snap(top + 10 - u * 18), 4, 4);
      }
      ctx.globalAlpha = 1;
    }
    if (s.poison && s.poison.t > 0) {
      for (let i = 0; i < 2; i++) { const u = (S.time * 1.4 + i * 0.5 + e.id * 0.31) % 1; ctx.globalAlpha = 0.9 * (1 - u); circ(x - 5 + i * 10, top + 8 - u * 14, 2 + u * 2, '#63c74d'); }
      ctx.globalAlpha = 1;
    }
  }
  function drawEnemy(e) {
    const base = (e.boss ? 'boss_' : 'enemy_') + e.type;
    const sz = sizeOf(base), hgt = sz[1] * G.PX, wid = sz[0] * G.PX;
    const feet = e.y + e.r * 0.8;
    const tm = S.time;
    // 隐身：只画微弱扭曲
    if (e.hidden) {
      ctx.globalAlpha = 0.12 + 0.05 * Math.sin(tm * 9 + e.id);
      ctx.strokeStyle = '#b55088'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(e.x + Math.sin(tm * 7) * 2, e.y, e.r * (0.9 + 0.1 * Math.sin(tm * 11)), e.r * 1.1, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1; return;
    }
    // 出生：召唤法阵 + 逐渐显形
    if (e.spawnT > 0) {
      const u = clamp01(1 - e.spawnT / 0.8);
      ctx.save(); ctx.translate(e.x, feet - 2); ctx.scale(1, 0.45); ctx.rotate(tm * 3);
      ctx.globalAlpha = 0.8; ctx.strokeStyle = '#b55088'; ctx.lineWidth = 3; ctx.strokeRect(-e.r, -e.r, e.r * 2, e.r * 2);
      ctx.rotate(Math.PI / 4); ctx.strokeStyle = '#2ce8f5'; ctx.strokeRect(-e.r * 0.8, -e.r * 0.8, e.r * 1.6, e.r * 1.6);
      ctx.restore();
      spr(base, 'idle0', e.x, feet, { anchor: 'feet', alpha: 0.2 + 0.6 * u, flash: u < 0.6, flip: e.x > (S.p ? S.p.x : e.x) });
      return;
    }
    // 钻地（鼹鼠）：土包移动
    if (e.st === 'burrow' || e.st === 'emerge' || (e.air && (e.type === 'mole' || e.ai === 'mole'))) {
      if (e.st === 'emerge') { const j = Math.sin(tm * 50) * 2; ctx.fillStyle = '#3e2731'; ctx.beginPath(); ctx.ellipse(e.x + j, feet - 2, e.r * 1.3, e.r * 0.6, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#733e39'; ctx.beginPath(); ctx.ellipse(e.x, feet - 2, e.r * 1.0, e.r * 0.5, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#b86f50';
      for (let i = 0; i < 3; i++) { const u = (tm * 3 + i / 3) % 1; ctx.fillRect(snap(e.x - e.r + i * e.r * 0.9), snap(feet - 4 - Math.sin(u * Math.PI) * 10), 4, 4); }
      return;
    }
    let lift = 0;
    if (e.air) lift = 26;
    else if (e.def && e.def.flying) lift = 6 + Math.round(Math.sin(tm * 6 + e.id) * 2) * 2;
    shadow(e.x, feet, Math.max(e.r * 0.9, wid * 0.32) * (e.air ? 0.7 : 1), e.air ? 0.25 : 0.35);
    // 精英：脚下脉动光晕
    const af = e.elite && G.AFFIXES && G.AFFIXES[e.elite];
    if (af) {
      ctx.globalAlpha = 0.22 + 0.12 * Math.sin(tm * 5 + e.id); ctx.fillStyle = af.color;
      ctx.beginPath(); ctx.ellipse(e.x, feet, e.r * 1.5, e.r * 0.65, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    }
    const flip = e.face !== undefined ? Math.cos(e.face) < 0 : (S.p && S.p.x < e.x);
    const o = { anchor: 'feet', flip: flip };
    if (af) o.outline = af.color;
    const top = feet - lift - hgt;
    // 受击闪白：普通敌人受击后前半段画白剪影；Boss 只叠半透明白色调，避免持续射击时整只变白看不清招式
    if (e.flash > 0) {
      if (e.boss) { o.tint = '#ffffff'; o.tintA = Math.min(0.5, e.flash * 5); }
      else if (e.flash > 0.05) o.flash = true;
    }
    statusFx(e, o, e.x, top);
    // 自爆蘑菇等引信闪烁
    if (e.st === 'fuse' && Math.sin(tm * 30) > 0) o.flash = true;
    if (e.inv > 0 && !e.boss && Math.sin(tm * 40) > 0) o.alpha = 0.6;
    if (e.st === 'fade' || e.st === 'hide') o.alpha = 0.4 + 0.1 * Math.sin(tm * 12);
    // 激光扫射进行中：当前激光角
    if (e.mem && e.mem.beamAng !== undefined && e.st === 'act' && !e.tele) {
      const a = e.mem.beamAng;
      ctx.globalAlpha = 0.5; ctx.strokeStyle = '#ff0044'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(a) * 900, e.y + Math.sin(a) * 900); ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    }
    spr(base, enemyFrame(e, base), e.x, feet - lift, o);
    if (e.status && e.status.freeze > 0) {
      ctx.globalAlpha = 0.5; ctx.strokeStyle = '#2ce8f5'; ctx.lineWidth = 2;
      ctx.strokeRect(snap(e.x - wid * 0.45), snap(top + 2), snap(wid * 0.9), snap(hgt - 2)); ctx.globalAlpha = 1;
    }
    // 护盾词缀：护盾值存在时画护盾泡（厚度随剩余护盾）
    if (e.eshield > 0) {
      const f = e.eshieldMax > 0 ? clamp01(e.eshield / e.eshieldMax) : 1;
      ctx.globalAlpha = 0.12 + 0.08 * f; circ(e.x, feet - lift - hgt / 2, Math.max(e.r, wid * 0.5) + 5, '#2ce8f5');
      ctx.globalAlpha = 0.45 + 0.35 * f + 0.1 * Math.sin(tm * 6); circ(e.x, feet - lift - hgt / 2, Math.max(e.r, wid * 0.5) + 5, null, '#2ce8f5', 1 + 2 * f); ctx.globalAlpha = 1;
    }
    // 持盾卫兵：盾牌朝向弧（放下时不画，露出破绽）
    if (e.type === 'guard' && !(e.mem && e.mem.shieldDown) && e.face !== undefined) {
      const cy = feet - lift - hgt / 2;
      ctx.strokeStyle = '#181425'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(e.x, cy, e.r + 7, e.face - 0.75, e.face + 0.75); ctx.stroke();
      ctx.strokeStyle = '#c0cbdc'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, cy, e.r + 7, e.face - 0.7, e.face + 0.7); ctx.stroke();
    }
    // 深渊骑士挥砍弧光
    if (e.mem && e.mem.slashT > 0 && e.mem.slashAng !== undefined) {
      const a = e.mem.slashAng, u = clamp01(e.mem.slashT / 0.2);
      ctx.globalAlpha = 0.65 * u; ctx.fillStyle = '#ff0044';
      ctx.beginPath(); ctx.arc(e.x, e.y, 105, a - 0.9, a + 0.9); ctx.arc(e.x, e.y, 60, a + 0.9, a - 0.9, true); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.9 * u; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, 105, a - 0.9, a + 0.9); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // 头顶小血条（普通敌人受伤后）
    if (!e.boss && e.hp < e.maxHp && e.hp > 0) {
      const bw = Math.max(18, Math.round(e.r * 1.6 / 2) * 2), bx = snap(e.x - bw / 2), by = snap(top - 6);
      ctx.fillStyle = '#181425'; ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = af ? af.color : '#e43b44'; ctx.fillRect(bx, by, Math.max(1, Math.round(bw * clamp01(e.hp / e.maxHp))), 3);
    }
  }

  // ---------- 玩家 ----------
  const CCOL = { ranger: '#63c74d', mage: '#2ce8f5', knight: '#feae34', alchemist: '#b55088' };
  function weaponOf(p) { const wid = p.weapons && p.weapons[p.wi]; return wid ? { wid: wid, def: (G.WEAPONS && G.WEAPONS[wid]) || {} } : null; }
  function handPos(p) { return { x: p.x + Math.cos(p.aim) * 6, y: p.y + 4 + Math.sin(p.aim) * 3 }; }
  function drawWeapon(p, w) {
    const name = 'weapon_' + w.wid, cv = SP() && SP().get ? SP().get(name, 0) : null;
    const h = handPos(p), left = Math.cos(p.aim) < 0;
    let ang = p.aim;
    if (p.swing && w.def.kind === 'melee') { const u = clamp01(1 - p.swing.t / (p.swing.max || 0.2)), arc = p.swing.arc || 1.6; ang = p.swing.ang - arc / 2 + arc * Math.min(1, u * 1.6); }
    // 后坐力：刚开火时向后缩
    let kick = 0;
    const rate = (w.def.rate || 4) * ((p.st && p.st.rateMul) || 1);
    if (p.fireCd > 0 && rate > 0) kick = clamp01((p.fireCd * rate - 0.55) / 0.45) * (w.def.kind === 'charge' || w.wid === 'shotgun' || w.wid === 'rocket' ? 6 : 3);
    ctx.save();
    ctx.translate(snap(h.x - Math.cos(ang) * kick), snap(h.y - Math.sin(ang) * kick));
    ctx.rotate(ang); if (left) ctx.scale(1, -1);
    if (cv) {
      const g = (SP().grip && SP().grip[w.wid]) || [Math.round(cv.width * 0.25), Math.round(cv.height / 2)];
      ctx.drawImage(cv, -g[0] * G.PX, -g[1] * G.PX, cv.width * G.PX, cv.height * G.PX);
    } else { ctx.fillStyle = '#181425'; ctx.fillRect(-4, -4, 26, 8); ctx.fillStyle = w.def.color || '#c0cbdc'; ctx.fillRect(-2, -2, 22, 4); }
    ctx.restore();
    // 蓄力光 / 加特林预热
    const len = cv ? (cv.width * 0.75) * G.PX : 22;
    const mx = h.x + Math.cos(ang) * len, my = h.y + Math.sin(ang) * len;
    if (p.charge > 0) {
      const c = w.def.color || '#fee761', full = p.charge >= 1;
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(S.time * (full ? 40 : 15)); circ(mx, my, 4 + p.charge * 9, c);
      ctx.globalAlpha = 1; circ(mx, my, 2 + p.charge * 3, '#ffffff');
      if (full) { ctx.globalAlpha = 0.7; circ(mx, my, 14 + 3 * Math.sin(S.time * 30), null, c, 2); ctx.globalAlpha = 1; }
    } else if (p.spin > 0.05) {
      ctx.globalAlpha = 0.25 + 0.35 * p.spin; circ(mx, my, 3 + p.spin * 4, '#feae34'); ctx.globalAlpha = 1;
    }
  }
  function drawPlayer(p) {
    if (!p) return;
    const base = 'char_' + p.cid, sz = sizeOf(base), hgt = sz[1] * G.PX;
    const feet = p.y + p.r * 0.85, tm = S.time;
    const left = Math.cos(p.aim || 0) < 0;
    const w = weaponOf(p);
    // 技能光环
    if (p.skillT > 0) {
      const c = CCOL[p.cid] || '#2ce8f5';
      ctx.globalAlpha = 0.18; circ(p.x, p.y, p.r + 14, c);
      ctx.globalAlpha = 0.8; ctx.strokeStyle = c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 12 + Math.sin(tm * 10) * 2, tm * 4, tm * 4 + 4.5); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // 翻滚残影
    if (p.rolling > 0) {
      for (let i = 3; i >= 1; i--) spr(base, hasF(base, 'roll') ? 'roll' : 'idle0', p.x - (p.rdx || 0) * i * 10, feet - (p.rdy || 0) * i * 10, { anchor: 'feet', flip: (p.rdx || 0) < 0, alpha: 0.32 - i * 0.08, flash: true });
    }
    shadow(p.x, feet, Math.max(10, sz[0] * G.PX * 0.35), 0.4);
    let frame;
    if (p.rolling > 0 && hasF(base, 'roll')) frame = 'roll';
    else if (p.hurtFlash > 0 && hasF(base, 'hurt')) frame = 'hurt';
    else if (p.moving) frame = 'walk' + (Math.floor(tm * 10) % 4);
    else frame = 'idle' + (Math.floor(tm * 2.5) % 2);
    const o = { anchor: 'feet', flip: p.rolling > 0 ? (p.rdx || 0) < 0 : left };
    if (p.iframes > 0 && !(p.rolling > 0) && Math.floor(tm * 16) % 2) o.alpha = 0.35;
    if (p.hurtFlash > 0 && Math.floor(tm * 30) % 2) o.flash = true;
    const behind = w && !(p.rolling > 0) && Math.sin(p.aim) < -0.35;
    if (behind) drawWeapon(p, w);
    spr(base, frame, p.x, feet, o);
    if (w && !(p.rolling > 0) && !behind) drawWeapon(p, w);
    // 骑士壁垒：金色护罩
    if (p.wall > 0) {
      const cy = feet - hgt / 2, rr = Math.max(p.r, hgt / 2) + 12, fade = clamp01(p.wall / 0.4);
      ctx.globalAlpha = 0.16 * fade; circ(p.x, cy, rr, '#feae34');
      ctx.globalAlpha = (0.65 + 0.25 * Math.sin(tm * 8)) * fade; circ(p.x, cy, rr, null, '#fee761', 3);
      ctx.globalAlpha = 0.5 * fade; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, cy, rr - 4, -2.4 + tm, -1.6 + tm); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 护甲/护盾小提示：护盾满时一圈很淡的银光（不喧宾夺主）
    if (p.armor > 0) { ctx.globalAlpha = 0.25; circ(p.x, feet - hgt / 2, Math.max(p.r, hgt / 2) + 3, null, '#ead4aa', 1); ctx.globalAlpha = 1; }
  }
  function drawBeam(p) {
    const b = p.beam; if (!b || !b.on) return;
    const w = weaponOf(p), c = b.color || (w && w.def.color) || '#2ce8f5';
    const h = handPos(p);
    const sx = b.x !== undefined ? b.x : h.x + Math.cos(p.aim) * 22, sy = b.y !== undefined ? b.y : h.y + Math.sin(p.aim) * 22;
    const fl = 0.8 + 0.2 * Math.sin(S.time * 60), bw = Math.max(0.6, (b.w || 8) / 8);
    ctx.save(); ctx.lineCap = 'round';
    ctx.globalAlpha = 0.3; ctx.strokeStyle = c; ctx.lineWidth = 14 * fl * bw; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.globalAlpha = 0.85; ctx.lineWidth = 6 * fl * bw; ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * bw; ctx.stroke();
    circ(b.x2, b.y2, 6 + 3 * fl, c); circ(b.x2, b.y2, 3, '#ffffff'); circ(sx, sy, 5 * fl, '#ffffff');
    ctx.restore();
  }
  function drawCompanions(p) {
    const tm = S.time;
    if (p.orbs && p.orbs.length) {
      for (const o of p.orbs) {
        if (!o) continue;
        const r = o.r || 7;
        // 守护法球画成旋转的菱形水晶（不用“圆 + 白芯”，避免与敌弹混淆）
        const sa = tm * 3, cs = Math.cos(sa), sn = Math.sin(sa);
        const dia = (rr, col) => { ctx.beginPath(); ctx.moveTo(o.x + cs * rr * 1.3, o.y + sn * rr * 1.3); ctx.lineTo(o.x - sn * rr * 0.8, o.y + cs * rr * 0.8); ctx.lineTo(o.x - cs * rr * 1.3, o.y - sn * rr * 1.3); ctx.lineTo(o.x + sn * rr * 0.8, o.y - cs * rr * 0.8); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
        ctx.globalAlpha = 0.3; dia(r + 3, '#2ce8f5'); ctx.globalAlpha = 1;
        dia(r, '#c0cbdc'); dia(r * 0.45, '#ffffff');
      }
    }
    const d = p.drone;
    if (d) {
      const y = d.y - 18 + Math.sin(tm * 5) * 2;
      shadow(d.x, d.y + 4, 8, 0.25);
      if (hasF('drone', '0') || hasF('drone', 'idle0')) spr('drone', hasF('drone', 'idle0') ? 'idle' + (Math.floor(tm * 8) % 2) : Math.floor(tm * 20) % 2, d.x, y, { anchor: 'center', flip: Math.cos(d.aim || 0) < 0 });
      else {
        ctx.fillStyle = '#181425'; ctx.fillRect(snap(d.x - 9), snap(y - 5), 18, 10);
        ctx.fillStyle = '#8b9bb4'; ctx.fillRect(snap(d.x - 7), snap(y - 3), 14, 6);
        ctx.fillStyle = '#2ce8f5'; ctx.fillRect(snap(d.x + Math.cos(d.aim || 0) * 4) - 2, snap(y) - 2, 4, 4);
        const sp = Math.floor(tm * 30) % 2 ? 10 : 6;
        ctx.fillStyle = '#c0cbdc'; ctx.fillRect(snap(d.x - 8 - sp / 2), snap(y - 8), sp, 2); ctx.fillRect(snap(d.x + 8 - sp / 2), snap(y - 8), sp, 2);
      }
    }
  }
  function drawSwing(p) {
    const s = p.swing; if (!s) return;
    const u = clamp01(1 - s.t / (s.max || 0.2)), arc = s.arc || 1.6, rg = s.range || 60;
    const a0 = s.ang - arc / 2, a1 = a0 + arc * Math.min(1, u * 1.6);
    ctx.save();
    ctx.globalAlpha = 0.55 * (1 - u * 0.7); ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(p.x, p.y, rg, a0, a1); ctx.arc(p.x, p.y, rg * 0.55, a1, a0, true); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.9 * (1 - u); ctx.strokeStyle = '#2ce8f5'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, rg, a0, a1); ctx.stroke();
    ctx.restore();
  }
  function drawProp(pr) {
    if (!pr || pr.hp <= 0 || pr.dead) return;
    const x = pr.x !== undefined ? pr.x : pr.tx * G.T + G.T / 2, y = pr.y !== undefined ? pr.y : pr.ty * G.T + G.T / 2;
    shadow(x, y + 16, 16, 0.35);
    const o = { anchor: 'feet' };
    if (pr.flash > 0) o.flash = true;
    spr(pr.kind === 'barrel' ? 'prop_barrel' : 'prop_crate', 0, x, y + 18, o);
    if (pr.kind === 'barrel' && pr.hp < (pr.maxHp || 99) && Math.sin(S.time * 20) > 0.6) { ctx.globalAlpha = 0.4; circ(x, y - 4, 6, '#feae34'); ctx.globalAlpha = 1; }
  }

  // ---------- 子弹（预渲染缓存，2 倍分辨率） ----------
  // 敌我子弹视觉规则（QA G3，单一事实来源；tests/bullets.test.js 锁定）：
  //  敌弹 = 圆/椭圆实心 + 3px 深色描边 #181425 + 白芯；红/品红/紫/橙色系；永远画在最上层。
  //  玩家弹 = 沿速度方向拉长的弹头/短线/彗星，或旋转异形（星/瓶/漩涡/十字火花）；无深色描边；黄/白/青/蓝/银/骨白/毒绿色系。
  //  drawBullet 一律先经过 bulletStyle(b) 按 b.own 强制归一：数据里写错颜色或形状也不会撞色撞形。
  const ENEMY_BULLET_PALETTE = ['#ff0044', '#e43b44', '#c42430', '#f77622', '#b55088', '#f6757a'];
  const PLAYER_BULLET_PALETTE = ['#fee761', '#ffffff', '#2ce8f5', '#0099db', '#c0cbdc', '#ead4aa', '#63c74d'];
  const ENEMY_BULLET_SHAPES = ['eorb', 'ebig', 'eneedle', 'ering'];
  const PLAYER_BULLET_SHAPES = ['bolt', 'pellet', 'arrow', 'orb', 'shard', 'star', 'rocket', 'flask', 'spark', 'flame', 'void', 'spike'];
  const ENEMY_OUTLINE = '#181425', ENEMY_OUTLINE_W = 3;
  // 玩家弹误用敌方色时的替换表（只是兜底，测试会直接拦截数据）
  const P_FIX = { '#feae34': '#fee761', '#f77622': '#fee761', '#ff0044': '#ffffff', '#e43b44': '#ffffff', '#c42430': '#ffffff', '#b55088': '#0099db', '#f6757a': '#ffffff' };
  const setOf = (arr) => { const o = Object.create(null); for (let i = 0; i < arr.length; i++) o[arr[i]] = 1; return o; };
  const EPAL = setOf(ENEMY_BULLET_PALETTE), PPAL = setOf(PLAYER_BULLET_PALETTE), ESH = setOf(ENEMY_BULLET_SHAPES), PSH = setOf(PLAYER_BULLET_SHAPES);
  const styleTmp = { own: 'p', shape: 'bolt', color: '#fee761', outline: null, outlineW: 0, elongated: true };
  const ELONG = { bolt: 1, pellet: 1, arrow: 1, orb: 1, shard: 1, spike: 1, rocket: 1, flame: 1 };
  function bulletStyle(b, out) {
    const o = out || {};
    const enemy = !!b && b.own === 'e';
    let shape = (b && b.shape) || '', color = String((b && b.color) || '').toLowerCase();
    if (enemy) { if (!ESH[shape]) shape = 'eorb'; if (!EPAL[color]) color = '#ff0044'; }
    else { if (!PSH[shape]) shape = 'bolt'; if (!PPAL[color]) color = P_FIX[color] || '#fee761'; }
    o.own = enemy ? 'e' : 'p'; o.shape = shape; o.color = color;
    o.outline = enemy ? ENEMY_OUTLINE : null; o.outlineW = enemy ? ENEMY_OUTLINE_W : 0;
    o.elongated = enemy ? shape === 'eneedle' : !!ELONG[shape];
    return o;
  }
  const RES = 2, bcache = {};
  const ROT_SHAPES = { bolt: 1, arrow: 1, shard: 1, rocket: 1, spike: 1, eneedle: 1, pellet: 1, orb: 1 };
  function makeBullet(own, shape, color, r) {
    const enemy = own === 'e';
    const R = enemy ? Math.max(4, r) : Math.max(2, r);
    let L = R * 2, W = R * 2;            // 逻辑尺寸（未含边距）
    if (shape === 'bolt') { L = Math.max(12, R * 4.5); W = Math.max(4, R * 1.5); }
    else if (shape === 'arrow') { L = Math.max(16, R * 5); W = Math.max(6, R * 2); }
    else if (shape === 'shard' || shape === 'spike') { L = Math.max(10, R * 3.4); W = Math.max(5, R * 1.5); }
    else if (shape === 'rocket') { L = Math.max(14, R * 3.6); W = Math.max(6, R * 1.6); }
    else if (shape === 'pellet') { L = Math.max(11, R * 3.6); W = Math.max(3, R * 1.1); }
    else if (shape === 'orb') { L = Math.max(14, R * 3.8); W = Math.max(6, R * 1.7); }
    else if (shape === 'eneedle') { L = Math.max(14, R * 3); W = Math.max(7, R * 1.6); }
    else if (shape === 'void' || shape === 'star') { L = W = R * 3.2; }
    const pad = enemy ? ENEMY_OUTLINE_W + 2 : 3, cw = (L + pad * 2) * RES, ch = (W + pad * 2) * RES;
    const c = mkCanvas(cw, ch); if (!c) return null;
    const g = c.getContext('2d');
    g.scale(RES, RES); g.translate(L / 2 + pad, W / 2 + pad);
    const disc = (x, y, rr, col) => { g.beginPath(); g.arc(x, y, Math.max(0.3, rr), 0, TAU); g.fillStyle = col; g.fill(); };
    const ell = (rx, ry, col, x) => { g.beginPath(); g.ellipse(x || 0, 0, Math.max(0.3, rx), Math.max(0.3, ry), 0, 0, TAU); g.fillStyle = col; g.fill(); };
    if (enemy) {
      const O = ENEMY_OUTLINE_W;
      if (shape === 'eneedle') { ell(L / 2 + O, W / 2 + O, ENEMY_OUTLINE); ell(L / 2, W / 2, color); ell(L / 2 - 2.5, Math.max(1.5, W / 2 - 2), '#ffffff'); }
      else if (shape === 'ering') {
        disc(0, 0, R + O, ENEMY_OUTLINE); disc(0, 0, R, color); disc(0, 0, R * 0.62, '#ffffff'); disc(0, 0, R * 0.42, color); disc(0, 0, R * 0.3, ENEMY_OUTLINE);
      } else if (shape === 'ebig') {
        disc(0, 0, R + O + 0.5, ENEMY_OUTLINE); disc(0, 0, R, color);
        g.globalAlpha = 0.55; disc(0, 0, R * 0.75, '#ffffff'); g.globalAlpha = 1; disc(0, 0, R * 0.5, '#ffffff'); disc(-R * 0.25, -R * 0.25, R * 0.18, '#fee761');
      } else { // eorb 默认
        disc(0, 0, R + O, ENEMY_OUTLINE); disc(0, 0, R, color); disc(0, 0, R * 0.52, '#ffffff');
      }
      return { c: c, w: cw / RES, h: ch / RES, rot: !!ROT_SHAPES[shape] };
    }
    // 玩家弹：拉长弹体 / 异形，无深色描边、无“圆形白芯”
    switch (shape) {
      case 'pellet': // 霰弹：短曳光弹（拖尾 + 胶囊弹体 + 亮尖）
        g.globalAlpha = 0.35; g.fillStyle = color; g.fillRect(-L / 2, -W / 4, L * 0.6, W / 2); g.globalAlpha = 1;
        ell(L * 0.3, W / 2, color, L * 0.18); ell(L * 0.14, Math.max(0.6, W / 2 - 1), '#ffffff', L * 0.3); break;
      case 'arrow':
        g.fillStyle = color; g.fillRect(-L / 2, -1, L - 4, 2);
        g.beginPath(); g.moveTo(L / 2, 0); g.lineTo(L / 2 - 6, -W / 2); g.lineTo(L / 2 - 6, W / 2); g.closePath(); g.fillStyle = '#ffffff'; g.fill();
        g.fillStyle = color; g.fillRect(-L / 2, -W / 2, 4, 2); g.fillRect(-L / 2, W / 2 - 2, 4, 2); break;
      case 'shard': case 'spike':
        g.beginPath(); g.moveTo(L / 2, 0); g.lineTo(shape === 'spike' ? -L / 2 : 0, -W / 2); g.lineTo(-L / 2, 0); g.lineTo(shape === 'spike' ? -L / 2 : 0, W / 2); g.closePath(); g.fillStyle = color; g.fill();
        g.beginPath(); g.moveTo(L / 2 - 1, 0); g.lineTo(0, -W / 5); g.lineTo(-L / 4, 0); g.lineTo(0, W / 5); g.closePath(); g.fillStyle = '#ffffff'; g.fill(); break;
      case 'rocket':
        g.fillStyle = '#c0cbdc'; g.fillRect(-L / 2 + 3, -W / 2 + 1, L - 6, W - 2);
        g.beginPath(); g.moveTo(L / 2, 0); g.lineTo(L / 2 - 4, -W / 2 + 1); g.lineTo(L / 2 - 4, W / 2 - 1); g.closePath(); g.fillStyle = color; g.fill();
        g.fillStyle = color; g.fillRect(-L / 2 + 2, -W / 2, 4, W); g.fillStyle = '#ffffff'; g.fillRect(-L / 2 + 6, -1, L - 12, 1.5); break;
      case 'orb': { // 弹跳球/骑士反射：彗星（尖尾 + 椭圆头 + 前缘亮弧），沿速度方向
        const hx = L / 2 - W / 2;
        g.globalAlpha = 0.4; g.beginPath(); g.moveTo(-L / 2, 0); g.lineTo(hx, -W / 2); g.lineTo(hx, W / 2); g.closePath(); g.fillStyle = color; g.fill(); g.globalAlpha = 1;
        g.beginPath(); g.moveTo(-L / 4, 0); g.lineTo(hx, -W / 2.6); g.lineTo(hx, W / 2.6); g.closePath(); g.fillStyle = color; g.fill();
        ell(W / 2 + 1, W / 2, color, hx); ell(Math.max(0.8, W / 6), W / 2.8, '#ffffff', hx + W / 4); break;
      }
      case 'void': { // 虚空炮：旋转的三臂漩涡
        g.globalAlpha = 0.25; disc(0, 0, R * 1.5, color); g.globalAlpha = 1;
        g.strokeStyle = color; g.lineCap = 'round'; g.lineWidth = Math.max(2, R * 0.38);
        for (let i = 0; i < 3; i++) { const a0 = i * TAU / 3; g.beginPath(); g.arc(Math.cos(a0) * R * 0.35, Math.sin(a0) * R * 0.35, R * 0.95, a0, a0 + 1.9); g.stroke(); }
        g.lineWidth = 1.2; g.strokeStyle = '#ffffff';
        for (let i = 0; i < 3; i++) { const a0 = i * TAU / 3 + 0.6; g.beginPath(); g.arc(0, 0, R * 0.55, a0, a0 + 1.1); g.stroke(); }
        break;
      }
      case 'star': {
        g.globalAlpha = 0.3; disc(0, 0, R * 1.4, color); g.globalAlpha = 1;
        g.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i & 1 ? R * 0.5 : R * 1.3; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        g.closePath(); g.fillStyle = color; g.fill(); disc(0, 0, R * 0.4, '#ffffff'); break;
      }
      case 'spark':
        g.fillStyle = color; g.fillRect(-R, -1, R * 2, 2); g.fillRect(-1, -R, 2, R * 2); disc(0, 0, R * 0.5, '#ffffff'); break;
      case 'flask': // 药瓶：瓶身 + 瓶颈 + 木塞（抛物线飞行，有落点阴影）
        disc(0, 2, R, color); g.fillStyle = color; g.fillRect(-2, -R, 4, 3); g.fillStyle = '#ead4aa'; g.fillRect(-2.5, -R - 3, 5, 3); g.fillStyle = '#ffffff'; g.fillRect(-R * 0.55, 0, 1.5, R * 0.7); break;
      default: // bolt
        g.globalAlpha = 0.35; g.fillStyle = color; g.fillRect(-L / 2 - 2, -W / 2, L * 0.7, W); g.globalAlpha = 1;
        ell(L / 2, W / 2, color); ell(L / 2 - 2, Math.max(0.8, W / 2 - 1.5), '#ffffff');
    }
    return { c: c, w: cw / RES, h: ch / RES, rot: !!ROT_SHAPES[shape] };
  }
  function bulletSprite(own, shape, color, r) {
    const key = own + shape + color + (Math.round(r * 2) / 2);
    let v = bcache[key];
    if (v === undefined) { v = makeBullet(own, shape, color, r); bcache[key] = v; }
    return v;
  }
  function drawFlame(b) { // 喷火：黄白火舌，沿速度方向拉长，无描边（与橙红敌弹区分）
    const k = clamp01((b.life || 0) / (b.max || 0.4)), r = (b.r || 6) * (1.6 - k * 0.8);
    const a = Math.atan2(b.vy || 0, b.vx || 0.0001);
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
    ctx.globalAlpha = 0.25 + 0.55 * k; ctx.fillStyle = k > 0.3 ? '#fee761' : '#ead4aa';
    ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * 1.35, r * 0.8, 0, 0, TAU); ctx.fill();
    if (k > 0.4) { ctx.globalAlpha = 0.5 + 0.4 * k; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(r * 0.15, 0, r * 0.6, r * 0.35, 0, 0, TAU); ctx.fill(); }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawBullet(b) {
    const st = bulletStyle(b, styleTmp), enemy = st.own === 'e', shape = st.shape, col = st.color;
    if (shape === 'flame') { drawFlame(b); return; }
    let x = b.x, y = b.y;
    if (b.special === 'lob' || b.z > 0) {
      shadow(x, y + 2, Math.max(3, b.r || 5), 0.3); y -= (b.z || 0);
    } else if (b.lob) {
      const L = b.lob, u = clamp01(1 - (L.t || 0) / (L.max || 1)), z = (L.h || 60) * 4 * u * (1 - u);
      shadow(x, y + 2, Math.max(3, b.r || 5), 0.3); y -= z;
    }
    if (b.charged && !enemy) { ctx.globalAlpha = 0.35 + 0.15 * Math.sin(S.time * 40); circ(x, y, (b.r || 5) * 2.4, col); ctx.globalAlpha = 1; }
    const sp = bulletSprite(st.own, shape, col, b.r || 4);
    if (!sp) { // 无离屏画布时的路径兜底
      if (enemy) { circ(x, y, (b.r || 4) + ENEMY_OUTLINE_W, ENEMY_OUTLINE); circ(x, y, b.r || 4, col); circ(x, y, (b.r || 4) * 0.5, '#ffffff'); }
      else { const a = Math.atan2(b.vy || 0, b.vx || 0.0001), l = (b.r || 3) * 2.5; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, (b.r || 3) * 0.9); ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); ctx.lineTo(x + Math.cos(a) * l * 0.4, y + Math.sin(a) * l * 0.4); ctx.stroke(); }
      return;
    }
    let ang = 0, rot = sp.rot;
    if (rot) ang = Math.atan2(b.vy || 0, b.vx || 0.0001);
    else if (shape === 'star' || shape === 'flask' || shape === 'void') { rot = true; ang = S.time * (shape === 'void' ? -4 : 9) + (b.x + b.y) * 0.01; }
    if (rot) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.drawImage(sp.c, -sp.w / 2, -sp.h / 2, sp.w, sp.h); ctx.restore();
    } else ctx.drawImage(sp.c, x - sp.w / 2, y - sp.h / 2, sp.w, sp.h);
    if (shape === 'rocket') { const a = Math.atan2(b.vy || 0, b.vx || 1), fl = (Math.sin(S.time * 50 + b.x) > 0) ? 6 : 4, ex = x - Math.cos(a) * sp.w * 0.45, ey = y - Math.sin(a) * sp.w * 0.45; circ(ex, ey, fl, '#fee761'); circ(ex, ey, fl * 0.45, '#ffffff'); }
  }
  function drawBullets() {
    const bs = S.bullets, n = bs.length;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    // 玩家弹在下，敌弹在最上层（可读性优先）
    for (let i = 0; i < n; i++) { const b = bs[i]; if (b && !b.dead && b.own !== 'e') drawBullet(b); }
    for (let i = 0; i < n; i++) { const b = bs[i]; if (b && !b.dead && b.own === 'e') drawBullet(b); }
    ctx.imageSmoothingEnabled = smooth;
  }

  // ---------- 主入口 ----------
  const ents = [];
  let entN = 0;
  function pushEnt(y, k, o) {
    let r = ents[entN];
    if (!r) { r = { y: 0, k: 0, o: null }; ents[entN] = r; }
    r.y = y; r.k = k; r.o = o; entN++;
  }
  const byY = (a, b) => a.y - b.y;
  let lastErr = '';
  function drawWorld(c, s) {
    if (!c || !s || !s.room) return;
    ctx = c; S = s;
    try {
      const room = s.room, p = s.p;
      ctx.imageSmoothingEnabled = false;
      drawRoomBase(room);
      drawDoors(room);
      if (G.FX && G.FX.drawGround) G.FX.drawGround(ctx, s);
      drawHazards();
      drawStrikes();
      const tags = [];
      drawItems(tags);
      // 预警画在地面层（实体之下）
      const es = s.enemies || [];
      for (let i = 0; i < es.length; i++) { const e = es[i]; if (e && !e.dead && e.tele && !(e.spawnT > 0)) drawTele(e); }
      // y 排序：道具、敌人、玩家、店主
      entN = 0;
      const props = room.props || [];
      for (let i = 0; i < props.length; i++) { const pr = props[i]; if (pr && pr.hp > 0 && !pr.dead) pushEnt(pr.y !== undefined ? pr.y : pr.ty * G.T + G.T / 2, 0, pr); }
      for (let i = 0; i < es.length; i++) { const e = es[i]; if (e && !e.dead) pushEnt(e.y + (e.air && !(e.type === 'mole') ? 30 : 0), 1, e); }
      if (p) pushEnt(p.y, 2, p);
      const its = room.items || [];
      for (let i = 0; i < its.length; i++) { const it = its[i]; if (it && it.kind === 'deco') pushEnt(it.y, 3, it); }
      const list = ents.slice(0, entN).sort(byY);
      for (let i = 0; i < list.length; i++) {
        const en = list[i];
        if (en.k === 0) drawProp(en.o);
        else if (en.k === 1) drawEnemy(en.o);
        else if (en.k === 2) drawPlayer(en.o);
        else {
          const nm = en.o.sprite || 'shopkeeper';
          shadow(en.o.x, en.o.y + 14, 14, 0.35);
          spr(nm, hasF(nm, 'idle1') ? 'idle' + (Math.floor(s.time * 2) % 2) : 0, en.o.x, en.o.y + 16, { anchor: 'feet' });
        }
      }
      if (p) { drawCompanions(p); drawSwing(p); drawBeam(p); }
      drawBullets();
      drawTags(tags);
      ctx.globalAlpha = 1;
    } catch (e) {
      try { ctx.globalAlpha = 1; } catch (e2) { /* */ }
      const m = String(e && e.message || e);
      if (m !== lastErr) { lastErr = m; if (G.reportError) G.reportError('render: ' + m); }
    }
  }

  G.R = { drawWorld: drawWorld, _bulletSprite: bulletSprite,
    bulletStyle: function (b) { return bulletStyle(b, {}); },
    ENEMY_BULLET_PALETTE: ENEMY_BULLET_PALETTE.slice(), PLAYER_BULLET_PALETTE: PLAYER_BULLET_PALETTE.slice(),
    ENEMY_BULLET_SHAPES: ENEMY_BULLET_SHAPES.slice(), PLAYER_BULLET_SHAPES: PLAYER_BULLET_SHAPES.slice(),
    ENEMY_OUTLINE_W: ENEMY_OUTLINE_W,
    teleStyle: function (k, s) { const s0 = S; S = s || S || { time: 0 }; try { return teleStyle(k); } finally { S = s0; } } };
})(window.Game = window.Game || {});
