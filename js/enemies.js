// 《裂隙猎人》普通敌人 AI、精英词缀行为、生成/死亡钩子（所有者：enemies）
// 统一节奏：预备(move) → 预警(tele，e.tele.k 0..1) → 出手(act) → 硬直(rec)。
// 只用 S.rng；计时全部放在 e.mem；e.st 只是给 render 看的状态名。
(function (G) {
  'use strict';
  const TAU = Math.PI * 2;
  G.AI = G.AI || {};

  // ---------- 通用助手（bosses.js 通过 G.Enemies.h 复用） ----------
  function teleDur(S, base, fl) {
    let b = base;
    if ((fl === undefined ? S.floor : fl) === 0) b = Math.max(0.7, b);
    const m = ((S.dm && S.dm.tele) || 1) * ((S.fdef && S.fdef.tele) || 1);   // 难度 × 楼层（FLOORS[i].tele）
    return Math.max(0.5, b * m);
  }
  // 开始一个预警：spec 为 ARCH §5 的 tele 对象；返回时长
  function tele(S, e, spec, base) {
    const m = e.mem;
    spec.k = 0;
    e.tele = spec;
    m.tt = 0; m.td = teleDur(S, base);
    e.st = 'tele';
    G.emit && G.emit('tele', { x: e.x, y: e.y, kind: spec.type });
    return m.td;
  }
  // 推进预警；结束返回 true（并清除 e.tele）
  function teleTick(e, dt) {
    const m = e.mem;
    if (!e.tele) return true;
    m.tt += dt;
    e.tele.k = Math.min(1, m.tt / m.td);
    if (m.tt >= m.td) { e.tele = null; return true; }
    return false;
  }
  function who(e) { return e.def && e.def.flying ? 'f' : 'e'; }
  function mv(S, e, ang, sp, dt) {
    if (!(sp > 0)) return false;
    e.moving = true;
    return !!G.moveCircle(S.room, e, Math.cos(ang) * sp * dt, Math.sin(ang) * sp * dt, who(e));
  }
  // 朝某方向移动，被挡住时尝试绕行
  function chase(S, e, ang, sp, dt) {
    const m = e.mem, x0 = e.x, y0 = e.y;
    if (!mv(S, e, ang, sp, dt)) return false;
    if (Math.hypot(e.x - x0, e.y - y0) > sp * dt * 0.6) return false;
    const s = m.side || 1;
    for (const off of [0.9, 1.6, 2.3]) {
      const x1 = e.x, y1 = e.y;
      mv(S, e, ang + off * s, sp, dt);
      if (Math.hypot(e.x - x1, e.y - y1) > sp * dt * 0.4) return false;
      const x2 = e.x, y2 = e.y;
      mv(S, e, ang - off * s, sp, dt);
      if (Math.hypot(e.x - x2, e.y - y2) > sp * dt * 0.4) { m.side = -s; return false; }
    }
    return true;
  }
  // 保持距离 lo..hi，侧移
  function keepRange(S, e, d, a, dt, lo, hi, spMul) {
    const m = e.mem, sp = e.spd * (spMul || 1);
    if (S.rng.chance(dt * 0.35)) m.side = -(m.side || 1);
    if (d > hi) chase(S, e, a, sp, dt);
    else if (d < lo) { if (chase(S, e, a + Math.PI + 0.5 * (m.side || 1), sp, dt)) m.side = -(m.side || 1); }
    else if (mv(S, e, a + Math.PI / 2 * (m.side || 1), sp * 0.55, dt)) m.side = -(m.side || 1);
  }
  function los(S, e) {
    return G.lineOfSight ? G.lineOfSight(S.room, e.x, e.y, S.p.x, S.p.y) : true;
  }
  // 出手间隔（狂暴词缀缩短；预警时长不受影响）
  function cd(e, t) {
    if (e.elite === 'berserk') return t * (e.hp < e.maxHp * 0.5 ? 0.55 : 0.7);
    return t;
  }
  // 精英/Boss 的“重击”：困难难度全程 2 点；普通难度从 FLOORS[i].heavy 为 true 的楼层起 2 点（第 3 层）
  function heavy(S, e) { return ((e.boss || e.elite) && ((S.dm && S.dm.heavy) || (S.fdef && S.fdef.heavy))) ? 2 : 1; }
  // 敌人射击（分裂弹词缀会额外打出两侧弹）
  function shot(S, e, ang, spd, o) {
    o = Object.assign({ dmg: heavy(S, e), src: e }, o || {});
    const b = G.eShot(S, e.x, e.y, ang, spd, o);
    if (e.elite === 'splitter') {
      G.eShot(S, e.x, e.y, ang - 0.3, spd * 0.85, Object.assign({}, o, { r: (o.r || 6) * 0.8 }));
      G.eShot(S, e.x, e.y, ang + 0.3, spd * 0.85, Object.assign({}, o, { r: (o.r || 6) * 0.8 }));
    }
    return b;
  }
  function fanShot(S, e, ang, n, spread, spd, o) {
    for (let i = 0; i < n; i++) shot(S, e, ang + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0), spd, o);
  }
  function ringShot(S, e, n, spd, off, o, gapAt, gapN) {
    for (let i = 0; i < n; i++) {
      if (gapN) { let k = (i - gapAt) % n; if (k < 0) k += n; if (k < gapN) continue; }
      G.eShot(S, e.x, e.y, off + i * TAU / n, spd, Object.assign({ dmg: heavy(S, e), src: e }, o || {}));
    }
  }
  function eshootEv(e) { G.emit && G.emit('eshoot', { x: e.x, y: e.y, type: e.type }); }
  // 房间内随机可站立点（离玩家 ≥minD）
  function spotNear(S, cx, cy, rMin, rMax, r, w, minP) {
    for (let k = 0; k < 24; k++) {
      const ang = S.rng.range(0, TAU), dd = S.rng.range(rMin, rMax);
      let x = G.clamp(cx + Math.cos(ang) * dd, 60, G.RW - 60), y = G.clamp(cy + Math.sin(ang) * dd, 60, G.RH - 60);
      const f = G.placeFree ? G.placeFree(S.room, x, y, r, w) : { x, y };
      if (!f) continue;
      if (minP && Math.hypot(f.x - S.p.x, f.y - S.p.y) < minP) continue;
      return f;
    }
    const f = G.placeFree ? G.placeFree(S.room, G.RW / 2, G.RH / 2, r, w) : null;
    return f || { x: G.RW / 2, y: G.RH / 2 };
  }
  function ownedAlive(S, e) {
    let n = 0;
    for (const o of S.enemies) if (!o.dead && o.owner === e.id) n++;
    return n;
  }
  function summon(S, e, type, n, cap) {
    let alive = ownedAlive(S, e), made = 0;
    for (let i = 0; i < n && alive < cap; i++) {
      if (G.canSpawn && !G.canSpawn(S, 1)) break;
      const ang = S.rng.range(0, TAU);
      const s = G.spawnEnemy(S, type, e.x + Math.cos(ang) * (e.r + 16), e.y + Math.sin(ang) * (e.r + 16), { summon: true, owner: e.id, spawnT: 0.45 });
      if (s) { alive++; made++; }
    }
    return made;
  }
  function go(e, st, t) { e.st = st; e.mem.t = t; }

  // 注册：统一做初始化与状态复位
  function reg(name, fn) {
    G.AI[name] = function (e, S, dt, d, a) {
      const m = e.mem || (e.mem = {});
      if (!m.init) {
        m.init = 1; m.t = S.rng.range(0.7, 1.4); m.side = S.rng.chance(0.5) ? 1 : -1;
        e.st = 'move';
      }
      e.moving = false;
      fn(e, S, dt, d, a, m);
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) { e.x = G.RW / 2; e.y = G.RH / 2; }
    };
  }

  // ---------- 16 种普通敌人 ----------
  // 苔藓史莱姆：显示落点 → 跳过去 → 落地硬直
  reg('slime', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      chase(S, e, a, e.spd * 0.25, dt); e.face = a;
      if ((m.t -= dt) <= 0) {
        const hop = Math.min(d, 120), ang = a + S.rng.range(-0.25, 0.25);
        const f = G.placeFree(S.room, G.clamp(e.x + Math.cos(ang) * hop, 50, G.RW - 50), G.clamp(e.y + Math.sin(ang) * hop, 50, G.RH - 50), e.r, 'e');
        m.hx = f.x; m.hy = f.y;
        tele(S, e, { type: 'target', x: m.hx, y: m.hy, rad: e.r + 8 }, e.def.tele);
      }
    } else if (e.st === 'tele') {
      if (teleTick(e, dt)) { go(e, 'act', 0.4); m.ha = Math.atan2(m.hy - e.y, m.hx - e.x); m.hs = Math.hypot(m.hx - e.x, m.hy - e.y) / 0.4; }
    } else if (e.st === 'act') {
      mv(S, e, m.ha, m.hs, dt);
      if ((m.t -= dt) <= 0) go(e, 'rec', 0.5);
    } else if ((m.t -= dt) <= 0) go(e, 'move', cd(e, S.rng.range(0.4, 0.8)));
  });

  // 小史莱姆：连续短跳（纯移动）
  reg('slimelet', function (e, S, dt, d, a, m) {
    if (e.st === 'act') {
      mv(S, e, e.face, e.spd * 2.4, dt);
      if ((m.t -= dt) <= 0) go(e, 'move', S.rng.range(0.6, 1.0));
    } else {
      chase(S, e, a, e.spd * 0.5, dt);
      if ((m.t -= dt) <= 0) { e.face = a + S.rng.range(-0.4, 0.4); go(e, 'act', 0.25); }
    }
  });

  // 獠牙野猪：线预警 → 直线冲锋 → 撞墙眩晕
  reg('boar', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      chase(S, e, a, e.spd, dt); e.face = a;
      if ((m.t -= dt) <= 0 && d < 330 && los(S, e)) tele(S, e, { type: 'line', ang: a, len: Math.min(420, d + 120), w: e.r * 2 }, e.def.tele);
    } else if (e.st === 'tele') {
      if (teleTick(e, dt)) go(e, 'act', 0.75);
    } else if (e.st === 'act') {
      const blocked = mv(S, e, e.face, 400, dt);
      m.t -= dt;
      if (blocked || m.t <= 0) {
        go(e, 'rec', blocked ? 1.3 : 0.8);
        if (blocked) G.emit && G.emit('shake', { amt: 3 });
      }
    } else if ((m.t -= dt) <= 0) go(e, 'move', cd(e, S.rng.range(0.8, 1.2)));
  });

  // 哥布林弓手：保持距离；瞄准线跟踪 70% 后锁定 → 一箭
  reg('archer', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      if (los(S, e)) keepRange(S, e, d, a, dt, 170, 290); else chase(S, e, a, e.spd, dt);
      e.face = a;
      if ((m.t -= dt) <= 0 && los(S, e)) tele(S, e, { type: 'aim', ang: a, len: Math.min(d + 40, 520) }, e.def.tele);
    } else if (e.st === 'tele') {
      if (e.tele.k < 0.7) { e.tele.ang = a; e.tele.len = Math.min(d + 40, 520); e.face = a; }
      const ang = e.tele.ang;
      if (teleTick(e, dt)) {
        const nA = 1 + S.floor;   // 第2/3层齐射多 1/2 发
        fanShot(S, e, ang, nA, 0.16 * (nA - 1), 140, { shape: 'eneedle', r: 5, color: '#f77622', life: 4 });
        if (e.elite === 'berserk') shot(S, e, ang + 0.18, 130, { shape: 'eneedle', r: 5, color: '#f77622', life: 4 });
        eshootEv(e); go(e, 'rec', 0.35);
      }
    } else if ((m.t -= dt) <= 0) go(e, 'move', cd(e, S.rng.range(1.2, 1.7)));
  });

  // 爆裂蘑菇：靠近 → 红圈膨胀 → 自爆
  reg('shroom', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      chase(S, e, a + Math.sin((e.anim || 0) * 5 + e.id) * 0.35, e.spd, dt); e.face = a;
      if (d < 70 + S.p.r) tele(S, e, { type: 'circle', rad: 64 }, e.def.tele);
    } else if (e.st === 'tele') {
      if (teleTick(e, dt)) {
        G.explode(S, e.x, e.y, 64, heavy(S, e), 'e', { pdmg: heavy(S, e), cause: e.name });
        m.boom = 1; e.hp = 0; G.killEnemy(S, e);
      }
    }
  });

  // 吸血蝙蝠：绕圈骚扰，短线预警后俯冲
  reg('bat', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      const wob = Math.sin((e.anim || 0) * 4 + e.id * 1.7) * 0.9;
      if (d > 150) mv(S, e, a + wob * 0.6, e.spd, dt);
      else if (mv(S, e, a + (Math.PI / 2 + 0.25) * m.side + wob * 0.3, e.spd * 0.9, dt)) m.side = -m.side;
      e.face = a;
      if ((m.t -= dt) <= 0 && d < 270) tele(S, e, { type: 'line', ang: a, len: Math.min(d + 60, 280), w: e.r * 2 }, e.def.tele);
    } else if (e.st === 'tele') {
      e.face = e.tele.ang;
      if (teleTick(e, dt)) go(e, 'act', 0.4);
    } else if (e.st === 'act') {
      if (mv(S, e, e.face, 300, dt) || (m.t -= dt) <= 0) go(e, 'rec', 0.45);
    } else if ((m.t -= dt) <= 0) go(e, 'move', cd(e, S.rng.range(1.6, 2.6)));
  });

  // 持盾卫兵：盾牌朝向玩家（正面减伤）→ 扇形预警 → 盾击突进 → 放下盾牌硬直
  reg('guard', function (e, S, dt, d, a, m) {
    if (e.face === undefined || e.face === null) e.face = a;
    if (e.st === 'move') {
      e.face += G.clamp(G.angDiff(a, e.face), -1.6 * dt, 1.6 * dt);
      chase(S, e, a, e.spd, dt); m.shieldDown = 0;
      if ((m.t -= dt) <= 0 && d < 150) tele(S, e, { type: 'cone', ang: e.face, arc: 1.0, len: 150 }, e.def.tele);
    } else if (e.st === 'tele') {
      if (teleTick(e, dt)) go(e, 'act', 0.32);
    } else if (e.st === 'act') {
      const blocked = mv(S, e, e.face, 320, dt);
      if (blocked || (m.t -= dt) <= 0) { go(e, 'rec', 1.3); m.shieldDown = 1; }
    } else if ((m.t -= dt) <= 0) { m.shieldDown = 0; go(e, 'move', cd(e, S.rng.range(1.4, 2.0))); }
  });

  // 火焰小鬼：漂浮，圈预警 → 环形火球；每 3 次瞬移
  reg('imp', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      keepRange(S, e, d, a, dt, 150, 270); e.face = a;
      if ((m.t -= dt) <= 0) tele(S, e, { type: 'circle', rad: e.r + 18 }, e.def.tele);
    } else if (e.st === 'tele') {
      if (teleTick(e, dt)) {
        const n = (e.elite ? 12 : 10) + S.floor, off = S.rng.range(0, TAU);
        for (let i = 0; i < n; i++) shot(S, e, off + i * TAU / n, 120, { color: '#f77622' });
        eshootEv(e); m.cnt = (m.cnt || 0) + 1; go(e, 'rec', 0.5);
        m.ring2 = S.floor >= 2 ? off + Math.PI / n : null;   // 第3层：0.3s 后第二圈（错位、留 3 发缺口）
      }
    } else if (m.ring2 !== null && m.ring2 !== undefined && m.t <= 0.2) {
      const n = 12; ringShot(S, e, n, 105, m.ring2, { color: '#f77622' }, S.rng.int(0, n - 1), 3);
      m.ring2 = null; eshootEv(e);
    } else if ((m.t -= dt) <= 0) {
      if (m.cnt % 3 === 0) { const f = spotNear(S, S.p.x, S.p.y, 160, 240, e.r, 'f', 140); e.x = f.x; e.y = f.y; }
      go(e, 'move', cd(e, S.rng.range(1.5, 2.1)));
    }
  });

  // 钻地鼹鼠：地下潜行（air，不可被击中）→ 裂纹圈 → 破土冲击 → 扇形土块 → 再钻地
  reg('mole', function (e, S, dt, d, a, m) {
    if (!m.mi) { m.mi = 1; e.st = 'burrow'; e.air = 1; m.t = S.rng.range(1.2, 2.0); }
    if (e.st === 'burrow') {
      e.air = 1;
      if (d > 26) chase(S, e, a, e.spd, dt);
      if ((m.t -= dt) <= 0 || d < 28) {
        const dur = tele(S, e, { type: 'target', x: e.x, y: e.y, rad: 46 }, e.def.tele);
        e.st = 'emerge';
        G.addStrike(S, { x: e.x, y: e.y, rad: 46, t: dur, max: dur, dmg: heavy(S, e), own: 'e', kind: 'pillar', leave: null });
      }
    } else if (e.st === 'emerge') {
      if (teleTick(e, dt)) { e.air = 0; tele(S, e, { type: 'cone', ang: a, arc: 0.7, len: 200 }, 0.6); }
    } else if (e.st === 'tele') {
      if (e.tele.k < 0.5) e.tele.ang = a;
      const ang = e.tele.ang;
      if (teleTick(e, dt)) { fanShot(S, e, ang, 3 + S.floor, 0.6 + 0.15 * S.floor, 130, { color: '#f6757a', r: 6 }); eshootEv(e); go(e, 'rec', 0.9); }
    } else if (e.st === 'rec') {
      if ((m.t -= dt) <= 0) { e.st = 'burrow'; e.air = 1; m.t = cd(e, S.rng.range(1.0, 1.6)); }
    } else { e.st = 'burrow'; m.t = 1; }
  });

  // 熔岩炮台：固定；炮口缓慢转向 → 线预警 → 三连发；每第 3 次改为十字喷射
  reg('turret', function (e, S, dt, d, a, m) {
    if (m.aim === undefined) m.aim = a;
    if (e.st !== 'act') m.aim += G.clamp(G.angDiff(a, m.aim), -1.2 * dt, 1.2 * dt);
    e.face = m.aim;
    if (e.st === 'move') {
      if ((m.t -= dt) <= 0) {
        m.cnt = (m.cnt || 0) + 1;
        if (m.cnt % 3 === 0) { m.mode = 'cross'; m.base = m.aim; tele(S, e, { type: 'rays', n: 4, base: m.base, len: 360, w: 12 }, e.def.tele); }
        else { m.mode = 'burst'; tele(S, e, { type: 'line', ang: m.aim, len: 420, w: 10 }, e.def.tele); }
      }
    } else if (e.st === 'tele') {
      if (m.mode === 'burst' && e.tele.k < 0.5) e.tele.ang = m.aim; else if (m.mode === 'burst') m.aim = e.tele.ang;
      const ang = e.tele.ang;
      if (teleTick(e, dt)) { m.fa = m.mode === 'burst' ? ang : m.base; m.n = 0; go(e, 'act', 0); }
    } else if (e.st === 'act') {
      if ((m.t -= dt) <= 0) {
        if (m.mode === 'burst') shot(S, e, m.fa, 140, { color: '#e43b44', r: 6 });
        else for (let i = 0; i < 4; i++) shot(S, e, m.fa + i * Math.PI / 2 + (m.n % 2) * (S.floor >= 2 ? Math.PI / 4 : 0), 125, { color: '#e43b44', shape: 'ebig', r: 7 });
        eshootEv(e); m.n++; m.t = 0.16;
        if (m.n >= (m.mode === 'burst' ? 3 + S.floor : 2 + (S.floor >= 2 ? 1 : 0))) go(e, 'rec', 0.4);
      }
    } else if ((m.t -= dt) <= 0) go(e, 'move', cd(e, S.rng.range(1.1, 1.5)));
  });

  // 熔岩蟾蜍：落点圈 → 高跳（air）→ 砸地（熔岩）
  reg('toad', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      chase(S, e, a, e.spd, dt); e.face = a;
      if ((m.t -= dt) <= 0 && d < 360) {
        const jd = Math.min(d, 230);
        const f = G.placeFree(S.room, G.clamp(e.x + Math.cos(a) * jd, 50, G.RW - 50), G.clamp(e.y + Math.sin(a) * jd, 50, G.RH - 50), e.r, 'e');
        m.tx = f.x; m.ty = f.y;
        const dur = tele(S, e, { type: 'target', x: m.tx, y: m.ty, rad: 54 }, e.def.tele);
        G.addStrike(S, { x: m.tx, y: m.ty, rad: 54, t: dur + 0.55, max: dur + 0.55, dmg: heavy(S, e), own: 'e', kind: 'slam',
          leave: S.floor >= 1 ? { kind: 'lava', own: 'e', rad: 30, t: 3, max: 3, dps: 1, tick: 0 } : null });
      }
    } else if (e.st === 'tele') {
      if (teleTick(e, dt)) { e.air = 1; m.sx = e.x; m.sy = e.y; go(e, 'act', 0.55); }
    } else if (e.st === 'act') {
      m.t -= dt; const k = 1 - Math.max(0, m.t) / 0.55;
      e.x = G.lerp(m.sx, m.tx, k); e.y = G.lerp(m.sy, m.ty, k); e.moving = true;
      if (m.t <= 0) { e.x = m.tx; e.y = m.ty; e.air = 0; go(e, 'rec', 1.0); }
    } else if ((m.t -= dt) <= 0) go(e, 'move', cd(e, S.rng.range(0.9, 1.4)));
  });

  // 召唤萨满：保持距离；召唤蝙蝠（自己的召唤物 ≤3），满员时扇形三连弹
  reg('shaman', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      keepRange(S, e, d, a, dt, 200, 320); e.face = a;
      if ((m.t -= dt) <= 0) {
        if (ownedAlive(S, e) < 3 && (!G.canSpawn || G.canSpawn(S, 1))) { m.mode = 'summon'; tele(S, e, { type: 'circle', rad: e.r + 20 }, e.def.tele); }
        else { m.mode = 'shoot'; tele(S, e, { type: 'cone', ang: a, arc: 0.6, len: 220 }, e.def.tele); }
      }
    } else if (e.st === 'tele') {
      if (m.mode === 'shoot' && e.tele.k < 0.5) e.tele.ang = a;
      const ang = e.tele.ang;
      if (teleTick(e, dt)) {
        if (m.mode === 'summon') summon(S, e, 'bat', 2, 3);
        else { fanShot(S, e, ang, 3 + S.floor, 0.5 + 0.12 * S.floor, 130, { color: '#b55088' }); eshootEv(e); }
        go(e, 'rec', 0.5);
      }
    } else if ((m.t -= dt) <= 0) go(e, 'move', cd(e, S.rng.range(1.5, 2.1)));
  });

  // 虚空幽魂：隐身接近（hidden）→ 在玩家身旁现形 → 线预警 → 突袭 → 硬直（可被击中）→ 隐去
  reg('wraith', function (e, S, dt, d, a, m) {
    if (!m.wi) { m.wi = 1; e.st = 'hide'; e.hidden = 1; m.t = S.rng.range(1.2, 2.0); }
    if (e.st === 'hide') {
      e.hidden = 1;
      if (d > 130) chase(S, e, a, e.spd, dt);
      if ((m.t -= dt) <= 0) {
        const f = spotNear(S, S.p.x, S.p.y, 125, 170, e.r, 'f', 115);
        e.x = f.x; e.y = f.y; e.hidden = 0;
        const aa = G.angTo(e, S.p);
        e.face = aa;
        tele(S, e, { type: 'line', ang: aa, len: 260, w: e.r * 2 }, e.def.tele);
      }
    } else if (e.st === 'tele') {
      if (teleTick(e, dt)) go(e, 'act', 0.38);
    } else if (e.st === 'act') {
      if (mv(S, e, e.face, 380, dt) || (m.t -= dt) <= 0) go(e, 'rec', 1.1);
    } else if (e.st === 'rec') {
      if ((m.t -= dt) <= 0) go(e, 'fade', 0.4);
    } else if (e.st === 'fade') {
      if ((m.t -= dt) <= 0) { e.st = 'hide'; e.hidden = 1; m.t = cd(e, S.rng.range(1.2, 1.8)); }
    } else { e.st = 'hide'; m.t = 1; }
  });

  // 暗影祭司：远离；为受伤同伴治疗（25%）；空闲时扇形 5 弹
  reg('priest', function (e, S, dt, d, a, m) {
    if (m.t2 === undefined) m.t2 = S.rng.range(1.5, 2.5);
    if (e.st === 'move') {
      keepRange(S, e, d, a, dt, 240, 360); e.face = a;
      m.t -= dt; m.t2 -= dt;
      if (m.t <= 0) {
        // rogue3 修复（QA G6 / 评审 5）：祭司不治疗祭司；同一目标被治疗后 4 秒内不能再被治疗（healLock）
        let best = null, br = 0.85;
        for (const o of S.enemies) {
          if (o === e || o.dead || o.boss || o.spawnT > 0 || o.ai === 'priest' || (o.healLock || 0) > S.time) continue;
          const r = o.hp / o.maxHp;
          if (r < br && G.dist(o, e) < 280) { br = r; best = o; }
        }
        if (best) { m.healId = best.id; go(e, 'cast', 0.6); return; }
        m.t = 0.6;
      }
      if (m.t2 <= 0) tele(S, e, { type: 'cone', ang: a, arc: 0.9, len: 220 }, e.def.tele);
    } else if (e.st === 'cast') {
      if ((m.t -= dt) <= 0) {
        const o = S.enemies.find(x => x.id === m.healId && !x.dead);
        // 精英只回 12.5%（原 25%），普通敌人 25%；治疗后上 4 秒治疗锁
        if (o && (o.healLock || 0) <= S.time) {
          const n = Math.min(o.maxHp - o.hp, o.maxHp * (o.elite ? 0.125 : 0.25)); o.hp += n; o.healLock = S.time + 4;
          G.emit && G.emit('heal', { x: o.x, y: o.y, n: Math.round(n) });
        }
        go(e, 'move', cd(e, 3.2));
      }
    } else if (e.st === 'tele') {
      if (e.tele.k < 0.5) e.tele.ang = a;
      const ang = e.tele.ang;
      if (teleTick(e, dt)) { fanShot(S, e, ang, 5 + S.floor, 0.9 + 0.1 * S.floor, 115, { color: '#f6757a' }); eshootEv(e); m.t2 = cd(e, S.rng.range(1.8, 2.4)); go(e, 'rec', 0.4); }
    } else if ((m.t -= dt) <= 0) go(e, 'move', 0.5);
  });

  // 深渊狙击手：长瞄准（跟踪 72% 后锁定，tele.lock=true）→ 高速一发 → 换位
  reg('sniper', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      if (los(S, e)) keepRange(S, e, d, a, dt, 280, 420); else chase(S, e, a, e.spd, dt);
      e.face = a;
      if ((m.t -= dt) <= 0 && los(S, e)) tele(S, e, { type: 'aim', ang: a, len: 900, lock: false }, e.def.tele);
    } else if (e.st === 'tele') {
      if (e.tele.k < 0.72) e.tele.ang += G.clamp(G.angDiff(a, e.tele.ang), -2.5 * dt, 2.5 * dt);
      else e.tele.lock = true;
      e.face = e.tele.ang;
      const ang = e.tele.ang;
      if (teleTick(e, dt)) { shot(S, e, ang, 175, { shape: 'eneedle', r: 5, color: '#ff0044', life: 3 }); eshootEv(e); m.dbl = S.floor >= 1 ? ang : null; go(e, 'rec', 0.6); }
    } else if (m.dbl !== null && m.dbl !== undefined && m.t <= 0.42) { shot(S, e, m.dbl, 175, { shape: 'eneedle', r: 5, color: '#ff0044', life: 3 }); m.dbl = null; eshootEv(e); }
    else if ((m.t -= dt) <= 0) { m.side = -m.side; go(e, 'move', cd(e, S.rng.range(1.6, 2.0))); }
  });

  // 深渊骑士：近处扇形挥砍；中距离线预警突进 → 接一记挥砍；招式后硬直
  reg('knight', function (e, S, dt, d, a, m) {
    if (e.st === 'move') {
      chase(S, e, a, e.spd, dt); e.face = a;
      if ((m.t -= dt) <= 0) {
        if (d < 95) { m.mode = 'slash'; tele(S, e, { type: 'cone', ang: a, arc: 1.8, len: 105 }, e.def.tele + 0.05); }
        else if (d < 330 && los(S, e)) { m.mode = 'lunge'; m.ll = Math.min(d + 30, 320); tele(S, e, { type: 'line', ang: a, len: m.ll, w: e.r * 2 }, e.def.tele); }
        else m.t = 0.3;
      }
    } else if (e.st === 'tele') {
      const ang = e.tele.ang;
      if (teleTick(e, dt)) {
        e.face = ang;
        if (m.mode === 'slash') {
          m.slashAng = ang; m.slashT = 0.2;
          const pd = G.dist(e, S.p);
          if (pd < 105 + S.p.r * 0.5 && Math.abs(G.angDiff(G.angTo(e, S.p), ang)) < 0.9 + 0.1) G.hurtPlayer(S, heavy(S, e), e.name);
          G.emit && G.emit('shake', { amt: 2 });
          go(e, 'rec', m.combo ? 1.2 : 1.0); m.combo = 0;
        } else go(e, 'act', m.ll / 440);
      }
    } else if (e.st === 'act') {
      const blocked = mv(S, e, e.face, 440, dt);
      if (blocked || (m.t -= dt) <= 0) {
        m.mode = 'slash'; m.combo = 1;
        tele(S, e, { type: 'cone', ang: G.angTo(e, S.p), arc: 1.8, len: 105 }, 0.6);
      }
    } else if ((m.t -= dt) <= 0) go(e, 'move', cd(e, S.rng.range(0.7, 1.1)));
    if (m.slashT > 0) m.slashT -= dt;
  });

  // ---------- 精英词缀行为 ----------
  const AF = G.AFFIXES || {};
  if (AF.berserk) {
    AF.berserk.onTick = function (S, e) {
      const m = e.mem; if (m.baseSpd === undefined) m.baseSpd = e.spd;
      e.spd = m.baseSpd * (e.hp < e.maxHp * 0.5 ? 1.2 : 1);
    };
  }
  if (AF.shielded) {
    AF.shielded.onSpawn = function (S, e) { e.eshieldMax = Math.round(e.maxHp * 0.3); e.eshield = e.eshieldMax; e.mem.shT = 0; };
    AF.shielded.onTick = function (S, e, dt) {
      e.mem.shT = (e.mem.shT || 0) + dt;
      if (e.mem.shT >= 4 && e.eshield < e.eshieldMax) { e.eshield = e.eshieldMax; G.emit && G.emit('text', { x: e.x, y: e.y - e.r - 10, text: '护盾重生', color: '#2ce8f5', size: 14 }); }
    };
  }
  if (AF.vampiric) {
    AF.vampiric.onTick = function (S, e, dt) {
      if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.012 * dt);
    };
  }
  if (AF.volatile) {
    AF.volatile.onDeath = function (S, e) {
      G.addStrike(S, { x: e.x, y: e.y, rad: 70, t: Math.max(0.9, 0.9 * ((S.dm && S.dm.tele) || 1)), max: Math.max(0.9, 0.9 * ((S.dm && S.dm.tele) || 1)), dmg: 1, own: 'e', kind: 'slam', leave: null });
    };
  }

  // ---------- 生成 / 死亡 / 伤害 / 阶段 钩子 ----------
  G.Enemies = {
    h: { TAU, teleDur, tele, teleTick, mv, chase, keepRange, los, cd, heavy, shot, fanShot, ringShot, eshootEv, spotNear, ownedAlive, summon, go, reg },
    // spawnEnemy 只按 def 填基础值后调用这里：统一做 楼层×难度×词缀 缩放
    onSpawn(S, e) {
      const d = e.def || G.ENEMIES[e.type];
      e.mem = e.mem || {};
      if (e.elite && !d.boss) {
        if (!G.AFFIXES[e.elite]) e.elite = 'berserk';
        if (e.elite === 'splitter' && !d.shooter) e.elite = 'berserk';
      } else e.elite = null;
      const aff = e.elite ? G.AFFIXES[e.elite] : null;
      const fm = d.boss ? 1 : ((S.fdef && S.fdef.hpMul) || 1);
      const ehp = (S.dm && S.dm.ehp) || 1;
      e.hp = e.maxHp = Math.max(1, Math.round(d.hp * fm * ehp * (aff ? aff.hpMul : 1)));
      e.spd = d.spd * (aff ? aff.spdMul : 1);
      e.r = d.r * (aff ? 1.15 : 1);
      e.name = aff ? aff.name + '·' + d.name : d.name;
      e.phase = e.phase || 1;
      if (aff && aff.onSpawn) aff.onSpawn(S, e);
    },
    onTick(S, e, dt) {
      const aff = e.elite && G.AFFIXES[e.elite];
      if (aff && aff.onTick) aff.onTick(S, e, dt);
      if (e.boss) G.Enemies.phaseCheck(S, e);
    },
    // hurtEnemy 扣血前调用；返回实际伤害
    modDamage(S, e, dmg, o) {
      o = o || {};
      const m = e.mem || {};
      if (e.type === 'guard' && !m.shieldDown && e.st !== 'rec' && (o.kind === 'bullet' || o.kind === 'melee' || o.kind === 'beam' || !o.kind)) {
        const b = o.b, src = (b && (b.vx || b.vy)) ? Math.atan2(-b.vy, -b.vx) : G.angTo(e, S.p);
        if (Math.abs(G.angDiff(src, e.face || 0)) < 0.95) {
          dmg *= 0.2;
          if (!m.blkT || S.time - m.blkT > 0.4) { m.blkT = S.time; G.emit && G.emit('text', { x: e.x, y: e.y - e.r - 8, text: '格挡', color: '#c0cbdc', size: 14 }); }
        }
      }
      if (e.elite === 'shielded' && e.eshield > 0) {
        m.shT = 0;
        const ab = Math.min(e.eshield, dmg); e.eshield -= ab; dmg -= ab;
      } else if (e.elite === 'shielded') m.shT = 0;
      return dmg;
    },
    onDeath(S, e) {
      // 召唤物随召唤者消失
      for (const o of S.enemies) if (!o.dead && o.owner === e.id && o !== e) { o.hp = 0; G.killEnemy(S, o); }
      // 史莱姆分裂
      if (e.type === 'slime') {
        for (let i = 0; i < 2; i++) {
          G.spawnEnemy(S, 'slimelet', e.x + (i ? 10 : -10), e.y + (i ? 4 : -4), { summon: !!e.summon, owner: e.summon ? e.owner : null, spawnT: 0.25 });
        }
      }
      // 吸血精英吸收附近死去同伴
      if (!e.summon) for (const o of S.enemies) {
        if (o.dead || o === e || o.elite !== 'vampiric') continue;
        if (G.dist(o, e) < 220) { const n = Math.min(o.maxHp - o.hp, e.maxHp * 0.3); if (n > 0) { o.hp += n; G.emit && G.emit('heal', { x: o.x, y: o.y, n: Math.round(n) }); } }
      }
      const aff = e.elite && G.AFFIXES[e.elite];
      if (aff && aff.onDeath) aff.onDeath(S, e);
      e.tele = null;
    },
    // Boss 半血进入二阶段（sim 每步调用，冻结时也调用；AI 内部也会调用，幂等）
    phaseCheck(S, e) {
      if (!e.boss || e.dead || e.phase !== 1 || !(e.hp > 0) || e.hp > e.maxHp * 0.5) return;
      const m = e.mem || (e.mem = {});
      if (e.air && m.tx !== undefined) { e.x = m.tx; e.y = m.ty; }
      e.air = 0; e.hidden = 0; e.tele = null;
      m.pat = null; m.sub = 0; m.k = 0; m.idle = 0.9; e.st = 'move';
      G.bossPhase(S, e, 2, e.def.name + ' 进入狂暴！');   // sim 里只有 e.phase < 2 才生效，所以先调用再置位
      e.phase = 2; e.tele = null;
    }
  };
})(window.Game = window.Game || {});
