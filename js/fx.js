// fx.js — 粒子、枪口火光、弹壳、命中火花、伤害数字、飘字、爆炸、死亡碎裂、连锁闪电、震屏、全屏闪光（render 助手 a06）
// 只用自己的状态（可用 Math.random），绝不修改 S。加载时不碰 DOM。
(function (G) {
  'use strict';
  const MAXP = 600, MAXT = 60, TAU = Math.PI * 2;
  const P = [];           // 粒子池（预分配）
  let np = 0;
  const texts = [], bolts = [], decals = [], timers = [];
  let trauma = 0, flashA = 0, flashMax = 0.0001, flashCol = '#ffffff', hurtA = 0, hurtCol = '255,0,68';
  let clock = 0, lastP = { x: 380, y: 220 }, beamT = 0, eshootT = 0, bhitT = 0, inited = false;
  const typeCol = {};     // 敌人类型主色缓存

  const rnd = (a, b) => a + Math.random() * (b - a);
  function font(sz) { return 'bold ' + sz + 'px ' + (G.FONT || '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif'); }
  function shakeOn() { return !G.settings || G.settings.shake !== false; }
  function numOn() { return !G.settings || G.settings.dmgNumbers !== false; }

  for (let i = 0; i < MAXP; i++) P.push({});
  // type: 0 方块 1 火花线 2 圆环 3 精灵碎片 4 烟 5 弹壳 6 枪口火光 7 火球 8 斩击弧 9 光斑
  function part(type, x, y, o) {
    let q;
    if (np < MAXP) q = P[np++];
    else q = P[(Math.random() * MAXP) | 0];  // 满了随机覆盖一个
    q.type = type; q.x = x; q.y = y; q.z = o.z || 0;
    q.vx = o.vx || 0; q.vy = o.vy || 0; q.vz = o.vz || 0;
    q.life = q.max = o.life || 0.5; q.size = o.size || 2; q.size1 = o.size1 !== undefined ? o.size1 : q.size;
    q.color = o.color || '#ffffff'; q.drag = o.drag !== undefined ? o.drag : 3; q.grav = o.grav || 0;
    q.ang = o.ang || 0; q.vr = o.vr || 0; q.arc = o.arc || 0; q.img = o.img || null;
    q.sx = o.sx || 0; q.sy = o.sy || 0; q.sw = o.sw || 0; q.sh = o.sh || 0; q.sc = o.sc || 2;
    q.alpha = o.alpha !== undefined ? o.alpha : 1; q.c2 = o.c2 || null;
    return q;
  }
  function burst(x, y, n, o) {
    for (let i = 0; i < n; i++) {
      const a = o.ang !== undefined ? o.ang + rnd(-(o.spread || Math.PI), o.spread || Math.PI) : rnd(0, TAU);
      const s = rnd(o.s0 || 40, o.s1 || 160);
      const c = Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : o.color;
      part(o.type || 0, x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(o.l0 || 0.25, o.l1 || 0.5), size: rnd(o.z0 || 2, o.z1 || 4), size1: o.size1, color: c, drag: o.drag, grav: o.grav, vz: o.vz ? rnd(o.vz * 0.5, o.vz) : 0 });
    }
  }
  function addShake(a) { trauma = Math.min(1, trauma + a); }
  function flash(col, a, dur) { if (a >= flashA) { flashCol = col; flashA = a; flashMax = Math.max(0.0001, dur); } }
  function later(t, fn) { timers.push({ t: t, fn: fn }); }

  // ---------- 飘字 ----------
  function addText(x, y, text, color, size, o) {
    o = o || {};
    if (texts.length >= MAXT) texts.shift();
    const t = { x: x + (o.jit ? rnd(-6, 6) : 0), y: y, vy: o.vy !== undefined ? o.vy : -50, text: String(text), color: color || '#ffffff', size: Math.max(14, size || 16),
      life: o.life || 0.8, max: o.life || 0.8, crit: !!o.crit, id: o.id, val: o.val, kind: o.kind, pop: o.pop || 0.12, age: 0 };
    texts.push(t);
    return t;
  }
  function fmtDmg(v) { return v >= 10 || v === Math.round(v) ? String(Math.round(v)) : v.toFixed(1); }

  // ---------- 敌人主色（从精灵采样一次） ----------
  function sprName(type, boss) { return (boss ? 'boss_' : 'enemy_') + type; }
  function colorOf(type, boss) {
    if (typeCol[type]) return typeCol[type];
    let c = '#e43b44';
    try {
      const cv = G.Sprites && G.Sprites.get(sprName(type, boss), 'idle0');
      if (cv && cv.getContext) {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, cnt = {};
        let best = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue;
          const lum = d[i] + d[i + 1] + d[i + 2];
          if (lum < 120 || lum > 690) continue;  // 跳过描边与高光
          const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
          cnt[k] = (cnt[k] || 0) + 1;
          if (cnt[k] > best) { best = cnt[k]; c = 'rgb(' + d[i] + ',' + d[i + 1] + ',' + d[i + 2] + ')'; }
        }
      }
    } catch (e) { /* 采样失败用默认色 */ }
    typeCol[type] = c;
    return c;
  }

  // ---------- 死亡碎裂 ----------
  function shatter(d) {
    const name = sprName(d.type, d.boss);
    let cv = null;
    try { cv = G.Sprites && (G.Sprites.get(name, 'hurt') || G.Sprites.get(name, 'idle0')); } catch (e) { cv = null; }
    const col = colorOf(d.type, d.boss), r = d.r || 14;
    const sc = G.PX || 2;
    if (cv && cv.width) {
      const cell = d.boss ? 6 : 3, flip = d.face !== undefined && Math.cos(d.face) < 0;
      const w = cv.width, h = cv.height;
      for (let sy = 0; sy < h; sy += cell) for (let sx = 0; sx < w; sx += cell) {
        const ox = (sx + cell / 2 - w / 2) * sc * (flip ? -1 : 1), oy = (sy + cell / 2 - h / 2) * sc;
        const a = Math.atan2(oy, ox) + rnd(-0.4, 0.4), s = rnd(60, 190) * (d.boss ? 1.4 : 1);
        part(3, d.x + ox, d.y + oy, { img: cv, sx: sx, sy: sy, sw: Math.min(cell, w - sx), sh: Math.min(cell, h - sy), sc: sc,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(60, 160), grav: 420, life: rnd(0.45, 0.8) * (d.boss ? 1.6 : 1), drag: 2.5, vr: rnd(-10, 10), ang: 0 });
      }
    }
    part(9, d.x, d.y, { size: r * 1.2, size1: r * 2.6, life: 0.16, color: '#ffffff' });
    part(2, d.x, d.y, { size: r * 0.8, size1: r * 2.8, life: 0.25, color: col });
    burst(d.x, d.y, d.elite ? 18 : 10, { color: [col, '#ffffff', col], s0: 50, s1: 220, l0: 0.25, l1: 0.55, z0: 2, z1: 5, drag: 4 });
    if (d.elite) { addShake(0.25); part(2, d.x, d.y, { size: r, size1: r * 4.5, life: 0.4, color: '#feae34' }); }
  }
  function bossDeath(d) {
    addShake(0.9); flash('#ffffff', 0.85, 0.7);
    for (let i = 0; i < 9; i++) {
      later(i * 0.14, function () {
        const x = d.x + rnd(-40, 40), y = d.y + rnd(-40, 40);
        fireball(x, y, rnd(26, 46), false);
        addShake(0.3);
      });
    }
    later(1.3, function () { shatter(d); fireball(d.x, d.y, 90, false); addShake(1); flash('#ffffff', 0.7, 0.6); });
  }

  // ---------- 爆炸 ----------
  function fireball(x, y, rad, big) {
    rad = rad || 40;
    part(9, x, y, { size: rad * 0.5, size1: rad * 1.1, life: 0.12, color: '#ffffff' });
    for (let i = 0; i < 7; i++) {
      const a = rnd(0, TAU), d = rnd(0, rad * 0.45);
      part(7, x + Math.cos(a) * d, y + Math.sin(a) * d, { size: rad * rnd(0.25, 0.45), size1: rad * rnd(0.5, 0.75), life: rnd(0.3, 0.5), vx: Math.cos(a) * 40, vy: Math.sin(a) * 40 - 20, drag: 3 });
    }
    part(2, x, y, { size: rad * 0.4, size1: rad * 1.25, life: 0.28, color: '#fee761' });
    burst(x, y, big ? 22 : 14, { type: 1, color: ['#fee761', '#feae34', '#f77622'], s0: 120, s1: 380, l0: 0.2, l1: 0.45, z0: 2, z1: 3, drag: 3 });
    for (let i = 0; i < 5; i++) part(4, x + rnd(-rad, rad) * 0.4, y + rnd(-rad, rad) * 0.4, { size: rad * 0.3, size1: rad * 0.7, life: rnd(0.6, 1.1), vy: -rnd(10, 30), color: '#3a4466', alpha: 0.55, drag: 1 });
    decal(x, y, rad * 0.8, 'scorch');
  }
  function decal(x, y, r, kind) {
    if (decals.length > 24) decals.shift();
    decals.push({ x: x, y: y, r: r, kind: kind, life: 8, max: 8, seed: Math.random() * 100 });
  }

  // ---------- 事件处理 ----------
  const KCOL = { ranger: '#63c74d', mage: '#2ce8f5', knight: '#feae34', alchemist: '#b55088' };
  function wcolor(wid) { const w = G.WEAPONS && G.WEAPONS[wid]; return (w && w.color) || '#fee761'; }
  function onShoot(d) {
    const ang = d.ang || 0, k = d.kind || 'gun';
    let x = d.x, y = d.y;
    if (k !== 'drone' && Math.hypot(x - lastP.x, y - lastP.y) < 26) { x = lastP.x + Math.cos(ang) * 28; y = lastP.y + 4 + Math.sin(ang) * 26; }
    const col = wcolor(d.wid);
    if (k === 'flame') { burst(x, y, 2, { ang: ang, spread: 0.3, color: ['#feae34', '#f77622'], s0: 80, s1: 160, l0: 0.15, l1: 0.3, z0: 2, z1: 4 }); return; }
    if (k === 'beam' || k === 'melee') return;
    const big = k === 'charge' || d.wid === 'shotgun' || d.wid === 'rocket' || d.wid === 'railgun';
    part(6, x, y, { ang: ang, size: big ? 16 : 10, life: big ? 0.08 : 0.055, color: col });
    burst(x, y, big ? 4 : 2, { type: 1, ang: ang, spread: 0.5, color: ['#ffffff', col], s0: 120, s1: 260, l0: 0.06, l1: 0.14, z0: 1, z1: 2, drag: 6 });
    if (k === 'gun' && !(G.WEAPONS && G.WEAPONS[d.wid] && /wand|staff|scatter|bouncer|void/.test(d.wid))) {
      const n = d.wid === 'shotgun' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const pa = ang + Math.PI / 2 * (Math.cos(ang) >= 0 ? -1 : 1) + rnd(-0.4, 0.4);
        part(5, d.x, d.y, { vx: Math.cos(pa) * rnd(50, 90) - Math.cos(ang) * 20, vy: Math.sin(pa) * rnd(50, 90), vz: rnd(70, 120), grav: 500, life: 1.4, drag: 1.5, vr: rnd(-20, 20), color: d.wid === 'shotgun' ? '#e43b44' : '#feae34', size: 2 });
      }
    }
  }
  function onHit(d) {
    const crit = !!d.crit, burnK = d.kind === 'burn' || d.kind === 'poison';
    if (!burnK) burst(d.x, d.y, crit ? 7 : 4, { type: 1, color: crit ? ['#fee761', '#ffffff'] : ['#ffffff', '#fee761'], s0: 90, s1: 240, l0: 0.08, l1: 0.18, z0: 1, z1: 2, drag: 5 });
    if (crit) part(2, d.x, d.y, { size: 4, size1: 18, life: 0.14, color: '#fee761' });
    if (!numOn() || !(d.dmg > 0)) return;
    // 同一敌人短时间内的非暴击数字合并
    if (!crit) {
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        if (t.id !== undefined && t.id === d.id && !t.crit && t.kind === (burnK ? d.kind : 'n') && t.age < (burnK ? 0.6 : 0.16)) {
          t.val += d.dmg; t.text = fmtDmg(t.val); t.age = Math.min(t.age, 0.05); t.life = t.max; return;
        }
      }
    }
    if (crit) addText(d.x, d.y - 14, fmtDmg(d.dmg) + '!', '#fee761', 22, { crit: true, id: d.id, val: d.dmg, life: 0.9, vy: -70, jit: true, kind: 'c', pop: 0.15 });
    else if (burnK) addText(d.x, d.y - 12, fmtDmg(d.dmg), d.kind === 'burn' ? '#f77622' : '#63c74d', 14, { id: d.id, val: d.dmg, life: 0.7, vy: -35, jit: true, kind: d.kind });
    else addText(d.x, d.y - 12, fmtDmg(d.dmg), '#ffffff', 16, { id: d.id, val: d.dmg, life: 0.7, vy: -55, jit: true, kind: 'n' });
  }
  function onKill(d) {
    if (d.boss) { bossDeath(d); return; }
    shatter(d);
    if (d.summon) return;
    addShake(0.08);
  }

  function subscribe() {
    if (!G.on) return;
    const on = function (t, fn) { G.on(t, function (d) { try { fn(d || {}); } catch (e) { /* 表现层异常吞掉 */ } }); };
    on('shoot', onShoot);
    on('melee', function (d) {
      const a = d.ang || 0, arc = d.arc || 1.6, rg = d.range || 50;
      for (let i = 0; i < 6; i++) { const aa = a + rnd(-arc / 2, arc / 2); part(1, d.x + Math.cos(aa) * rg * 0.8, d.y + Math.sin(aa) * rg * 0.8, { vx: Math.cos(aa) * 120, vy: Math.sin(aa) * 120, life: 0.15, size: 2, color: '#ffffff', drag: 6 }); }
      if (d.cut > 0) {
        // 斩弹：金色火花 + 小震屏
        for (let i = 0; i < Math.min(6, d.cut); i++) { const aa = a + rnd(-arc / 2, arc / 2), rr = rnd(0.4, 1) * rg; burst(d.x + Math.cos(aa) * rr, d.y + Math.sin(aa) * rr, 4, { type: 1, color: ['#fee761', '#ffffff'], s0: 100, s1: 260, l0: 0.08, l1: 0.18, z0: 1, z1: 2 }); }
        addShake(0.1);
      }
    });
    on('beam', function (d) {
      if (clock - beamT < 0.05) return; beamT = clock;
      burst(d.x2, d.y2, 3, { type: 1, color: [wcolor(d.wid), '#ffffff'], s0: 80, s1: 200, l0: 0.08, l1: 0.18, z0: 1, z1: 2 });
    });
    on('ehit', onHit);
    on('ekill', onKill);
    on('eshoot', function (d) {
      if (clock - eshootT < 0.03) return; eshootT = clock;
      part(2, d.x, d.y, { size: 4, size1: 14, life: 0.12, color: '#ff0044' });
    });
    on('phurt', function (d) {
      if (d.shield) {
        hurtA = Math.max(hurtA, 0.35); hurtCol = '192,203,220';
        part(2, d.x, d.y, { size: 10, size1: 34, life: 0.3, color: '#c0cbdc' });
        burst(d.x, d.y, 10, { type: 1, color: ['#c0cbdc', '#ffffff'], s0: 100, s1: 220, l0: 0.15, l1: 0.3, z0: 1, z1: 2 });
        addShake(0.3);
      } else {
        hurtA = 1; hurtCol = '255,0,68';
        burst(d.x, d.y, 12, { color: ['#e43b44', '#a22633', '#ff0044'], s0: 60, s1: 200, l0: 0.3, l1: 0.6, z0: 2, z1: 4 });
        addShake(0.5);
      }
    });
    on('pdodge', function (d) {
      const dx = d.dx || 0, dy = d.dy || 0;
      for (let i = 0; i < 6; i++) part(4, d.x - dx * rnd(0, 12) + rnd(-6, 6), d.y + 8 + rnd(-3, 3), { size: rnd(3, 5), size1: rnd(7, 11), life: rnd(0.3, 0.5), vx: -dx * rnd(20, 60) + rnd(-20, 20), vy: -dy * rnd(20, 60) - 10, color: '#c0cbdc', alpha: 0.5, drag: 4 });
    });
    on('pickup', function (d) {
      const col = d.color || '#fee761';
      burst(d.x, d.y, d.kind === 'coin' ? 4 : 8, { color: [col, '#ffffff'], s0: 30, s1: 110, l0: 0.25, l1: 0.5, z0: 1, z1: 3, grav: -60 });
      if (d.text) addText(d.x, d.y - 18, d.text, col, d.kind === 'coin' ? 14 : 16, { life: 1.0, vy: -40 });
    });
    on('heal', function (d) {
      for (let i = 0; i < 10; i++) part(0, d.x + rnd(-14, 14), d.y + rnd(-6, 14), { vy: -rnd(30, 70), life: rnd(0.5, 0.9), size: rnd(2, 4), size1: 0, color: i % 3 ? '#63c74d' : '#ffffff', drag: 1 });
      part(2, d.x, d.y, { size: 8, size1: 30, life: 0.35, color: '#63c74d' });
    });
    on('explode', function (d) {
      const rad = d.rad || 50;
      fireball(d.x, d.y, rad, rad > 70);
      addShake(Math.min(0.8, 0.2 + rad / 160));
    });
    on('propbreak', function (d) {
      const cols = d.kind === 'barrel' ? ['#be4a2f', '#733e39', '#3e2731'] : ['#b86f50', '#733e39', '#e4a672'];
      burst(d.x, d.y, 12, { color: cols, s0: 60, s1: 200, l0: 0.4, l1: 0.8, z0: 2, z1: 5, drag: 4 });
      for (let i = 0; i < 3; i++) part(4, d.x + rnd(-10, 10), d.y + rnd(-10, 10), { size: 5, size1: 12, life: 0.5, color: '#8b9bb4', alpha: 0.4, vy: -15 });
      addShake(0.12);
    });
    on('strike', function (d) {
      const rad = d.rad || 40, hot = d.kind === 'meteor' || d.kind === 'lava';
      part(2, d.x, d.y, { size: rad * 0.5, size1: rad * 1.3, life: 0.3, color: hot ? '#feae34' : '#c0cbdc' });
      for (let i = 0; i < 8; i++) { const a = rnd(0, TAU); part(4, d.x + Math.cos(a) * rad * 0.7, d.y + Math.sin(a) * rad * 0.7, { size: 5, size1: 13, life: rnd(0.4, 0.7), vx: Math.cos(a) * 50, vy: Math.sin(a) * 50, color: hot ? '#733e39' : '#8b9bb4', alpha: 0.5, drag: 3 }); }
      burst(d.x, d.y, 8, { color: hot ? ['#feae34', '#f77622', '#be4a2f'] : ['#8b9bb4', '#5a6988'], s0: 80, s1: 220, l0: 0.3, l1: 0.6, z0: 2, z1: 4, vz: 120, grav: 400 });
      if (hot) fireball(d.x, d.y, rad * 0.7, false);
      else decal(d.x, d.y, rad * 0.6, 'crack');
      addShake(0.28);
    });
    on('roomenter', function () { A.clear(); });
    on('floor', function () { A.clear(); flash('#000000', 0.9, 0.6); });
    on('roomclear', function () {
      flash('#fee761', 0.18, 0.5);
      part(2, lastP.x, lastP.y, { size: 10, size1: 160, life: 0.6, color: '#fee761' });
    });
    on('relic', function () { part(2, lastP.x, lastP.y, { size: 8, size1: 50, life: 0.5, color: '#b55088' }); burst(lastP.x, lastP.y, 16, { color: ['#b55088', '#fee761', '#ffffff'], s0: 60, s1: 180, l0: 0.4, l1: 0.8, grav: -80 }); });
    on('synergy', function () {
      flash('#2ce8f5', 0.18, 0.5);
      for (let i = 0; i < 3; i++) later(i * 0.1, function () { part(2, lastP.x, lastP.y, { size: 10, size1: 80, life: 0.45, color: i === 1 ? '#fee761' : '#2ce8f5' }); });
    });
    on('weapon', function () { burst(lastP.x, lastP.y, 8, { color: ['#ffffff', '#fee761'], s0: 40, s1: 120, l0: 0.2, l1: 0.4 }); });
    on('skill', function (d) {
      const c = KCOL[d.cid] || '#2ce8f5', x = d.x !== undefined ? d.x : lastP.x, y = d.y !== undefined ? d.y : lastP.y;
      part(2, x, y, { size: 10, size1: 90, life: 0.4, color: c });
      part(9, x, y, { size: 20, size1: 50, life: 0.2, color: c, alpha: 0.5 });
      burst(x, y, 16, { color: [c, '#ffffff'], s0: 80, s1: 240, l0: 0.25, l1: 0.5 });
      addShake(0.15);
    });
    on('bossintro', function () { addShake(0.35); });
    on('bossphase', function () { flash('#ffffff', 0.9, 0.7); addShake(0.85); part(2, lastP.x, lastP.y, { size: 20, size1: 400, life: 0.7, color: '#ffffff' }); });
    on('shake', function (d) { addShake(Math.min(1, (d.amt || 4) / 12)); });
    on('text', function (d) { addText(d.x, d.y, d.text, d.color || '#ffffff', d.size || 16, { life: 1.0, vy: -35 }); });
    on('chain', function (d) {
      if (!d.pts || d.pts.length < 2) return;
      const pts = d.pts.map(function (p) { return [p[0], p[1]]; });
      const col = d.color || '#2ce8f5';
      bolts.push({ pts: pts, life: 0.15, max: 0.15, seed: Math.random(), color: col });
      if (bolts.length > 20) bolts.shift();
      for (let i = 1; i < pts.length; i++) burst(pts[i][0], pts[i][1], 3, { type: 1, color: [col, '#ffffff'], s0: 60, s1: 160, l0: 0.08, l1: 0.16, z0: 1, z1: 2 });
    });
    on('bhit', function (d) {
      if (clock - bhitT < 0.012) return; bhitT = clock;
      burst(d.x, d.y, d.own === 'e' ? 3 : 4, { type: 1, color: [d.color || '#fee761', '#ffffff'], s0: 60, s1: 170, l0: 0.06, l1: 0.15, z0: 1, z1: 2, drag: 6 });
      if (d.own !== 'e') part(9, d.x, d.y, { size: 4, size1: 7, life: 0.06, color: d.color || '#fee761', alpha: 0.7 });
    });
    on('shieldup', function (d) {
      const x = d.x !== undefined ? d.x : lastP.x, y = d.y !== undefined ? d.y : lastP.y;
      part(2, x, y, { size: 26, size1: 12, life: 0.35, color: '#c0cbdc' });
      burst(x, y, 6, { color: ['#c0cbdc', '#ffffff'], s0: 20, s1: 60, l0: 0.25, l1: 0.45, z0: 1, z1: 2, grav: -60 });
    });
    on('buy', function () { burst(lastP.x, lastP.y - 10, 8, { color: ['#feae34', '#fee761'], s0: 40, s1: 120, l0: 0.3, l1: 0.5, grav: -50 }); });
  }

  // ---------- 更新 ----------
  function update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    clock += dt;
    for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; tm.t -= dt; if (tm.t <= 0) { timers.splice(i, 1); try { tm.fn(); } catch (e) { /* */ } } }
    for (let i = 0; i < np; i++) {
      const q = P[i];
      q.life -= dt;
      if (q.life <= 0) { const t = P[np - 1]; P[np - 1] = q; P[i] = t; np--; i--; continue; }
      const dr = Math.max(0, 1 - q.drag * dt);
      q.vx *= dr; q.vy *= dr;
      if (q.type === 3 || q.type === 5 || (q.vz && q.grav > 0)) {
        q.vz -= q.grav * dt; q.z += q.vz * dt;
        if (q.z < 0) { q.z = 0; q.vz = -q.vz * 0.35; q.vx *= 0.6; q.vy *= 0.6; q.vr *= 0.5; if (Math.abs(q.vz) < 20) q.vz = 0; }
      } else if (q.grav) q.vy += q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.ang += q.vr * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i]; t.age += dt; t.life -= dt; t.y += t.vy * dt; t.vy *= Math.max(0, 1 - 2.5 * dt);
      if (t.life <= 0) texts.splice(i, 1);
    }
    for (let i = bolts.length - 1; i >= 0; i--) { bolts[i].life -= dt; if (bolts[i].life <= 0) bolts.splice(i, 1); }
    for (let i = decals.length - 1; i >= 0; i--) { decals[i].life -= dt; if (decals[i].life <= 0) decals.splice(i, 1); }
    trauma = Math.max(0, trauma - dt * 1.7);
    flashA = Math.max(0, flashA - dt * (1 / flashMax) * 0.9);
    hurtA = Math.max(0, hurtA - dt * 2.2);
  }

  // ---------- 绘制 ----------
  function drawGround(ctx) {
    for (const d of decals) {
      const a = Math.min(1, d.life / 2) * (d.kind === 'scorch' ? 0.35 : 0.3);
      ctx.globalAlpha = a; ctx.fillStyle = '#181425';
      if (d.kind === 'scorch') {
        ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 0.75, 0, 0, TAU); ctx.fill();
      } else {
        ctx.strokeStyle = '#181425'; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a2 = d.seed + i * 1.05; ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(a2) * d.r, d.y + Math.sin(a2) * d.r * 0.8); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // 落地的弹壳也画在地面层
    for (let i = 0; i < np; i++) { const q = P[i]; if (q.type === 5 && q.z <= 0.5) drawPart(ctx, q); }
  }
  function drawPart(ctx, q) {
    const k = q.life / q.max, sz = q.size1 + (q.size - q.size1) * k;
    switch (q.type) {
      case 0: ctx.globalAlpha = q.alpha * Math.min(1, k * 2.5); ctx.fillStyle = q.color; ctx.fillRect(q.x - sz / 2, q.y - q.z - sz / 2, sz, sz); break;
      case 1: {
        ctx.globalAlpha = Math.min(1, k * 2); ctx.strokeStyle = q.color; ctx.lineWidth = q.size;
        const l = 0.035; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * l, q.y - q.vy * l); ctx.stroke(); break;
      }
      case 2: ctx.globalAlpha = q.alpha * k; ctx.strokeStyle = q.color; ctx.lineWidth = Math.max(1, 4 * k); ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.5, sz), 0, TAU); ctx.stroke(); break;
      case 3: {
        ctx.globalAlpha = Math.min(1, k * 2); const w = q.sw * q.sc, h = q.sh * q.sc;
        ctx.save(); ctx.translate(q.x, q.y - q.z); ctx.rotate(q.ang);
        ctx.drawImage(q.img, q.sx, q.sy, q.sw, q.sh, -w / 2, -h / 2, w, h); ctx.restore(); break;
      }
      case 4: ctx.globalAlpha = q.alpha * k; ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.5, sz), 0, TAU); ctx.fill(); break;
      case 5: {
        ctx.globalAlpha = Math.min(1, q.life * 2); ctx.fillStyle = q.color;
        ctx.save(); ctx.translate(q.x, q.y - q.z); ctx.rotate(q.ang); ctx.fillRect(-2, -1, 4, 2); ctx.restore(); break;
      }
      case 6: {
        ctx.globalAlpha = 1; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.ang);
        const s = q.size * (0.6 + 0.4 * k);
        ctx.fillStyle = q.color; ctx.beginPath(); ctx.moveTo(-2, -s * 0.45); ctx.lineTo(s * 1.3, 0); ctx.lineTo(-2, s * 0.45); ctx.lineTo(s * 0.2, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, s * 0.35, 0, TAU); ctx.fill();
        ctx.fillRect(-1, -s * 0.8, 2, s * 1.6); ctx.restore(); break;
      }
      case 7: {
        const c = k > 0.75 ? '#fee761' : k > 0.5 ? '#feae34' : k > 0.25 ? '#f77622' : '#be4a2f';
        ctx.globalAlpha = Math.min(1, k * 2.2); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.5, sz), 0, TAU); ctx.fill(); break;
      }
      case 9: ctx.globalAlpha = q.alpha * k * 0.8; ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.5, sz), 0, TAU); ctx.fill(); break;
      default: break;
    }
  }
  function drawWorld(ctx, S) {
    try {
      if (S && S.p) { lastP.x = S.p.x; lastP.y = S.p.y; }
      ctx.save();
      for (let i = 0; i < np; i++) { const q = P[i]; if (!(q.type === 5 && q.z <= 0.5)) drawPart(ctx, q); }
      ctx.globalAlpha = 1;
      // 连锁闪电
      if (bolts.length) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const b of bolts) {
          const k = b.life / b.max, path = [];
          for (let i = 0; i < b.pts.length - 1; i++) {
            const a = b.pts[i], c = b.pts[i + 1], dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
            const seg = Math.max(2, Math.round(len / 18));
            if (i === 0) path.push(a);
            for (let j = 1; j < seg; j++) { const t = j / seg, o = rnd(-9, 9); path.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o]); }
            path.push(c);
          }
          for (let pass = 0; pass < 2; pass++) {
            ctx.globalAlpha = pass ? k : k * 0.5; ctx.strokeStyle = pass ? '#ffffff' : (b.color || '#2ce8f5'); ctx.lineWidth = pass ? 2 : 6;
            ctx.beginPath(); ctx.moveTo(path[0][0], path[0][1]); for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]); ctx.stroke();
          }
        }
      }
      ctx.restore();
    } catch (e) { try { ctx.restore(); } catch (e2) { /* */ } }
  }
  function drawTexts(ctx) {
    if (!texts.length) return;
    try {
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for (const t of texts) {
        const k = t.life / t.max;
        const pop = t.age < t.pop ? 1 + (1 - t.age / t.pop) * (t.crit ? 0.6 : 0.35) : 1;
        const sz = Math.max(14, Math.round(t.size * pop));
        ctx.globalAlpha = Math.min(1, k * 3.3);
        ctx.font = font(sz);
        ctx.lineWidth = t.crit ? 4 : 3; ctx.strokeStyle = t.crit ? '#5a1a1a' : '#181425';
        const x = Math.round(t.x), y = Math.round(t.y);
        ctx.strokeText(t.text, x, y);
        ctx.fillStyle = t.color; ctx.fillText(t.text, x, y);
      }
      ctx.restore();
    } catch (e) { try { ctx.restore(); } catch (e2) { /* */ } }
  }
  let vgCache = null, vgKey = '';
  function drawScreen(ctx, S) {
    try {
      const W = G.VW || 960, H = G.VH || 540;
      let a = hurtA * 0.55, col = hurtCol;
      // 低血量心跳暗角
      const p = S && S.p;
      if (p && S.state === 'play' && p.hp > 0 && p.hp <= 2 && p.maxHp > 2) {
        const hb = 0.18 + 0.12 * Math.max(0, Math.sin(clock * 6));
        if (hb > a) { a = hb; col = '255,0,68'; }
      }
      if (a > 0.01) {
        const key = col;
        if (!vgCache || vgKey !== key) {
          vgCache = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
          vgCache.addColorStop(0, 'rgba(' + col + ',0)'); vgCache.addColorStop(1, 'rgba(' + col + ',1)'); vgKey = key;
        }
        ctx.save(); ctx.globalAlpha = Math.min(0.75, a); ctx.fillStyle = vgCache; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
      if (flashA > 0.01) { ctx.save(); ctx.globalAlpha = Math.min(1, flashA); ctx.fillStyle = flashCol; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    } catch (e) { /* */ }
  }
  function shake() {
    if (!shakeOn() || trauma <= 0.001) return { x: 0, y: 0 };
    const m = 14 * trauma * trauma, t = clock * 40;
    return { x: Math.round((Math.sin(t * 1.3) * 0.6 + rnd(-0.4, 0.4)) * m), y: Math.round((Math.cos(t * 1.7) * 0.6 + rnd(-0.4, 0.4)) * m) };
  }
  function clear() {
    np = 0; texts.length = 0; bolts.length = 0; decals.length = 0; timers.length = 0;
  }

  const A = {
    init: function () { if (inited) return; inited = true; try { subscribe(); } catch (e) { /* */ } },
    update: update, clear: clear, drawWorld: drawWorld, drawTexts: drawTexts, drawScreen: drawScreen, drawGround: drawGround, shake: shake,
    // 测试/调试用
    stats: function () { return { parts: np, texts: texts.length, bolts: bolts.length, decals: decals.length, trauma: trauma }; },
    burst: burst, addText: addText
  };
  G.FX = A;
})(window.Game = window.Game || {});
