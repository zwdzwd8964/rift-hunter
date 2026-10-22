// 物品模块：武器开火实现、遗物/协同属性汇总与钩子、掉落挑选、主动道具（模拟层；所有者 items）。
// 只用 S.rng（战斗）/ S.rngLoot（掉落），不碰 DOM，不用系统随机数。
(function (G) {
  'use strict';
  const TAU = Math.PI * 2;
  const IH = G.IH = {};
  const STAT_KEYS = ['dmgMul', 'rateMul', 'spdMul', 'bulletSpd', 'bulletSize', 'multi', 'pierce', 'bounce', 'homing', 'crit', 'critMul',
    'dodgeCdMul', 'skillCdMul', 'maxHp', 'shieldMax', 'shieldRegen', 'energyMax', 'energyRegen', 'goldMul', 'magnet', 'luck',
    'burnChance', 'burnDps', 'poisonChance', 'poisonDps', 'chillChance', 'freezeBonus', 'lifesteal', 'thorns', 'knock', 'shopDiscount'];
  G.ITEM_STAT_KEYS = STAT_KEYS;

  // ---------------- 通用小工具 ----------------
  const ST = (p) => p.st || {};
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  function alive(e) { return e && !e.dead && e.hp > 0 && !(e.spawnT > 0) && !e.air && !e.hidden; }
  function hasStatus(e, k) {
    const s = e && e.status && e.status[k]; if (!s) return false;
    return typeof s === 'number' ? s > 0 : (s.t || 0) > 0;
  }
  function solidAt(S, x, y, r) {
    if (!S.room) return false;
    if (G.hitsSolid) return G.hitsSolid(S.room, x, y, r || 2, 'b');
    return x < 0 || y < 0 || x > G.RW || y > G.RH;
  }
  function hurt(S, e, dmg, o) { if (G.hurtEnemy && e) G.hurtEnemy(S, e, dmg, o); }
  function spawn(S, b) {
    if (G.spawnBullet) return G.spawnBullet(S, b);
    S.bullets.push(b); return b;
  }
  function deny(S, p, reason) {
    if ((p._denyT || 0) > S.time) return;
    p._denyT = (S.time || 0) + 0.8;
    G.emit('deny', { reason: reason });
    if (reason === 'energy') S.toast = { text: '能量不足', t: 1 };
  }
  function pay(S, p, cost) {
    if (!(cost > 0)) return true;
    if (num(p.energy, 0) >= cost) { p.energy -= cost; return true; }
    deny(S, p, 'energy'); return false;
  }
  function relicN(p, id) { const r = p.relics && p.relics[id]; const d = G.RELICS[id]; return r ? Math.min(r, d ? d.max : r) : 0; }
  function synTier(p, fam) { return (p.synergies && p.synergies[fam]) || 0; }
  // 动态伤害倍率（黄金神像：每 10 金币 +2%，上限 30%）
  function dynMul(S, p) {
    let m = 1;
    if (relicN(p, 'golden_idol')) m += Math.min(0.3, Math.floor(num(p.gold, 0) / 10) * 0.02);
    return m;
  }
  function baseDmg(S, p, w) { return num(w.dmg, 1) * num(ST(p).dmgMul, 1) * dynMul(S, p); }
  function rollCrit(S, p, w) {
    if (p._sureCrit) { p._sureCrit = 0; return true; }
    const c = num(ST(p).crit, 0.05) + num(w.critAdd, 0) + num(p.buff && p.buff.crit, 0);
    return c > 0 && S.rng.chance(Math.min(0.95, c));
  }
  function critMul(p) { return Math.max(1, num(ST(p).critMul, 2)); }
  // 状态效果：开火时掷好（scale 用于持续伤害型武器降低每跳几率）
  function rollStatus(S, p, w, scale) {
    const st = ST(p), s = {}; let any = false; scale = scale == null ? 1 : scale;
    if (w.burn) { s.burn = [w.burn[0] + num(st.burnDps, 0), w.burn[1]]; any = true; }
    else if (st.burnChance > 0 && S.rng.chance(st.burnChance * scale)) { s.burn = [3 + num(st.burnDps, 0), 3]; any = true; }
    if (st.poisonChance > 0 && S.rng.chance(st.poisonChance * scale)) { s.poison = [2 + num(st.poisonDps, 0), 4]; any = true; }
    const cc = num(st.chillChance, 0) + num(w.chillProc, 0);
    if (cc > 0 && S.rng.chance(Math.min(0.9, cc) * scale)) { s.chill = 1.5; any = true; }
    return any ? s : null;
  }
  function nearestEnemy(S, x, y, maxd, skip) {
    let best = null, bd = maxd;
    for (const e of S.enemies) {
      if (!alive(e) || (skip && skip.indexOf(e) >= 0)) continue;
      const d = Math.hypot(e.x - x, e.y - y) - (e.r || 10);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function muzzle(p, ang, d) { d = d == null ? 16 : d; return { x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d }; }

  // ---------------- 射击类：发射一轮 ----------------
  // opt: {mul 伤害倍率, echo 是否回声, ang}
  function volley(S, p, wid, w, ang, opt) {
    opt = opt || {};
    const st = ST(p), n0 = w.n || 1;
    const m = w.kind === 'flame' ? 0 : Math.max(0, Math.min(4, Math.floor(num(st.multi, 0))));
    const n = n0 + m;
    // 分裂弹平衡：每层总伤害 +35%，由所有子弹平摊（单发武器不会翻倍）
    const share = m > 0 ? (1 + 0.35 * m) * n0 / n : 1;
    const spread = num(w.spread, 0) + (m ? 0.12 * m : 0);
    const dmg0 = baseDmg(S, p, w) * share * (opt.mul || 1);
    const spd = num(w.spd, 400) * num(st.bulletSpd, 1);
    const o = muzzle(p, ang, 16), out = [];
    for (let i = 0; i < n; i++) {
      const jit = S.rng.range(-1, 1) * (n > 1 ? 0.05 : num(w.spread, 0) * 0.5);
      const a = ang + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0) + jit;
      const crit = rollCrit(S, p, w);
      const life = num(w.life, 1) * (w.kind === 'flame' ? S.rng.range(0.85, 1.1) : 1);
      const b = spawn(S, {
        own: 'p', x: o.x, y: o.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        r: num(w.r, 4) * num(st.bulletSize, 1), dmg: dmg0 * (crit ? critMul(p) : 1), life: life, max: life,
        shape: w.shape || 'bolt', color: w.color || '#fee761',
        pierce: num(w.pierce, 0) + Math.floor(num(st.pierce, 0)), bounce: num(w.bounce, 0) + Math.floor(num(st.bounce, 0)),
        homing: num(w.homing, 0) + num(st.homing, 0), explode: num(w.explode, 0) * (w.explode ? Math.sqrt(num(st.bulletSize, 1)) : 0),
        knock: 110 * num(w.knock, 1), crit: crit, status: rollStatus(S, p, w), hit: [], src: wid,
        accel: num(w.accel, 0), bounceDmg: num(w.bounceDmg, 0), lob: null
      });
      if (w.kind === 'flame') { b.special = 'flame'; b.r0 = b.r; }
      else if (w.accel || w.bounceDmg) { b.special = 'mod'; b._bn = b.bounce; b.vmax = spd * 2.4; }
      if (w.shape === 'void') {
        b.special = 'void'; b.pierce = 999; b.bounce = 0; b.homing = 0; b.explode = 0;
        b.tickT = 0; b.boom = num(w.boom, 20) * num(st.dmgMul, 1) * dynMul(S, p) * (opt.mul || 1); b.boomRad = num(w.boomRad, 80);
        b.pull = num(w.pull, 120); b.pullStr = num(w.pullStr, 200);
      }
      out.push(b);
    }
    if (S.stats) S.stats.shots = (S.stats.shots || 0) + 1;
    return { bullets: out, dmg: dmg0 };
  }

  function afterFire(S, p, wid, w, ang, res, echo) {
    G.emit('shoot', { x: p.x + Math.cos(ang) * 18, y: p.y + Math.sin(ang) * 18, ang: ang, wid: wid, kind: w.kind });
    Items.hook(S, 'onFire', { kind: w.kind === 'charge' ? 'gun' : w.kind, wid: wid, w: w, ang: ang, dmg: res ? res.dmg : 0, bullets: res ? res.bullets : [], echo: !!echo });
  }

  function fireRate(p, w) {
    return Math.max(0.1, num(w.rate, 1) * num(ST(p).rateMul, 1) * num(p.buff && p.buff.rate, 1));
  }

  // ---------------- 各类武器 ----------------
  function fireGun(S, p, wid, w, held, dt) {
    let rate = fireRate(p, w);
    if (w.spinUp) {
      p.spin = held ? Math.min(1, num(p.spin, 0) + dt / w.spinUp) : Math.max(0, num(p.spin, 0) - dt / 0.6);
      rate *= 0.25 + 0.75 * p.spin;
    }
    if (!held) return;
    // rogue3 修复（QA M7）：喷火类按“实际射速”分摊，射速遗物不会放大每秒耗能（说明：每秒消耗 cost 能量）
    const cost = w.kind === 'flame' ? num(w.cost, 0) / Math.max(0.1, rate) : num(w.cost, 0);
    let shots = 0;
    while (p.fireCd <= 0 && shots < 3) {
      if (!pay(S, p, cost)) { p.fireCd = 0.1; return; }
      const res = volley(S, p, wid, w, p.aim, null);
      if (w.kind !== 'flame' || (S.steps || 0) % 4 === 0) afterFire(S, p, wid, w, p.aim, res, false);
      else Items.hook(S, 'onFire', { kind: 'flame', wid: wid, w: w, ang: p.aim, dmg: res.dmg, bullets: res.bullets, echo: false });
      p.fireCd += 1 / rate; shots++;
    }
  }

  function fireCharge(S, p, wid, w, held, rawHeld, dt) {
    const st = ST(p);
    if (rawHeld) {
      if (held && p.fireCd <= 0) p.charge = Math.min(1, num(p.charge, 0) + dt * fireRate(p, { rate: 1 }) / num(w.chargeT, 1));
      return;
    }
    // rogue3 修复（QA G4）：翻滚中松手不丢蓄力——保留到翻滚结束，再自动射出
    if (p.rolling > 0 && num(p.charge, 0) >= 0.15) return;
    const k = num(p.charge, 0); p.charge = 0;
    if (k < 0.15) return;
    if (!pay(S, p, num(w.cost, 0))) return;
    const full = k >= 0.999;
    const dmg = G.lerp(num(w.dmg, 1), num(w.dmgFull, w.dmg), k);
    const spd = G.lerp(num(w.spd, 400), num(w.spdFull, w.spd), k);
    const tmp = Object.assign({}, w, { dmg: dmg, spd: spd, pierce: full ? num(w.pierceFull, 0) : 0, knock: num(w.knock, 1) * (0.5 + k) });
    const res = volley(S, p, wid, tmp, p.aim, null);
    for (const b of res.bullets) { b.charged = full; if (full) b.r *= 1.3; }
    afterFire(S, p, wid, w, p.aim, res, false);
    p.fireCd = 0.15;
    if (full) G.emit('shake', { amt: w.dmgFull > 30 ? 5 : 2 });
    void st;
  }

  function fireMelee(S, p, wid, w, held) {
    if (!held || p.fireCd > 0) return;
    if (!pay(S, p, num(w.cost, 0))) { p.fireCd = 0.1; return; }
    const st = ST(p), ang = p.aim;
    const range = num(w.range, 70) * (1 + (num(st.bulletSize, 1) - 1) * 0.5);
    const arc = num(w.arc, 1.8);
    p.swing = { t: 0.18, max: 0.18, ang: ang, arc: arc, range: range };
    p.fireCd = 1 / fireRate(p, w);
    const base = baseDmg(S, p, w);
    const kn = 230 * num(w.knock, 1);   // hurtEnemy 会再乘 st.knock
    let hits = 0;
    for (const e of S.enemies.slice()) {
      if (!alive(e)) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > range + (e.r || 10)) continue;
      if (d > (e.r || 10) && Math.abs(G.angDiff(ang, Math.atan2(e.y - p.y, e.x - p.x))) > arc / 2) continue;
      const crit = rollCrit(S, p, w);
      hurt(S, e, base * (crit ? critMul(p) : 1), { kx: Math.cos(ang) * kn, ky: Math.sin(ang) * kn, crit: crit, kind: 'melee', status: rollStatus(S, p, w), src: wid });
      hits++;
    }
    // 斩弹：删除扇形内的敌弹
    let cut = 0;
    for (const b of S.bullets) {
      if (b.own !== 'e' || b.dead) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d > range + (b.r || 4)) continue;
      if (Math.abs(G.angDiff(ang, Math.atan2(b.y - p.y, b.x - p.x))) > arc / 2 + 0.15) continue;
      b.dead = true; cut++;
    }
    G.emit('melee', { x: p.x, y: p.y, ang: ang, arc: arc, range: range, wid: wid, hits: hits, cut: cut });
    Items.hook(S, 'onFire', { kind: 'melee', wid: wid, w: w, ang: ang, dmg: base, bullets: [], echo: false });
  }

  function beamEnd(S, x, y, ang, range) {
    const step = 6, dx = Math.cos(ang), dy = Math.sin(ang);
    let d = 0;
    while (d < range) { const nx = x + dx * (d + step), ny = y + dy * (d + step); if (solidAt(S, nx, ny, 2)) break; d += step; }
    return { x2: x + dx * d, y2: y + dy * d, len: d };
  }
  function fireBeam(S, p, wid, w, held, dt) {
    if (!held) { p.beam = null; p._beamT = 0; return; }
    if (!pay(S, p, num(w.cost, 0) * dt)) { p.beam = null; return; }
    const ang = p.aim, o = muzzle(p, ang, 14), st = ST(p);
    const end = beamEnd(S, o.x, o.y, ang, num(w.range, 500));
    const width = num(w.width, 8) * num(st.bulletSize, 1);
    p.beam = { x: o.x, y: o.y, x2: end.x2, y2: end.y2, on: true, w: width, color: w.color };
    p._beamT = num(p._beamT, 0) - dt * num(st.rateMul, 1) * num(p.buff && p.buff.rate, 1);
    if (p._beamT > 0) return;
    const tick = num(w.tick, 0.1);
    p._beamT += tick;
    const dmg = num(w.dps, 10) * tick * num(st.dmgMul, 1) * dynMul(S, p);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (const e of S.enemies.slice()) {
      if (!alive(e)) continue;
      const t = (e.x - o.x) * dx + (e.y - o.y) * dy;
      if (t < -(e.r || 10) || t > end.len + (e.r || 10)) continue;
      const pd = Math.abs((e.x - o.x) * dy - (e.y - o.y) * dx);
      if (pd > (e.r || 10) + width / 2) continue;
      const crit = rollCrit(S, p, w);
      hurt(S, e, dmg * (crit ? critMul(p) : 1), { kx: dx * 30, ky: dy * 30, crit: crit, kind: 'beam', status: rollStatus(S, p, w, 0.3), src: wid });
    }
    G.emit('beam', { x: o.x, y: o.y, x2: end.x2, y2: end.y2, wid: wid });
    if (S.stats) S.stats.shots = (S.stats.shots || 0) + 1;
    Items.hook(S, 'onFire', { kind: 'beam', wid: wid, w: w, ang: ang, dmg: dmg, bullets: [], echo: false });
  }

  function fireLob(S, p, wid, w, held, inp) {
    if (!held || p.fireCd > 0) return;
    if (!pay(S, p, num(w.cost, 0))) { p.fireCd = 0.1; return; }
    const st = ST(p);
    let tx = num(inp.ax, p.x + Math.cos(p.aim) * 120), ty = num(inp.ay, p.y + Math.sin(p.aim) * 120);
    let d = Math.hypot(tx - p.x, ty - p.y);
    const range = num(w.range, 260);
    if (d > range) { tx = p.x + (tx - p.x) / d * range; ty = p.y + (ty - p.y) / d * range; d = range; }
    if (d < 30) { tx = p.x + Math.cos(p.aim) * 30; ty = p.y + Math.sin(p.aim) * 30; d = 30; }
    const m = Math.max(0, Math.min(4, Math.floor(num(st.multi, 0))));
    const n = 1 + m, share = m > 0 ? (1 + 0.35 * m) / n : 1;
    const out = [], dmg0 = baseDmg(S, p, w) * share;
    for (let i = 0; i < n; i++) {
      let x2 = tx, y2 = ty;
      if (i > 0) { const a = p.aim + (i - 0.5 - m / 2) * 1.1 + S.rng.range(-0.3, 0.3); x2 += Math.cos(a) * 34; y2 += Math.sin(a) * 34; }
      x2 = G.clamp(x2, G.T + 6, G.RW - G.T - 6); y2 = G.clamp(y2, G.T + 6, G.RH - G.T - 6);
      const dd = Math.hypot(x2 - p.x, y2 - p.y);
      const tfl = Math.max(0.28, dd / (num(w.spd, 400) * num(st.bulletSpd, 1)));
      const crit = rollCrit(S, p, w);
      const b = spawn(S, {
        own: 'p', x: p.x, y: p.y, vx: 0, vy: 0, r: num(w.r, 6), dmg: dmg0 * (crit ? critMul(p) : 1), life: tfl + 1, max: tfl + 1,
        shape: w.shape || 'flask', color: w.color || '#63c74d', pierce: 999, bounce: 0, homing: 0, explode: 0, knock: 0,
        crit: crit, status: rollStatus(S, p, w), hit: [], src: wid,
        lob: { sx: p.x, sy: p.y, tx: x2, ty: y2, h: 26 + dd * 0.22, t: 0, max: tfl }
      });
      b.special = 'lob'; b.z = 0;
      b.boomRad = num(w.explode, 44) * Math.sqrt(num(st.bulletSize, 1));
      b.cloud = w.cloud ? { rad: w.cloud.rad * Math.sqrt(num(st.bulletSize, 1)), t: w.cloud.t, dps: w.cloud.dps * num(st.dmgMul, 1) + num(st.poisonDps, 0) } : null;
      out.push(b);
    }
    p.fireCd = 1 / fireRate(p, w);
    if (S.stats) S.stats.shots = (S.stats.shots || 0) + 1;
    afterFire(S, p, wid, w, p.aim, { bullets: out, dmg: dmg0 }, false);
  }

  function fireChain(S, p, wid, w, held) {
    if (!held || p.fireCd > 0) return;
    if (!pay(S, p, num(w.cost, 0))) { p.fireCd = 0.1; return; }
    p.fireCd = 1 / fireRate(p, w);
    const ang = p.aim, o = muzzle(p, ang, 16), range = num(w.range, 300);
    // 第一个目标：前方锥形内最近、视线可达的敌人
    let first = null, bd = 1e9;
    for (const e of S.enemies) {
      if (!alive(e)) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > range + (e.r || 10)) continue;
      if (Math.abs(G.angDiff(ang, Math.atan2(e.y - p.y, e.x - p.x))) > num(w.cone, 0.5) + Math.atan2(e.r || 10, Math.max(1, d))) continue;
      if (G.lineOfSight && S.room && !G.lineOfSight(S.room, o.x, o.y, e.x, e.y)) continue;
      if (d < bd) { bd = d; first = e; }
    }
    const pts = [[o.x, o.y]];
    const base = baseDmg(S, p, w);
    let dmg = base;
    const hit = [];
    if (first) {
      let cur = first;
      const hops = num(w.chains, 3) + Math.floor(num(ST(p).multi, 0));
      for (let i = 0; cur && i <= hops; i++) {
        hit.push(cur); pts.push([cur.x, cur.y]);
        const crit = rollCrit(S, p, w);
        const ex = cur.x, ey = cur.y;
        hurt(S, cur, dmg * (crit ? critMul(p) : 1), { kx: 0, ky: 0, crit: crit, kind: 'beam', status: rollStatus(S, p, w), src: wid });
        dmg *= num(w.falloff, 0.85);
        cur = nearestEnemy(S, ex, ey, num(w.hop, 140), hit);
      }
    } else {
      const end = beamEnd(S, o.x, o.y, ang, 110);
      pts.push([end.x2, end.y2]);
    }
    G.emit('chain', { pts: pts, wid: wid });
    if (S.stats) S.stats.shots = (S.stats.shots || 0) + 1;
    afterFire(S, p, wid, w, ang, { bullets: [], dmg: base }, false);
  }

  // ---------------- 对外接口 ----------------
  const Items = G.Items = {};

  Items.fire = function (S, p, inp, dt) {
    if (!p) return;
    inp = inp || {};
    dt = dt || G.DT;
    p.fireCd = Math.max(-0.05, num(p.fireCd, 0) - dt);
    if (p.fireCd < 0 && !inp.fire) p.fireCd = 0;
    if (p.swing) { p.swing.t -= dt; if (p.swing.t <= 0) p.swing = null; }
    const wid = p.weapons ? p.weapons[p.wi | 0] : null;
    const w = wid ? G.WEAPONS[wid] : null;
    if (p._wid !== wid) { p._wid = wid; p.charge = 0; p.spin = 0; p.beam = null; p.echoQ = []; }
    if (!w) { p.beam = null; return; }
    // 回声子弹队列
    if (p.echoQ && p.echoQ.length) {
      for (const q of p.echoQ) q.t -= dt;
      const due = p.echoQ.filter(q => q.t <= 0);
      p.echoQ = p.echoQ.filter(q => q.t > 0);
      for (const q of due) {
        if (q.wid !== wid) continue;
        const res = volley(S, p, wid, w, q.ang, { mul: q.mul, echo: true });
        afterFire(S, p, wid, w, q.ang, res, true);
      }
    }
    const playing = !S.state || S.state === 'play';
    const rawHeld = !!inp.fire && playing;
    const held = rawHeld && !(p.rolling > 0);
    switch (w.kind) {
      case 'charge': fireCharge(S, p, wid, w, held, rawHeld, dt); break;
      case 'melee': fireMelee(S, p, wid, w, held); break;
      case 'beam': fireBeam(S, p, wid, w, held, dt); break;
      case 'lob': fireLob(S, p, wid, w, held, inp); break;
      case 'chain': fireChain(S, p, wid, w, held); break;
      default: fireGun(S, p, wid, w, held, dt);
    }
    if (w.kind !== 'beam') p.beam = null;
    if (w.kind !== 'charge') p.charge = 0;
    if (!w.spinUp) p.spin = 0;
  };

  // ---------------- 特殊子弹 ----------------
  Items.bulletTick = function (S, b, dt) {
    if (!b || b.own !== 'p' || !b.special) return false;
    dt = dt || G.DT;
    if (b.special === 'flame') {
      const k = Math.pow(0.08, dt);            // 火焰快速减速、膨胀
      b.vx *= k; b.vy *= k;
      b.r = Math.min(num(b.r0, 7) * 2.4, b.r + 22 * dt);
      return false;
    }
    if (b.special === 'mod') {
      if (b.accel) {
        const sp = Math.hypot(b.vx, b.vy) || 1, ns = Math.min(num(b.vmax, 900), sp + b.accel * dt);
        b.vx *= ns / sp; b.vy *= ns / sp;
      }
      if (b.bounceDmg && b.bounce < num(b._bn, b.bounce)) { b.dmg *= Math.pow(1 + b.bounceDmg, b._bn - b.bounce); }
      b._bn = b.bounce;
      return false;
    }
    if (b.special === 'lob') {
      const L = b.lob; if (!L) { b.dead = true; return true; }
      L.t += dt;
      const k = Math.min(1, L.t / L.max);
      b.x = G.lerp(L.sx, L.tx, k); b.y = G.lerp(L.sy, L.ty, k);
      b.z = 4 * L.h * k * (1 - k);
      b.life = Math.max(0.01, num(b.life, 1) - dt);
      if (k >= 1) {
        b.dead = true; b.z = 0;
        if (G.explode) G.explode(S, L.tx, L.ty, num(b.boomRad, 44), b.dmg, 'p', { status: b.status, crit: b.crit, src: b.src });
        if (b.cloud && G.addHazard) G.addHazard(S, { kind: 'poison', own: 'p', x: L.tx, y: L.ty, rad: b.cloud.rad, t: b.cloud.t, max: b.cloud.t, dps: b.cloud.dps, tick: 0 });
      }
      return true;
    }
    if (b.special === 'void') {
      b.life -= dt;
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      if (b.life <= 0 || solidAt(S, nx, ny, 3)) { voidBoom(S, b); return true; }
      b.x = nx; b.y = ny;
      // 吸附
      const p = S.p;
      for (const e of S.enemies) {
        if (!alive(e)) continue;
        const dx = b.x - e.x, dy = b.y - e.y, d = Math.hypot(dx, dy);
        if (d > num(b.pull, 120) + (e.r || 10) || d < 4) continue;
        const str = num(b.pullStr, 200) * (e.boss ? 0.15 : 1) * (1 - d / (num(b.pull, 120) + 40)) * dt;
        const mx = dx / d * Math.min(d - 2, Math.max(0, str)), my = dy / d * Math.min(d - 2, Math.max(0, str));
        if (G.moveCircle && S.room) G.moveCircle(S.room, e, mx, my, (e.def && e.def.flying) ? 'f' : 'e');
        else { e.x += mx; e.y += my; }
      }
      // 吞噬敌弹
      for (const eb of S.bullets) if (eb.own === 'e' && !eb.dead && Math.hypot(eb.x - b.x, eb.y - b.y) < b.r + 6) eb.dead = true;
      // 接触伤害
      b.tickT = num(b.tickT, 0) - dt;
      if (b.tickT <= 0) {
        b.tickT = 0.2;
        for (const e of S.enemies.slice()) {
          if (!alive(e)) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) > b.r + (e.r || 10) + 10) continue;
          hurt(S, e, b.dmg, { kx: 0, ky: 0, crit: b.crit, kind: 'bullet', src: b.src, status: b.status });
        }
      }
      void p;
      return true;
    }
    return false;
  };
  function voidBoom(S, b) {
    b.dead = true;
    if (G.explode) G.explode(S, b.x, b.y, num(b.boomRad, 80), num(b.boom, 20), 'p', { src: b.src, kind: 'void' });
    G.emit('shake', { amt: 4 });
  }

  // ---------------- 钩子 ----------------
  // rogue3 修复（QA G1）：受伤钩子（onHurt）不再受“其他钩子深度”限制——在爆炸/燃烧等钩子内受到的伤害也能触发
  // 凤凰之羽、荆棘甲、护盾协同；只禁止 onHurt 内再嵌套 onHurt（受伤后有无敌帧，本来也不会再受伤）。
  let depth = 0, hurtDepth = 0;
  const LIMIT = { onHit: 0, onFire: 0, onKill: 2 };
  function relicIds(p) {
    const seen = {}, out = [];
    const src = (p.relicOrder && p.relicOrder.length) ? p.relicOrder.concat(Object.keys(p.relics || {})) : Object.keys(p.relics || {});
    for (const id of src) { if (seen[id] || !(p.relics[id] > 0) || !G.RELICS[id]) continue; seen[id] = 1; out.push(id); }
    return out;
  }
  Items.hook = function (S, name, ctx) {
    const p = S && S.p; if (!p) return;
    ctx = ctx || {};
    if (name === 'onHit' && ctx.e) ctx.e._lastCrit = !!ctx.crit;
    const isHurt = name === 'onHurt';
    if (isHurt ? hurtDepth > 0 : (LIMIT[name] !== undefined && depth > LIMIT[name])) return;
    depth++; if (isHurt) hurtDepth++;
    try {
      // 内置：主动道具充能 / 无人机
      if (name === 'onRoomClear' && p.active && G.ACTIVES[p.active.id]) {
        const mx = num(p.active.max, G.ACTIVES[p.active.id].charge);
        const before = num(p.active.charge, 0);
        p.active.charge = Math.min(mx, before + 1);
        if (before < mx && p.active.charge >= mx) G.emit('text', { x: p.x, y: p.y - 34, text: G.ACTIVES[p.active.id].name + ' 已充能', color: '#2ce8f5', size: 16 });
      }
      if (name === 'onTick') droneTick(S, p, num(ctx.dt, G.DT));
      if (!p.relics) return;
      for (const id of relicIds(p)) {
        const d = G.RELICS[id], fn = d.hooks && d.hooks[name];
        if (fn) fn(S, ctx, relicN(p, id), p);
      }
      if (p.synergies) for (const fam of G.SYNERGY_ORDER) {
        const tier = p.synergies[fam] || 0, sd = G.SYNERGIES[fam];
        for (let i = 0; i < tier && sd; i++) { const t = sd.tiers[i], fn = t && t.hooks && t.hooks[name]; if (fn) fn(S, ctx, 1, p); }
      }
    } catch (err) { if (G.reportError) G.reportError(err); }
    finally { depth--; if (isHurt) hurtDepth--; }
  };

  // 伤害修正（G.hurtEnemy 开头调用；玩家来源）
  Items.dmgMod = function (S, e, dmg, o) {
    const p = S && S.p; if (!p || !e || !(dmg > 0)) return dmg;
    const kind = (o && o.kind) || 'bullet';
    let m = 1;
    const chilled = hasStatus(e, 'chill'), frozen = hasStatus(e, 'freeze');
    if (synTier(p, 'frost') >= 1 && (chilled || frozen)) m *= 1.2;
    if (synTier(p, 'toxic') >= 2 && hasStatus(e, 'poison')) m *= 1.25;
    if (frozen && relicN(p, 'glacier_crown')) m *= 1.5;
    const an = relicN(p, 'assassin_mark');
    if (an && kind !== 'burn' && kind !== 'poison' && e.maxHp > 0 && e.hp >= e.maxHp - 0.001) m *= 1 + (e.boss ? 0.3 : 0.6) * an;
    return dmg * m;
  };

  // ---------------- 属性汇总 ----------------
  Items.recalc = function (S, st) {
    const p = S && S.p; if (!p || !st) return st;
    const rel = p.relics || {};
    const famCount = {};
    for (const id of Object.keys(rel)) {
      const d = G.RELICS[id]; const n = Math.min(rel[id] | 0, d ? d.max : 0);
      if (!d || n <= 0) continue;
      for (const k in (d.stats || {})) st[k] = num(st[k], 0) + d.stats[k] * n;
      for (const k in (d.minus || {})) st[k] = num(st[k], 0) - d.minus[k] * n;
      if (d.family) famCount[d.family] = (famCount[d.family] || 0) + 1;
    }
    const syn = {};
    for (const fam of G.SYNERGY_ORDER) {
      const sd = G.SYNERGIES[fam], have = famCount[fam] || 0;
      let tier = 0;
      sd.tiers.forEach((t, i) => { if (have >= t.n) { tier = i + 1; for (const k in (t.stats || {})) st[k] = num(st[k], 0) + t.stats[k]; } });
      if (tier) syn[fam] = tier;
    }
    p.synergies = syn;
    // 下限 / 上限（平衡护栏）
    const clampK = (k, lo, hi) => { if (st[k] !== undefined) st[k] = G.clamp(num(st[k], lo), lo, hi); };
    clampK('skillCdMul', 0.5, 2); clampK('dodgeCdMul', 0.4, 2); clampK('rateMul', 0.3, 3.5); clampK('dmgMul', 0.2, 10);
    clampK('crit', 0, 0.8); clampK('critMul', 1, 5); clampK('chillChance', 0, 0.75); clampK('burnChance', 0, 0.8);
    clampK('poisonChance', 0, 0.8); clampK('lifesteal', 0, 0.2); clampK('homing', 0, 3); clampK('multi', 0, 4);
    clampK('shopDiscount', 0, 0.4); clampK('bulletSize', 0.5, 3); clampK('bulletSpd', 0.5, 2.5); clampK('spdMul', 0.5, 1.8);
    if (st.maxHp !== undefined) st.maxHp = Math.max(2, Math.round(num(st.maxHp, 2)));
    if (!relicN(p, 'guardian_orb')) p.orbs = null;
    return st;
  };

  // ---------------- 掉落挑选 ----------------
  function unlocked(kind, id) {
    try { return !!(G.Meta && typeof G.Meta.isUnlocked === 'function' && G.Meta.isUnlocked(kind, id)); } catch (e) { return false; }
  }
  const SRC_BOOST = { chest: 0, shop: 0, gold: 0, fight: 0, elite: 1, boss: 2, altar: 2 };
  const SRC_MIN = { elite: 2, boss: 3, altar: 3 };
  function rarityW(base, r, boost) { return base[r] * Math.pow(1 + 0.35 * boost, r - 1); }
  const RELIC_BASE = [0, 60, 34, 16, 6, 1.8];
  const WEAPON_BASE = [0, 10, 50, 30, 12, 4];

  Items.pickRelics = function (S, n, o) {
    o = o || {}; n = Math.max(1, n | 0 || 3);
    const p = S.p || { relics: {} }, rng = S.rngLoot || S.rng;
    const src = o.src || o.pool || 'chest';
    const boost = num(S.floor, 0) + (SRC_BOOST[src] || 0) + num(p.st && p.st.luck, 0) * 0.5;
    const ex = o.exclude || [];
    const res = [];
    const ok = (id, minR, maxR) => {
      const d = G.RELICS[id];
      if (!d || res.indexOf(id) >= 0 || ex.indexOf(id) >= 0) return false;
      if (d.rarity < minR || d.rarity > maxR) return false;
      if ((p.relics && p.relics[id] || 0) >= d.max) return false;
      if (d.pool === 'unlock' && !unlocked('relic', id)) return false;
      if (d.pool === 'altar' && src !== 'altar') return false;
      return true;
    };
    let minR = o.minRarity || SRC_MIN[src] || 1;
    const maxR = o.maxRarity || 5;
    while (res.length < n && minR >= 1) {
      const cands = G.RELIC_ORDER.filter(id => ok(id, minR, maxR));
      if (!cands.length) { minR--; continue; }
      res.push(rng.weighted(cands, id => rarityW(RELIC_BASE, G.RELICS[id].rarity, boost) * (G.RELICS[id].pool === 'altar' ? 3 : 1)));
    }
    if (!res.length) res.push('power_potion');   // 理论上不会发生（全部叠满）
    return res;
  };

  Items.pickWeapon = function (S, o) {
    o = o || {};
    const p = S.p || { weapons: [] }, rng = S.rngLoot || S.rng;
    const src = o.src || 'chest';
    const boost = num(S.floor, 0) + (SRC_BOOST[src] || 0) + num(p.st && p.st.luck, 0) * 0.5;
    const ex = (o.exclude || []).concat(p.weapons || []);
    const ok = (id, minR, maxR, allowStart) => {
      const w = G.WEAPONS[id];
      if (!w || ex.indexOf(id) >= 0 || w.rarity < minR || w.rarity > maxR) return false;
      if (w.pool === 'start') return allowStart;
      if (w.pool === 'unlock' && !unlocked('weapon', id)) return false;
      return true;
    };
    const tries = [[o.minRarity || SRC_MIN[src] || 1, o.maxRarity || 5, false], [1, 5, false], [1, 5, true]];
    for (const [a, bR, st] of tries) {
      for (let minR = a; minR >= 1; minR--) {
        const cands = G.WEAPON_ORDER.filter(id => ok(id, minR, bR, st));
        if (cands.length) return rng.weighted(cands, id => rarityW(WEAPON_BASE, G.WEAPONS[id].rarity, boost));
      }
    }
    return 'smg';
  };

  Items.pickActive = function (S) {
    const rng = S.rngLoot || S.rng, cur = S.p && S.p.active ? S.p.active.id : null;
    const c = G.ACTIVE_ORDER.filter(id => id !== cur);
    return rng.pick(c.length ? c : G.ACTIVE_ORDER);
  };

  Items.synergyInfo = function (S) {
    const p = (S && S.p) || { relics: {} };
    return G.SYNERGY_ORDER.map(fam => {
      const sd = G.SYNERGIES[fam];
      const members = G.RELIC_ORDER.filter(id => G.RELICS[id].family === fam);
      const have = members.filter(id => p.relics && p.relics[id] > 0).length;
      return { family: fam, name: sd.name, color: sd.color, have: have, members: members, tier: synTier(p, fam),
        tiers: sd.tiers.map(t => ({ n: t.n, desc: t.desc, active: have >= t.n })) };
    });
  };

  Items.rarityOf = function (kind, id) {
    const t = kind === 'weapon' ? G.WEAPONS : kind === 'active' ? G.ACTIVES : G.RELICS;
    const d = t && t[id]; return d ? (d.rarity || 1) : 1;
  };

  Items.useActive = function (S) {
    const p = S && S.p; if (!p || !p.active) return false;
    const d = G.ACTIVES[p.active.id]; if (!d) return false;
    const mx = num(p.active.max, d.charge);
    if (num(p.active.charge, 0) < mx) { G.emit('deny', { reason: 'active' }); S.toast = { text: d.name + ' 尚未充能（' + (p.active.charge | 0) + '/' + mx + '）', t: 1.2 }; return false; }
    p.active.charge = 0;
    try { d.use(S); } catch (err) { if (G.reportError) G.reportError(err); }
    G.emit('skill', { cid: 'active', id: p.active.id, x: p.x, y: p.y });
    return true;
  };

  // ---------------- 辅助（遗物/协同/主动道具数据里的钩子使用） ----------------
  IH.boom = function (S, x, y, rad, dmg, o) { if (G.explode) G.explode(S, x, y, rad, dmg, 'p', o || {}); };
  IH.spikes = function (S, x, y, n, dmg, o) {
    o = o || {};
    const off = ((S.steps || 0) * 0.37) % TAU, spd = o.spd || 420;
    for (let i = 0; i < n; i++) {
      const a = off + i * TAU / n;
      spawn(S, { own: 'p', x: x, y: y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: o.r || 4, dmg: dmg, life: o.life || 0.6, max: o.life || 0.6,
        shape: o.shape || 'spike', color: o.color || '#ffffff', pierce: o.pierce || 0, bounce: 0, homing: o.homing || 0, explode: 0, knock: 60,
        crit: false, status: o.status || null, hit: [], src: o.src || 'relic', lob: null });
    }
  };
  IH.echo = function (S, p, c, delay, mul) { (p.echoQ || (p.echoQ = [])).push({ t: delay, wid: c.wid, ang: c.ang, mul: mul }); };
  IH.seeker = function (S, p, c) {
    const a = c.ang + S.rng.range(-0.5, 0.5), o = muzzle(p, c.ang, 14);
    spawn(S, { own: 'p', x: o.x, y: o.y, vx: Math.cos(a) * 360, vy: Math.sin(a) * 360, r: 4, dmg: Math.max(0.5, c.dmg * 0.4), life: 1.3, max: 1.3,
      shape: 'star', color: '#fee761', pierce: 0, bounce: 0, homing: 2.5, explode: 0, knock: 40, crit: false, status: null, hit: [], src: 'syn_barrage', lob: null });
  };
  IH.freeze = function (S, e, t) {
    if (!e) return;
    e.status = e.status || {};
    if (e.boss) e.status.chill = Math.max(num(e.status.chill, 0), t * 0.5);
    else e.status.freeze = Math.max(num(e.status.freeze, 0), t);
  };
  IH.nova = function (S, p, rad, t) {
    for (const e of S.enemies) if (alive(e) && Math.hypot(e.x - p.x, e.y - p.y) < rad + (e.r || 10)) IH.freeze(S, e, t);
    if (G.addHazard) G.addHazard(S, { kind: 'ice', own: 'p', x: p.x, y: p.y, rad: rad, t: 0.4, max: 0.4, dps: 0, tick: 0 });
  };
  IH.zap = function (S, e0, n, dmg) {
    const pts = [[e0.x, e0.y]], hit = [e0];
    let cur = e0;
    for (let i = 0; i < n; i++) {
      const nx = nearestEnemy(S, cur.x, cur.y, 150, hit); if (!nx) break;
      hit.push(nx); pts.push([nx.x, nx.y]);
      hurt(S, nx, dmg, { kind: 'beam', crit: false, src: 'syn_crit' });
      cur = nx;
    }
    if (pts.length > 1) G.emit('chain', { pts: pts });
  };
  IH.shockwave = function (S, p, rad) {
    if (num(p._swT, -9) > num(S.time, 0)) return;
    p._swT = num(S.time, 0) + 1.5;
    IH.clearEBullets(S, p.x, p.y, rad);
    for (const e of S.enemies) {
      if (!alive(e) || e.boss) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < rad + (e.r || 10) && d > 0.1) { e.vx = num(e.vx, 0) + (e.x - p.x) / d * 320; e.vy = num(e.vy, 0) + (e.y - p.y) / d * 320; }
    }
    if (G.addHazard) G.addHazard(S, { kind: 'shock', own: 'p', x: p.x, y: p.y, rad: rad, t: 0.35, max: 0.35, dps: 0, tick: 0 });
    G.emit('shake', { amt: 3 });
  };
  IH.clearEBullets = function (S, x, y, rad) {
    for (const b of S.bullets) if (b.own === 'e' && !b.dead && Math.hypot(b.x - x, b.y - y) < rad) b.dead = true;
  };
  IH.spread = function (S, e0, n, rad, status) {
    const hit = [e0];
    for (let i = 0; i < n; i++) {
      const e = nearestEnemy(S, e0.x, e0.y, rad, hit); if (!e) break;
      hit.push(e);
      e.status = e.status || {};
      if (status.poison) {
        const cur = e.status.poison;
        e.status.poison = { t: Math.max(status.poison[1], cur && cur.t || 0), dps: Math.max(status.poison[0], cur && cur.dps || 0), stacks: Math.min(5, (cur && cur.stacks || 0) + 1) };
      }
    }
    if (hit.length > 1) G.emit('chain', { pts: hit.map(e => [e.x, e.y]), color: '#63c74d' });
  };
  IH.orbs = function (S, p, n, dt) {
    p._orbA = (num(p._orbA, 0) + dt * 2.8) % TAU;
    const R = 44, orbs = [];
    for (let i = 0; i < n; i++) {
      const a = p._orbA + i * TAU / n;
      orbs.push({ x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R, r: 9 });
    }
    p.orbs = orbs;
    for (const o of orbs) {
      for (const b of S.bullets) if (b.own === 'e' && !b.dead && Math.hypot(b.x - o.x, b.y - o.y) < o.r + (b.r || 4)) b.dead = true;
      for (const e of S.enemies.slice()) {
        if (!alive(e) || Math.hypot(e.x - o.x, e.y - o.y) > o.r + (e.r || 10)) continue;
        if (num(S.time, 0) - num(e._orbT, -9) < 0.4) continue;
        e._orbT = num(S.time, 0);
        hurt(S, e, 4 * num(ST(p).dmgMul, 1), { kx: 0, ky: 0, crit: false, kind: 'skill', src: 'guardian_orb' });
      }
    }
  };
  IH.phoenix = function (S, p) {
    if (!(p.relics && p.relics.phoenix_feather > 0)) return;
    p.hp = Math.max(1, Math.ceil(num(p.maxHp, 6) / 2));
    p.iframes = Math.max(num(p.iframes, 0), 2);
    delete p.relics.phoenix_feather;
    if (p.relicOrder) p.relicOrder = p.relicOrder.filter(id => id !== 'phoenix_feather');
    IH.clearEBullets(S, p.x, p.y, 200);
    IH.boom(S, p.x, p.y, 130, 20 * num(ST(p).dmgMul, 1), { status: { burn: [5, 3] } });
    G.emit('text', { x: p.x, y: p.y - 36, text: '浴火重生！', color: '#feae34', size: 22 });
    G.emit('heal', { x: p.x, y: p.y, n: p.hp });
    if (G.recalcStats) G.recalcStats(S);
  };
  function droneTick(S, p, dt) {
    const d = p.drone; if (!d) return;
    d.t -= dt;
    if (d.t <= 0) { p.drone = null; return; }
    d.ang = (num(d.ang, 0) + dt * 1.6) % TAU;
    const tx = p.x + Math.cos(d.ang) * 38, ty = p.y + Math.sin(d.ang) * 22 - 26;
    d.x = G.lerp(num(d.x, tx), tx, Math.min(1, dt * 8)); d.y = G.lerp(num(d.y, ty), ty, Math.min(1, dt * 8));
    d.cd = num(d.cd, 0) - dt;
    if (d.cd > 0) return;
    let best = null, bd = 380;
    for (const e of S.enemies) {
      if (!alive(e)) continue;
      const dd = Math.hypot(e.x - d.x, e.y - d.y);
      if (dd >= bd) continue;
      if (G.lineOfSight && S.room && !G.lineOfSight(S.room, d.x, d.y, e.x, e.y)) continue;
      bd = dd; best = e;
    }
    if (!best) { d.cd = 0.15; return; }
    d.cd = 0.35;
    const a = Math.atan2(best.y - d.y, best.x - d.x);
    d.aim = a;
    spawn(S, { own: 'p', x: d.x, y: d.y, vx: Math.cos(a) * 540, vy: Math.sin(a) * 540, r: 3, dmg: 3 * num(ST(p).dmgMul, 1), life: 0.8, max: 0.8,
      shape: 'bolt', color: '#2ce8f5', pierce: 0, bounce: 0, homing: 0, explode: 0, knock: 50, crit: false, status: null, hit: [], src: 'drone', lob: null });
    G.emit('shoot', { x: d.x, y: d.y, ang: a, wid: 'drone', kind: 'drone' });
  }
})(window.Game = window.Game || {});
