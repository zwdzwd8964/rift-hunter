// 模拟：新开一局、玩家、子弹、危险区、延迟打击、拾取、交互、房间逻辑、技能、结算、固定步长推进。模拟层：只用种子 RNG。
(function (G) {
  'use strict';
  const T = G.T, C = G.COLS, R = G.ROWS;
  G.input = { mx: 0, my: 0, ax: 0, ay: 0, fire: 0, dodge: 0, skill: 0, interact: 0, swap: 0, active: 0, assist: 0 };
  G.clearEdges = function (inp) { inp.dodge = inp.skill = inp.interact = inp.swap = inp.active = 0; };

  // ---------- 兜底数据（只有在对应模块缺失时使用，方便单独测试骨架）----------
  const FB_WEAPON = { name: '旧式手枪', desc: '可靠的随身武器。', rarity: 1, kind: 'gun', cost: 0, dmg: 3, rate: 4, spd: 520, spread: 0.06, n: 1, life: 0.9, r: 4, shape: 'bolt', color: '#fee761', pool: 'start' };
  const FB_FLOOR = { name: '未知区域', theme: 'moss', pool: [{ type: '_dummy', w: 1, from: 0 }], elite: 0, affixes: [], boss: '_dummyboss', wave: [2, 3], waves: [1, 2], bspd: 1 };
  if (!G.ENEMIES) G.ENEMIES = {};
  if (!G.ENEMIES._dummy) G.ENEMIES._dummy = { name: '训练假人', hp: 10, spd: 70, r: 13, ai: '_chase', gold: 2, energy: 0.3, contact: 1, fallback: true };
  if (!G.ENEMIES._dummyboss) G.ENEMIES._dummyboss = { name: '假人之王', hp: 120, spd: 60, r: 30, ai: '_chase', gold: 20, contact: 1, boss: true, noKnock: true, title: '测试守护者', fallback: true };
  G.AI = G.AI || {};
  if (!G.AI._chase) G.AI._chase = function (e, S, dt, d, a) { G.moveCircle(S.room, e, Math.cos(a) * e.spd * dt, Math.sin(a) * e.spd * dt, 'e'); e.moving = true; };
  G.weaponDef = (wid) => (G.WEAPONS && G.WEAPONS[wid]) || FB_WEAPON;
  G.floorDef = (f) => (G.FLOORS && G.FLOORS[f]) || FB_FLOOR;

  // ---------- 新开一局 ----------
  G.newRun = function (o) {
    o = o || {};
    const cid = G.CHARS[o.cid] ? o.cid : 'ranger';
    const diff = G.DIFFS[o.diff] ? o.diff : 'normal';
    const seed = (o.seed >>> 0);
    const S = {
      seed, cid, diff, dm: G.DIFFS[diff], god: !!o.god,
      rng: G.makeRng(G.mix(seed, 0xC0FFEE)), rngLoot: G.makeRng(G.mix(seed, 0x10075)),
      floor: 0, fdef: null, rooms: [], roomMap: null, room: null,
      state: 'play', time: 0, steps: 0, hitstop: 0, nextId: 1,
      enemies: [], bullets: [], hazards: [], strikes: [],
      boss: null, bossIntro: null, choice: null, banner: null, toast: null, prompt: '', nearItem: null,
      roomsCleared: 0, fightIdx: 0, victoryT: 0, waveDelay: 0,
      stats: { kills: 0, elites: 0, bossKills: 0, dmgDealt: 0, dmgTaken: 0, goldEarned: 0, relics: 0, roomsCleared: 0, cause: '', shots: 0, floorsCleared: 0 },
      summary: null
    };
    const mb = (o.meta && G.Meta && G.Meta.runBonuses) ? safeBonuses(o.meta) : {};
    S.p = makePlayer(S, cid, mb);
    G.recalcStats(S, true);
    const p = S.p; p.hp = p.maxHp; p.shield = p.shieldMax; p.energy = p.energyMax; p.armor = G.clamp(mb.armor || 0, 0, 3);
    loadFloor(S, 0);
    S.banner = { text: '第 1 层 · ' + S.fdef.name, sub: G.CHARS[cid].name + '，出发！', t: 2.6 };
    return S;
  };
  function safeBonuses(meta) { try { return G.Meta.runBonuses(meta) || {}; } catch (e) { G.reportError(e); return {}; } }

  function makePlayer(S, cid, mb) {
    const c = G.CHARS[cid];
    return {
      cid, x: G.RW / 2, y: G.RH / 2, r: 12, vx: 0, vy: 0, moving: false, aim: 0, face: 1, anim: 0,
      hp: 1, maxHp: 1, shield: 0, shieldMax: 0, armor: 0, energy: 0, energyMax: 0,
      iframes: 0, rolling: 0, rollCd: 0, rdx: 1, rdy: 0, hurtFlash: 0, lastHit: 99, regenT: 0,
      weapons: [c.weapon, null], wi: 0, fireCd: 0, charge: 0, spin: 0, beam: null, swing: null,
      skillCd: 0, skillMax: c.skill.cd, skillT: 0, wall: 0, absorbed: 0, critT: 0,
      buff: { rate: 1, crit: 0, dmg: 1 },
      relics: {}, relicOrder: [], synergies: {}, active: null,
      gold: (G.ECON.startGold || 0) + (mb.gold || 0), mb: mb || {}, st: {}
    };
  }

  function loadFloor(S, f) {
    S.floor = f; S.fdef = G.floorDef(f); S.boss = null; S.bossIntro = null; S.fightIdx = 0;
    const fl = G.genFloor(S.seed, f);
    S.rooms = fl.rooms; S.roomMap = fl.roomMap;
    const start = S.rooms.find(r => r.type === 'start') || S.rooms[0];
    G.enterRoom(S, start);
    if (f === 0 && G.Items && G.Items.pickWeapon) {
      const wid = safe(() => G.Items.pickWeapon(S, { minRarity: 2, maxRarity: 2, src: 'start' }));
      if (wid && G.WEAPONS && G.WEAPONS[wid]) start.items.push({ kind: 'weapon', wid, x: G.RW / 2 + 110, y: G.RH / 2, cd: 0 });
    }
  }
  function safe(fn, dflt) { try { return fn(); } catch (e) { G.reportError(e); return dflt; } }

  G.nextFloor = function (S) {
    S.stats.floorsCleared = Math.max(S.stats.floorsCleared, S.floor + 1);
    loadFloor(S, S.floor + 1);
    S.banner = { text: '第 ' + (S.floor + 1) + ' 层 · ' + S.fdef.name, sub: S.floor === 2 ? '最终层——深渊在注视着你' : '危险正在加剧', t: 2.6 };
    G.emit('floor', { floor: S.floor, name: S.fdef.name });
  };

  // ---------- 派生属性 ----------
  G.recalcStats = function (S, init) {
    const p = S.p, c = G.CHARS[p.cid], mb = p.mb || {};
    const st = {
      dmgMul: (mb.dmgMul || 1), rateMul: 1, spdMul: 1, bulletSpd: 1, bulletSize: 1, multi: 0, pierce: 0, bounce: 0, homing: 0,
      crit: 0.05, critMul: 2, dodgeCdMul: (mb.dodgeCdMul || 1), skillCdMul: 1,
      maxHp: c.hp + (mb.maxHp || 0) + (S.dm.php || 0), shieldMax: c.shield + (mb.shield || 0),
      shieldRegen: p.cid === 'knight' ? 1.5 : 1, energyMax: c.energy + (mb.energyMax || 0), energyRegen: G.ECON.energyRegen,
      goldMul: 1, magnet: 0, luck: 0, burnChance: 0, burnDps: 0, poisonChance: 0, poisonDps: 0,
      chillChance: p.cid === 'mage' ? 0.15 : 0, freezeBonus: 0, lifesteal: 0, thorns: 0, knock: 1, shopDiscount: mb.shopDiscount || 0
    };
    const before = JSON.stringify(p.synergies || {});
    const oldSyn = Object.assign({}, p.synergies || {});
    if (G.Items && G.Items.recalc) safe(() => G.Items.recalc(S, st));
    // 钳制
    st.skillCdMul = G.clamp(st.skillCdMul, 0.5, 2); st.dodgeCdMul = G.clamp(st.dodgeCdMul, 0.35, 2);
    st.maxHp = G.clamp(Math.round(st.maxHp), 1, 24); st.shieldMax = G.clamp(Math.round(st.shieldMax), 0, 8);
    st.energyMax = G.clamp(st.energyMax, 20, 600); st.crit = G.clamp(st.crit, 0, 1); st.multi = G.clamp(st.multi | 0, 0, 8);
    for (const k in st) if (typeof st[k] === 'number' && !isFinite(st[k])) st[k] = 0;
    const oldMax = p.maxHp;
    p.st = st; p.maxHp = st.maxHp; p.shieldMax = st.shieldMax; p.energyMax = st.energyMax;
    if (!init && p.maxHp > oldMax) p.hp += p.maxHp - oldMax;
    p.hp = Math.min(p.hp, p.maxHp); p.shield = Math.min(p.shield, p.shieldMax); p.energy = Math.min(p.energy, p.energyMax);
    if (!init && JSON.stringify(p.synergies || {}) !== before) {
      for (const fam in p.synergies) {
        const tier = p.synergies[fam] || 0;
        if (tier > (oldSyn[fam] || 0)) {
          const sy = G.SYNERGIES && G.SYNERGIES[fam]; if (!sy) continue;
          const td = sy.tiers && sy.tiers[tier - 1];
          S.banner = { text: '协同激活：' + sy.name + (tier > 1 ? ' · 二阶' : ''), sub: td ? td.desc : '', t: 3 };
          G.emit('synergy', { id: fam, name: sy.name, tier, desc: td ? td.desc : '' });
        }
      }
    }
    return st;
  };

  G.gainRelic = function (S, id) {
    const r = G.RELICS && G.RELICS[id]; if (!r) return false;
    const p = S.p;
    p.relics[id] = (p.relics[id] || 0) + 1;
    if (p.relicOrder.indexOf(id) < 0) p.relicOrder.push(id);
    S.stats.relics++;
    G.recalcStats(S);
    hook(S, 'onGain', { id, count: p.relics[id] });
    G.emit('relic', { id, name: r.name });
    G.emit('pickup', { kind: 'relic', x: p.x, y: p.y - 30, text: r.name, color: G.rarityColor(r.rarity) });
    return true;
  };
  function hook(S, name, ctx) { if (G.Items && G.Items.hook) { try { G.Items.hook(S, name, ctx); } catch (e) { G.reportError(e); } } return ctx; }
  G.hook = hook;

  // ---------- 三选一 ----------
  G.openChoice = function (S, src, n, o) {
    o = o || {};
    let opts = [];
    if (G.Items && G.Items.pickRelics) opts = safe(() => G.Items.pickRelics(S, n || 3, Object.assign({ src: o.srcKey || 'chest' }, o)), []) || [];
    opts = opts.filter(id => G.RELICS && G.RELICS[id]);
    if (!opts.length) { G.addGold(S, 15); S.toast = { text: '没有可选的遗物，获得 15 金币', t: 2 }; return false; }
    S.choice = { src: src || '宝箱', opts, t: 0 }; S.state = 'choice';
    return true;
  };
  G.chooseOption = function (S, i) {
    if (S.state !== 'choice' || !S.choice || !S.choice.opts[i]) return false;
    const id = S.choice.opts[i];
    S.choice = null; S.state = 'play';
    G.gainRelic(S, id);
    return true;
  };

  // ---------- 资源 ----------
  G.healPlayer = function (S, n) { const p = S.p; const h = Math.min(n, p.maxHp - p.hp); if (h > 0) { p.hp += h; G.emit('heal', { x: p.x, y: p.y, n: h }); } return h; };
  G.addShield = function (S, n) { const p = S.p; p.shield = Math.min(p.shieldMax, p.shield + n); };
  G.addArmor = function (S, n) { const p = S.p; p.armor = Math.min(3, p.armor + n); };
  G.addEnergy = function (S, n) { const p = S.p; p.energy = Math.min(p.energyMax, p.energy + n); };
  G.addGold = function (S, n) { const p = S.p; p.gold += n; S.stats.goldEarned += n; };

  // ---------- 伤害 ----------
  G.hurtPlayer = function (S, dmg, cause) {
    const p = S.p;
    if (S.state !== 'play' || S.god) return false;
    if (p.rolling > 0 || p.iframes > 0 || p.wall > 0) return false;
    let n = Math.max(1, Math.round(dmg || 1));
    const pre = { dmg: n, cause, cancel: false };
    hook(S, 'onPreHurt', pre);
    if (pre.cancel) { p.iframes = 0.5; G.emit('text', { x: p.x, y: p.y - 26, text: '闪避！', color: '#2ce8f5' }); return false; }
    n = pre.dmg;
    let shieldOnly = true;
    for (let i = 0; i < n; i++) {
      if (p.armor > 0) p.armor--; else if (p.shield > 0) p.shield--; else { p.hp--; shieldOnly = false; }
    }
    p.lastHit = 0; p.regenT = 0;
    S.stats.dmgTaken += n;
    p.iframes = G.ECON.iframes; p.hurtFlash = 0.3; S.hitstop = Math.max(S.hitstop, 0.06);
    G.emit('phurt', { x: p.x, y: p.y, dmg: n, shield: shieldOnly, hp: p.hp });
    hook(S, 'onHurt', { dmg: n, cause, shield: shieldOnly });
    if (p.hp <= 0) { p.hp = 0; G.finishRun(S, false, cause || '未知'); }
    return true;
  };

  G.hurtEnemy = function (S, e, dmg, o) {
    o = o || {};
    if (!e || e.dead || e.spawnT > 0 || e.inv > 0 || e.air || e.hidden) return 0;
    if (!isFinite(dmg) || dmg <= 0) return 0;
    let d = dmg;
    if (G.Items && G.Items.dmgMod) d = safe(() => G.Items.dmgMod(S, e, d, o), d);
    if (G.Enemies && G.Enemies.modDamage) d = safe(() => G.Enemies.modDamage(S, e, d, o), d);
    if (!isFinite(d) || d <= 0) { e.flash = Math.max(e.flash, 0.04); return 0; }
    e.hp -= d; e.flash = 0.1; S.stats.dmgDealt += d;
    const st = S.p.st;
    if (!e.boss && !e.def.noKnock && (o.kx || o.ky)) { const k = st.knock || 1; e.vx += (o.kx || 0) * k; e.vy += (o.ky || 0) * k; }
    const s = o.status;
    if (s) {
      const es = e.status || (e.status = {});
      const bossMul = e.boss ? 0.5 : 1;
      if (s.burn) { const b = es.burn || (es.burn = { t: 0, dps: 0 }); b.t = Math.max(b.t, s.burn[1]); b.dps = Math.max(b.dps, s.burn[0]); }
      if (s.poison) { const q = es.poison || (es.poison = { t: 0, dps: 0, stacks: 0 }); q.stacks = Math.min(5, q.stacks + 1); q.dps = Math.max(q.dps, s.poison[0]); q.t = Math.max(q.t, s.poison[1]); }
      if (s.chill) es.chill = Math.max(es.chill || 0, s.chill * bossMul);
      if (s.freeze && !e.air && !e.hidden) { if (e.boss) es.chill = Math.max(es.chill || 0, s.freeze); else es.freeze = Math.max(es.freeze || 0, s.freeze); }
    }
    G.emit('ehit', { x: e.x, y: e.y - e.r * 0.5, dmg: d, crit: !!o.crit, id: e.id, type: e.type, kind: o.kind || 'bullet' });
    hook(S, 'onHit', { e, dmg: d, crit: !!o.crit, kind: o.kind || 'bullet', b: o.b || null, src: o.src });
    if (e.hp <= 0) G.killEnemy(S, e, o);
    return d;
  };

  G.killEnemy = function (S, e, o) {
    if (!e || e.dead) return;
    e.dead = true; e.tele = null; e.hp = Math.min(e.hp, 0);
    if (!e.summon) { S.stats.kills++; if (e.elite) S.stats.elites++; if (e.boss) S.stats.bossKills++; }
    S.hitstop = Math.max(S.hitstop, e.boss ? 0.3 : 0.035);
    G.emit('ekill', { x: e.x, y: e.y, type: e.type, boss: e.boss, elite: e.elite, summon: !!e.summon, face: e.face, r: e.r });
    const p = S.p, rl = S.rngLoot;
    if (!e.summon) {
      let gold = Math.round((e.def.gold || 0) * 0.8 * (e.elite ? 2 : 1) * (p.st.goldMul || 1));
      while (gold > 0) { const v = gold >= 5 ? 5 : 1; gold -= v; dropAt(S, { kind: 'coin', v }, e.x, e.y, 16); }
      if (rl.chance(e.def.energy !== undefined ? e.def.energy : 0.3)) dropAt(S, { kind: 'energy', v: 6 }, e.x, e.y, 12);
      if (e.status && e.status.poison && e.status.poison.t > 0 && p.cid === 'alchemist') G.addEnergy(S, 3);
    }
    if (G.Enemies && G.Enemies.onDeath) safe(() => G.Enemies.onDeath(S, e));
    hook(S, 'onKill', { e, kind: (o && o.kind) || 'bullet' });
    for (const m of S.enemies) if (!m.dead && m.summon && m.owner === e.id) { m.dead = true; G.emit('ekill', { x: m.x, y: m.y, type: m.type, summon: true, face: m.face, r: m.r }); }
    if (e.boss) {
      for (const m of S.enemies) if (!m.dead && !m.boss) { m.dead = true; G.emit('ekill', { x: m.x, y: m.y, type: m.type, summon: true, face: m.face, r: m.r }); }
      S.bullets = S.bullets.filter(b => b.own !== 'e'); S.strikes = []; S.hazards = S.hazards.filter(h => h.own !== 'e');
      G.emit('shake', { amt: 18 });
    }
  };
  function dropAt(S, it, x, y, spread) {
    const rl = S.rngLoot, a = rl.range(0, Math.PI * 2), d = rl.range(0, spread);
    const f = G.placeFree(S.room, x + Math.cos(a) * d, y + Math.sin(a) * d, 6, 'p');
    it.x = f.x; it.y = f.y; S.room.items.push(it); return it;
  }
  G.dropAt = dropAt;

  G.explode = function (S, x, y, rad, dmg, own, o) {
    o = o || {};
    G.emit('explode', { x, y, rad, own });
    G.emit('shake', { amt: Math.min(14, 4 + rad / 12) });
    if (own === 'p' || own === 'n') {
      for (const e of S.enemies) {
        if (e.dead || Math.hypot(e.x - x, e.y - y) > rad + e.r) continue;
        const a = Math.atan2(e.y - y, e.x - x);
        G.hurtEnemy(S, e, dmg, { kind: 'explode', kx: Math.cos(a) * 180, ky: Math.sin(a) * 180, src: o.src });
      }
      damagePropsIn(S, x, y, rad, Math.max(4, dmg));
    }
    if (own === 'e' || own === 'n') {
      const p = S.p; if (Math.hypot(p.x - x, p.y - y) < rad + p.r * 0.5) G.hurtPlayer(S, o.pdmg || 1, o.cause || '爆炸');
      if (own === 'e') damagePropsIn(S, x, y, rad, 4);
    }
  };
  function damagePropsIn(S, x, y, rad, dmg) {
    for (const pr of S.room.props.slice()) if (Math.hypot(pr.x - x, pr.y - y) < rad + 14) G.damageProp(S, pr, dmg);
  }
  G.damageProp = function (S, pr, dmg) {
    const room = S.room; if (pr.hp <= 0) return;
    pr.hp -= dmg; pr.flash = 0.1;
    if (pr.hp > 0) return;
    const i = room.props.indexOf(pr); if (i >= 0) room.props.splice(i, 1);
    room.propGrid[pr.ty * C + pr.tx] = 0;
    G.emit('propbreak', { x: pr.x, y: pr.y, kind: pr.kind });
    if (pr.kind === 'barrel') G.explode(S, pr.x, pr.y, 72, 14 * (S.p.st.dmgMul || 1), 'n', { cause: '爆炸桶' });
    else {
      const rl = S.rngLoot, r = rl.next();
      if (r < 0.35) dropAt(S, { kind: 'coin', v: 1 }, pr.x, pr.y, 8);
      else if (r < 0.55) dropAt(S, { kind: 'energy', v: 8 }, pr.x, pr.y, 8);
      else if (r < 0.57) dropAt(S, { kind: 'heart', v: 2 }, pr.x, pr.y, 8);
    }
  };

  G.addHazard = function (S, h) {
    h.t = h.t || 1; h.max = h.max || h.t; h.tick = 0; h.rad = h.rad || 30; h.own = h.own || 'e';
    S.hazards.push(h); if (S.hazards.length > 120) S.hazards.splice(0, S.hazards.length - 120);
    return h;
  };
  G.addStrike = function (S, s) {
    const minT = 0.5 * Math.max(1, S.dm.tele || 1);
    s.max = Math.max(minT, s.max || s.t || 0.8, 0.5); s.t = s.max; s.rad = s.rad || 50; s.own = s.own || 'e';
    S.strikes.push(s); G.emit('tele', { x: s.x, y: s.y, kind: 'strike' });
    return s;
  };
  G.bossPhase = function (S, e, phase, text) {
    if (!e || e.phase >= phase) return;
    e.phase = phase; e.inv = Math.max(e.inv || 0, 1.4); e.tele = null;
    S.bullets = S.bullets.filter(b => b.own !== 'e'); S.strikes = [];
    S.banner = { text: text || (e.def.name + ' 进入狂暴！'), sub: '第二阶段', t: 2.2 };
    S.hitstop = Math.max(S.hitstop, 0.12);
    G.emit('bossphase', { id: e.type, name: e.def.name, phase, text: S.banner.text });
    G.emit('shake', { amt: 14 });
  };

  // ---------- 子弹 ----------
  G.spawnBullet = function (S, b) {
    b.own = b.own || 'p'; b.r = b.r || 4; b.dmg = b.dmg === undefined ? 1 : b.dmg; b.life = b.life || 1; b.max = b.max || b.life;
    b.vx = b.vx || 0; b.vy = b.vy || 0; b.pierce = b.pierce || 0; b.bounce = b.bounce || 0; b.homing = b.homing || 0;
    b.explode = b.explode || 0; b.hit = b.hit || []; b.dead = false;
    if (!b.shape) b.shape = b.own === 'e' ? 'eorb' : 'bolt';
    if (S.bullets.length >= G.MAX_BULLETS) { const i = S.bullets.findIndex(x => x.own === b.own); if (i >= 0) S.bullets.splice(i, 1); }
    S.bullets.push(b); return b;
  };
  G.eShot = function (S, x, y, ang, spd, o) {
    o = o || {};
    const k = (S.dm.bspd || 1) * ((S.fdef && S.fdef.bspd) || 1);
    let dmg = o.dmg || 1;
    if (S.dm.heavy && o.src && (o.src.elite || o.src.boss)) dmg = Math.max(dmg, 2);
    return G.spawnBullet(S, { own: 'e', x, y, vx: Math.cos(ang) * spd * k, vy: Math.sin(ang) * spd * k, r: o.r || 6, dmg, life: o.life || 6,
      shape: o.shape || 'eorb', color: o.color || '#ff0044', accel: o.accel || 0, curve: o.curve || 0, cause: o.cause || (o.src && o.src.def ? o.src.def.name : '敌人的子弹') });
  };
  G.ring = function (S, x, y, n, spd, off, o) { const out = []; for (let i = 0; i < n; i++) out.push(G.eShot(S, x, y, (off || 0) + i * Math.PI * 2 / n, spd, o)); return out; };
  G.fan = function (S, x, y, ang, n, spread, spd, o) { const out = []; for (let i = 0; i < n; i++) out.push(G.eShot(S, x, y, ang + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0), spd, o)); return out; };

  function updateBullets(S, dt) {
    const p = S.p, room = S.room;
    for (let bi = 0; bi < S.bullets.length; bi++) {
      const b = S.bullets[bi]; if (b.dead) continue;
      if (b.own === 'p' && b.special && G.Items && G.Items.bulletTick) { let h = false; try { h = G.Items.bulletTick(S, b, dt); } catch (e) { G.reportError(e); b.dead = true; } if (h) continue; }
      b.life -= dt; if (b.life <= 0) { b.dead = true; if (b.own === 'p' && b.explode) G.explode(S, b.x, b.y, b.explode, b.dmg, 'p', { src: b.src }); continue; }
      if (b.own === 'e') {
        if (b.accel) { const sp = Math.hypot(b.vx, b.vy) || 1, ns = Math.max(20, sp + b.accel * dt); b.vx *= ns / sp; b.vy *= ns / sp; }
        if (b.curve) { const a = Math.atan2(b.vy, b.vx) + b.curve * dt, sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; }
      } else if (b.homing) {
        let tg = null, td = 280;
        for (const e of S.enemies) { if (e.dead || e.spawnT > 0 || e.air || e.hidden) continue; const d = Math.hypot(e.x - b.x, e.y - b.y); if (d < td) { td = d; tg = e; } }
        if (tg) {
          const sp = Math.hypot(b.vx, b.vy), a = Math.atan2(b.vy, b.vx), df = G.angDiff(a, Math.atan2(tg.y - b.y, tg.x - b.x));
          const na = a + G.clamp(df, -4 * b.homing * dt, 4 * b.homing * dt); b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
      }
      const wr = Math.max(2, b.r * 0.6);
      b.x += b.vx * dt;
      if (G.hitsSolid(room, b.x, b.y, wr, 'b')) { wallHit(S, b, wr); if (b.bounce > 0 && !b.dead) { b.x -= b.vx * dt; b.vx = -b.vx; b.bounce--; } else b.dead = true; }
      if (!b.dead) {
        b.y += b.vy * dt;
        if (G.hitsSolid(room, b.x, b.y, wr, 'b')) { wallHit(S, b, wr); if (b.bounce > 0 && !b.dead) { b.y -= b.vy * dt; b.vy = -b.vy; b.bounce--; } else b.dead = true; }
      }
      if (b.dead) { if (b.own === 'p' && b.explode) G.explode(S, b.x, b.y, b.explode, b.dmg, 'p', { src: b.src }); else G.emit('bhit', { x: b.x, y: b.y, own: b.own, color: b.color }); continue; }
      if (b.own === 'e') {
        if (p.wall > 0 && Math.hypot(b.x - p.x, b.y - p.y) < 36) { b.dead = true; p.absorbed++; continue; }
        if (S.state === 'play' && p.rolling <= 0 && Math.hypot(b.x - p.x, b.y - p.y) < p.r * 0.6 + b.r * 0.85) { b.dead = true; G.hurtPlayer(S, b.dmg, b.cause || '敌人的子弹'); }
        continue;
      }
      for (const e of S.enemies) {
        if (e.dead || e.spawnT > 0 || e.air || e.hidden || b.hit.indexOf(e.id) >= 0) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) > e.r + b.r) continue;
        const sp = Math.hypot(b.vx, b.vy) || 1, kn = b.knock === undefined ? 110 : b.knock;
        G.hurtEnemy(S, e, b.dmg, { kx: b.vx / sp * kn, ky: b.vy / sp * kn, crit: !!b.crit, kind: 'bullet', status: b.status, src: b.src, b });
        if (b.explode) { G.explode(S, b.x, b.y, b.explode, b.dmg, 'p', { src: b.src }); b.dead = true; break; }
        if (b.pierce > 0) { b.pierce--; b.hit.push(e.id); } else { b.dead = true; break; }
      }
    }
    S.bullets = S.bullets.filter(b => !b.dead);
  }
  function wallHit(S, b, wr) {
    if (b.own !== 'p' && b.own !== 'e') return;
    // 命中道具（木箱/桶）
    const tx = Math.floor(b.x / T), ty = Math.floor(b.y / T);
    for (let yy = ty - 1; yy <= ty + 1; yy++) for (let xx = tx - 1; xx <= tx + 1; xx++) {
      const pr = G.propAt(S.room, xx, yy);
      if (pr && Math.abs(pr.x - b.x) < T / 2 + wr && Math.abs(pr.y - b.y) < T / 2 + wr) { if (b.own === 'p') G.damageProp(S, pr, b.dmg); b.bounce = 0; return; }
    }
  }

  // ---------- 危险区与延迟打击 ----------
  function updateHazards(S, dt) {
    const p = S.p;
    for (const h of S.hazards) {
      h.t -= dt; h.tick -= dt;
      if (h.tick > 0) continue;
      if (h.own === 'p') {
        h.tick = 0.25;
        for (const e of S.enemies) {
          if (e.dead || e.air || e.hidden || e.spawnT > 0) continue;
          if (Math.hypot(e.x - h.x, e.y - h.y) < h.rad + e.r * 0.6) {
            if (h.dps) G.hurtEnemy(S, e, h.dps * 0.25, { kind: h.kind === 'poison' ? 'poison' : 'burn', status: h.status, src: h.src });
            if (h.slow && !e.dead) e.status.chill = Math.max(e.status.chill || 0, e.boss ? 0.3 : 0.6);
          }
        }
      } else {
        h.tick = 0.1;
        if ((h.max - h.t) >= (h.arm || 0) && Math.hypot(p.x - h.x, p.y - h.y) < h.rad + p.r * 0.4) G.hurtPlayer(S, h.dmg || 1, h.cause || '危险地形');
      }
    }
    S.hazards = S.hazards.filter(h => h.t > 0);
    for (const s of S.strikes) {
      s.t -= dt;
      if (s.t > 0) continue;
      s.done = true;
      G.emit('strike', { x: s.x, y: s.y, rad: s.rad, kind: s.kind });
      if (s.own === 'e') { if (Math.hypot(p.x - s.x, p.y - s.y) < s.rad + p.r * 0.4) G.hurtPlayer(S, s.dmg || 1, s.cause || '落点打击'); }
      else for (const e of S.enemies) if (!e.dead && Math.hypot(e.x - s.x, e.y - s.y) < s.rad + e.r) G.hurtEnemy(S, e, s.dmg || 5, { kind: 'explode' });
      if (s.leave) G.addHazard(S, Object.assign({}, s.leave, { x: s.x, y: s.y }));
    }
    S.strikes = S.strikes.filter(s => !s.done);
    for (const pr of S.room.props) if (pr.flash > 0) pr.flash -= dt;
  }

  // ---------- 拾取与交互 ----------
  const AUTO = { coin: 1, heart: 1, armor: 1, energy: 1 };
  function updatePickups(S, dt) {
    const p = S.p, items = S.room.items, st = p.st;
    const mag = 64 + (st.magnet || 0) * 140;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.cd > 0) it.cd -= dt;
      if (!AUTO[it.kind]) continue;
      const wants = it.kind === 'coin' || it.kind === 'energy' || (it.kind === 'heart' && p.hp < p.maxHp) || (it.kind === 'armor' && p.armor < 3);
      if (!wants) continue;
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      const vac = !S.room.locked && (it.kind === 'coin' || it.kind === 'energy');
      if ((d < mag || vac) && d > 1) { const sp = (vac ? 520 : 400) * dt, m = Math.min(sp, d); it.x += (p.x - it.x) / d * m; it.y += (p.y - it.y) / d * m; }
      if (d < 22) {
        items.splice(i, 1);
        if (it.kind === 'coin') { G.addGold(S, it.v || 1); G.emit('pickup', { kind: 'coin', x: p.x, y: p.y - 20, text: '+' + (it.v || 1) + ' 金币', color: '#feae34' }); }
        else if (it.kind === 'heart') { G.healPlayer(S, it.v || 2); G.emit('pickup', { kind: 'heart', x: p.x, y: p.y - 24, text: '+1 颗心', color: '#e43b44' }); }
        else if (it.kind === 'armor') { G.addArmor(S, it.v || 1); G.emit('pickup', { kind: 'armor', x: p.x, y: p.y - 24, text: '+1 护甲', color: '#ead4aa' }); }
        else { G.addEnergy(S, it.v || 6); G.emit('pickup', { kind: 'energy', x: p.x, y: p.y - 24, text: '+' + (it.v || 6) + ' 能量', color: '#2ce8f5' }); }
      }
    }
    const ni = G.nearInteract(S);
    S.nearItem = ni; S.prompt = ni ? promptFor(S, ni) : '';
  }
  G.nearInteract = function (S) {
    let best = null, bd = 58;
    for (const it of S.room.items) {
      if (AUTO[it.kind] || it.kind === 'deco') continue;
      if (it.kind === 'altar' && it.used) continue;
      if ((it.kind === 'weapon' || it.kind === 'active') && it.cd > 0) continue;
      const d = Math.hypot(it.x - S.p.x, it.y - S.p.y); if (d < bd) { bd = d; best = it; }
    }
    return best;
  };
  G.shopPrice = function (S, it) { return Math.max(1, Math.round(it.price * (1 - (S.p.st.shopDiscount || 0)))); };
  function shopName(it) {
    if (it.what === 'heart') return '生命药水';
    if (it.what === 'armor') return '护甲片';
    if (it.what === 'energy') return '能量药剂';
    if (it.what === 'relic') return ((G.RELICS && G.RELICS[it.ref]) || {}).name || '遗物';
    if (it.what === 'weapon') return G.weaponDef(it.ref).name;
    if (it.what === 'active') return ((G.ACTIVES && G.ACTIVES[it.ref]) || {}).name || '主动道具';
    return '商品';
  }
  G.shopName = shopName;
  G.SHOP_DESC = { heart: '回复 2 颗心。', armor: '获得 2 点临时护甲（上限 3），优先抵挡伤害。', energy: '能量回满。' };
  function promptFor(S, it) {
    switch (it.kind) {
      case 'weapon': return 'E 拾取 ' + G.weaponDef(it.wid).name;
      case 'chest': return 'E 打开' + (it.tier === 'weapon' ? '武器箱' : '宝箱');
      case 'portal': return 'E 进入传送门';
      case 'active': return 'E 拾取 ' + (((G.ACTIVES && G.ACTIVES[it.id]) || {}).name || '主动道具') + '（主动道具，按 F 使用）';
      case 'shop': return 'E 购买 ' + shopName(it) + '（' + G.shopPrice(S, it) + ' 金币）';
      case 'altar': return (it.what === 'blood' ? 'E 献祭 ' + G.ECON.altarBlood + ' 点生命，换取一件稀有遗物' : 'E 供奉 ' + it.price + ' 金币，祈求遗物（三选一）') + '（两座祭坛只能选一座）';
      default: return '';
    }
  }
  function deny(S, text) { S.toast = { text, t: 1.8 }; G.emit('deny', { reason: text }); }
  G.deny = deny;

  G.interact = function (S) {
    const it = G.nearInteract(S), p = S.p; if (!it) return false;
    const items = S.room.items, rm = () => { const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); };
    if (it.kind === 'weapon') {
      const wid = it.wid, w = G.weaponDef(wid);
      if (!p.weapons[1]) { p.weapons[1] = wid; p.wi = 1; rm(); }
      else {
        const old = p.weapons[p.wi]; p.weapons[p.wi] = wid; rm();
        const f = G.placeFree(S.room, p.x, p.y + 20, 8, 'p'); items.push({ kind: 'weapon', wid: old, x: f.x, y: f.y, cd: 0.6 });
      }
      p.fireCd = Math.max(p.fireCd, 0.15); p.charge = 0; p.beam = null; p.spin = 0;
      G.emit('weapon', { id: wid });
      G.emit('pickup', { kind: 'weapon', x: p.x, y: p.y - 28, text: w.name, color: G.rarityColor(w.rarity) });
      return true;
    }
    if (it.kind === 'chest') {
      rm(); G.emit('pickup', { kind: 'chest', x: it.x, y: it.y - 20, text: '', color: '#feae34' });
      if (it.tier === 'weapon') {
        const wid = (G.Items && G.Items.pickWeapon) ? safe(() => G.Items.pickWeapon(S, { minRarity: it.minRarity || 2, src: it.minRarity >= 3 ? 'elite' : 'chest' })) : null;
        if (wid && G.WEAPONS && G.WEAPONS[wid]) items.push({ kind: 'weapon', wid, x: it.x, y: it.y, cd: 0.3 }); else G.addGold(S, 10);
      } else if (it.tier === 'gold') { for (let i = 0; i < 6; i++) dropAt(S, { kind: 'coin', v: 1 }, it.x, it.y, 24); }
      else G.openChoice(S, it.src || '宝箱', 3, { srcKey: it.srcKey || 'chest' });
      return true;
    }
    if (it.kind === 'shop') {
      const price = G.shopPrice(S, it);
      if (it.what === 'heart' && p.hp >= p.maxHp) { deny(S, '生命已满，不需要药水'); return false; }
      if (it.what === 'armor' && p.armor >= 3) { deny(S, '护甲已满'); return false; }
      if (p.gold < price) { deny(S, '金币不足（需要 ' + price + '）'); return false; }
      p.gold -= price; rm(); G.emit('buy', { what: it.what, price });
      if (it.what === 'heart') { G.healPlayer(S, 4); G.emit('pickup', { kind: 'heart', x: p.x, y: p.y - 24, text: '+2 颗心', color: '#e43b44' }); }
      else if (it.what === 'armor') G.addArmor(S, 2);
      else if (it.what === 'energy') G.addEnergy(S, 9999);
      else if (it.what === 'relic') G.gainRelic(S, it.ref);
      else if (it.what === 'weapon') items.push({ kind: 'weapon', wid: it.ref, x: it.x, y: it.y + 4, cd: 0.25 });
      else if (it.what === 'active') items.push({ kind: 'active', id: it.ref, x: it.x, y: it.y + 4, cd: 0.25 });
      return true;
    }
    if (it.kind === 'altar') {
      if (it.what === 'blood') {
        if (p.hp <= G.ECON.altarBlood) { deny(S, '生命不足，祭坛拒绝了你的献祭'); return false; }
        p.hp -= G.ECON.altarBlood; it.used = true; sealAltars(S, it);
        G.emit('phurt', { x: p.x, y: p.y, dmg: G.ECON.altarBlood, shield: false, hp: p.hp, altar: true });
        const ids = (G.Items && G.Items.pickRelics) ? safe(() => G.Items.pickRelics(S, 1, { src: 'altar', minRarity: 3 }), []) : [];
        if (ids && ids[0]) G.gainRelic(S, ids[0]); else G.addGold(S, 30);
        S.banner = { text: '血之祭坛', sub: '鲜血换来了力量', t: 2.2 };
      } else {
        if (p.gold < it.price) { deny(S, '金币不足（需要 ' + it.price + '）'); return false; }
        p.gold -= it.price; it.used = true; sealAltars(S, it); G.emit('buy', { what: 'altar', price: it.price });
        G.openChoice(S, '金之祭坛', 3, { srcKey: 'altar', minRarity: 2 });
      }
      return true;
    }
    if (it.kind === 'active') {
      const d = G.ACTIVES && G.ACTIVES[it.id]; if (!d) { rm(); return false; }
      const old = p.active; rm();
      p.active = { id: it.id, charge: it.charge !== undefined ? it.charge : d.charge, max: d.charge };
      if (old && old.id) { const f = G.placeFree(S.room, p.x, p.y + 20, 8, 'p'); items.push({ kind: 'active', id: old.id, charge: old.charge, x: f.x, y: f.y, cd: 0.6 }); }
      G.emit('weapon', { id: it.id, active: true });
      G.emit('pickup', { kind: 'active', x: p.x, y: p.y - 28, text: d.name + '（F 使用）', color: G.rarityColor(d.rarity || 2) });
      return true;
    }
    if (it.kind === 'portal') { G.nextFloor(S); return true; }
    return false;
  };
  G.swapWeapon = function (S) {
    const p = S.p; if (!p.weapons[1 - p.wi]) return false;
    p.wi = 1 - p.wi; p.fireCd = Math.max(p.fireCd, 0.12); p.charge = 0; p.beam = null; p.spin = 0;
    G.emit('weapon', { id: p.weapons[p.wi], swap: true }); return true;
  };

  // 房间首次进入时生成内容（商店货架、宝箱、祭坛）
  G.fillRoom = function (S, room) {
    const cx = G.RW / 2, cy = G.RH / 2, rl = S.rngLoot, f = S.floor, E = G.ECON.shop, add = f * E.floorAdd;
    if (room.type === 'treasure') {
      room.items.push({ kind: 'chest', tier: 'relic', x: cx, y: cy, src: '宝箱', srcKey: 'chest' });
      const aid = (G.Items && G.Items.pickActive) ? safe(() => G.Items.pickActive(S)) : null;
      if (aid && G.ACTIVES && G.ACTIVES[aid]) room.items.push({ kind: 'active', id: aid, x: cx + 130, y: cy + 10 });
    }
    else if (room.type === 'shop') {
      room.items.push({ kind: 'deco', sprite: 'shopkeeper', x: cx, y: cy - 112 });
      const goods = [{ what: 'heart', price: E.heart + add }, { what: rl.chance(0.5) ? 'armor' : 'energy' }];
      const rel = (G.Items && G.Items.pickRelics) ? (safe(() => G.Items.pickRelics(S, 1, { src: 'shop' }), []) || []) : [];
      rel.forEach(id => { const r = G.RELICS[id]; if (r) goods.push({ what: 'relic', ref: id, price: (E.relic[r.rarity] || 40) + add }); });
      const wid = (G.Items && G.Items.pickWeapon) ? safe(() => G.Items.pickWeapon(S, { minRarity: 2, src: 'shop' })) : null;
      if (wid && G.WEAPONS && G.WEAPONS[wid]) goods.push({ what: 'weapon', ref: wid, price: (E.weapon[G.WEAPONS[wid].rarity] || 30) + add });
      if (f >= 1 && G.Items && G.Items.pickActive) { const aid = safe(() => G.Items.pickActive(S)); if (aid && G.ACTIVES && G.ACTIVES[aid]) goods.push({ what: 'active', ref: aid, price: 28 + (G.ACTIVES[aid].rarity || 1) * 6 + add }); }
      goods.forEach((g, i) => {
        if (!g.price) g.price = (g.what === 'armor' ? E.armor : E.energy) + add;
        room.items.push({ kind: 'shop', what: g.what, ref: g.ref, price: g.price, x: cx + (i - (goods.length - 1) / 2) * 104, y: cy + 16 });
      });
    } else if (room.type === 'altar') {
      room.items.push({ kind: 'altar', what: 'blood', x: cx - 110, y: cy, used: false });
      room.items.push({ kind: 'altar', what: 'gold', price: G.ECON.altarGold[Math.min(2, f)], x: cx + 110, y: cy, used: false });
    }
  };

  // rogue3（评审 11）：祭坛房的血之祭坛与金之祭坛二选一——用掉一座，另一座随之熄灭（每局遗物约 13.5 → 11 件）
  function sealAltars(S, used) {
    let n = 0;
    for (const o of (S.room && S.room.items) || []) if (o !== used && o.kind === 'altar' && !o.used) { o.used = true; o.sealed = true; n++; }
    if (n) S.toast = { text: '另一座祭坛的火焰熄灭了', t: 2 };
  }

  // ---------- 房间逻辑 ----------
  function roomLogic(S, dt) {
    const room = S.room;
    if (!room.locked) return;
    for (const e of S.enemies) if (!e.dead) { S.waveDelay = 0.8; return; }
    S.waveDelay -= dt; if (S.waveDelay > 0) return;
    if ((room.type === 'fight' || room.type === 'elite') && room.waveIdx < room.waves) { G.spawnWave(S); return; }
    clearRoom(S, room);
  }
  function clearRoom(S, room) {
    room.cleared = true; room.locked = false; S.roomsCleared++; S.stats.roomsCleared++;
    G.emit('doors', { locked: false }); G.emit('roomclear', { type: room.type });
    const cx = G.RW / 2, cy = G.RH / 2, rl = S.rngLoot;
    hook(S, 'onRoomClear', { room });
    if (room.type === 'boss') {
      S.bullets = []; S.strikes = [];
      S.stats.floorsCleared = Math.max(S.stats.floorsCleared, S.floor + 1);
      if (S.floor >= 2) { S.victoryT = 2.8; S.banner = { text: (S.fdef.bossName || G.ENEMIES[S.fdef.boss] && G.ENEMIES[S.fdef.boss].name || '首领') + ' 已被击败！', sub: '裂隙正在闭合……', t: 3 }; return; }
      room.items.push({ kind: 'portal', x: cx, y: cy - 70 });
      dropAt(S, { kind: 'heart', v: 2 }, cx, cy + 60, 4);
      S.banner = { text: '首领已被击败！', sub: '选择一件遗物，然后进入传送门', t: 2.6 };
      G.openChoice(S, '首领战利品', 3, { srcKey: 'boss', minRarity: 3 });
      return;
    }
    if (room.type === 'elite') {
      if (rl.chance(0.5)) room.items.push({ kind: 'chest', tier: 'relic', x: cx, y: cy, src: '精英宝箱', srcKey: 'elite' });
      else room.items.push({ kind: 'chest', tier: 'weapon', x: cx, y: cy, src: '武器箱', minRarity: 3 });
      for (let i = 0; i < 4; i++) dropAt(S, { kind: 'coin', v: 1 }, cx, cy + 30, 30);
      return;
    }
    const nc = rl.int(1, 3); for (let i = 0; i < nc; i++) dropAt(S, { kind: 'coin', v: 1 }, cx, cy, 34);
    const r = rl.next();
    if (r < 0.12) dropAt(S, { kind: 'heart', v: 2 }, cx, cy, 10);
    else if (r < 0.22) dropAt(S, { kind: 'armor', v: 1 }, cx, cy, 10);
    else if (r < 0.38) dropAt(S, { kind: 'energy', v: 30 }, cx, cy, 10);
    else if (r < 0.45) room.items.push({ kind: 'chest', tier: 'weapon', x: cx, y: cy, src: '武器箱' });
  }

  // ---------- 玩家 ----------
  const FI = { fire: 0, ax: 0, ay: 0, assist: 0 };
  function assistAim(S, p) {
    let best = null, bd = 0.42;
    for (const e of S.enemies) {
      if (e.dead || e.spawnT > 0 || e.air || e.hidden) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y); if (d > 560) continue;
      const df = Math.abs(G.angDiff(p.aim, Math.atan2(e.y - p.y, e.x - p.x)));
      if (df < bd && G.lineOfSight(S.room, p.x, p.y, e.x, e.y)) { bd = df; best = e; }
    }
    if (best) p.aim = Math.atan2(best.y - p.y, best.x - p.x);
  }
  function basicFire(S, p, inp, dt) {
    p.fireCd = Math.max(0, p.fireCd - dt);
    if (!inp.fire || p.fireCd > 0) return;
    const wid = p.weapons[p.wi], w = G.weaponDef(wid), st = p.st;
    const n = (w.n || 1) + (st.multi || 0);
    for (let i = 0; i < n; i++) {
      const a = p.aim + (n > 1 ? (i / (n - 1) - 0.5) * ((w.spread || 0) + 0.1 * st.multi) : 0) + S.rng.range(-1, 1) * (w.spread || 0) * 0.4;
      const crit = S.rng.chance(st.crit + p.buff.crit);
      G.spawnBullet(S, { own: 'p', x: p.x + Math.cos(p.aim) * 14, y: p.y + Math.sin(p.aim) * 14, vx: Math.cos(a) * (w.spd || 500), vy: Math.sin(a) * (w.spd || 500), r: w.r || 4,
        dmg: (w.dmg || 3) * st.dmgMul * (crit ? st.critMul : 1), crit, life: w.life || 0.9, shape: w.shape || 'bolt', color: w.color, src: wid });
    }
    p.fireCd = 1 / ((w.rate || 4) * st.rateMul * p.buff.rate);
    G.emit('shoot', { x: p.x, y: p.y, ang: p.aim, wid, kind: w.kind || 'gun' });
  }
  function updatePlayer(S, inp, dt) {
    const p = S.p, st = p.st, ch = G.CHARS[p.cid], E = G.ECON;
    const ax = isFinite(inp.ax) ? inp.ax : p.x + 100, ay = isFinite(inp.ay) ? inp.ay : p.y;
    if (Math.hypot(ax - p.x, ay - p.y) > 2) p.aim = Math.atan2(ay - p.y, ax - p.x);
    if (inp.assist) assistAim(S, p);
    p.ax = ax; p.ay = ay;
    p.face = Math.cos(p.aim) >= 0 ? 1 : -1;
    p.iframes = Math.max(0, p.iframes - dt); p.rollCd = Math.max(0, p.rollCd - dt); p.skillCd = Math.max(0, p.skillCd - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt); p.critT = Math.max(0, p.critT - dt); p.anim += dt;
    if (p.skillT > 0) p.skillT = Math.max(0, p.skillT - dt);
    if (p.wall > 0) { p.wall -= dt; if (p.wall <= 0) { p.wall = 0; knightRelease(S); } }
    p.buff.rate = (p.cid === 'ranger' && p.skillT > 0) ? 2 : 1;
    p.buff.crit = p.critT > 0 ? 0.3 : 0;
    p.lastHit += dt;
    if (p.lastHit > E.shieldDelay && p.shield < p.shieldMax) {
      p.regenT += dt * (st.shieldRegen || 1);
      if (p.regenT >= E.shieldTick) { p.regenT = 0; p.shield++; G.emit('shieldup', { x: p.x, y: p.y, n: p.shield }); }
    }
    p.energy = Math.min(p.energyMax, p.energy + (st.energyRegen || 0) * dt);
    let mx = inp.mx || 0, my = inp.my || 0; const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    if (inp.dodge && p.rollCd <= 0 && p.rolling <= 0) {
      let dx = mx, dy = my; if (Math.hypot(dx, dy) < 0.1) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
      const l = Math.hypot(dx, dy) || 1;
      p.rolling = E.roll.dur; p.rdx = dx / l; p.rdy = dy / l;
      p.rollCd = ((p.cid === 'ranger' && p.skillT > 0) ? 0.05 : E.roll.cd) * st.dodgeCdMul;
      if (p.cid === 'ranger') p.critT = 1.0;
      G.emit('pdodge', { x: p.x, y: p.y, dx: p.rdx, dy: p.rdy });
      hook(S, 'onDodge', { p });
    }
    const spd = ch.spd * (st.spdMul || 1);
    if (p.rolling > 0) { p.rolling = Math.max(0, p.rolling - dt); G.moveCircle(S.room, p, p.rdx * spd * E.roll.mul * dt, p.rdy * spd * E.roll.mul * dt, 'p'); p.moving = true; }
    else { if (ml > 0.05) G.moveCircle(S.room, p, mx * spd * dt, my * spd * dt, 'p'); p.moving = ml > 0.05; }
    if (inp.swap) G.swapWeapon(S);
    if (inp.skill) G.useSkill(S);
    if (inp.interact) G.interact(S);
    if (inp.active && G.Items && G.Items.useActive) safe(() => G.Items.useActive(S));
    if (S.state !== 'play') return;
    FI.fire = inp.fire ? 1 : 0; FI.ax = ax; FI.ay = ay; FI.assist = inp.assist;   // 翻滚中不开火由 items 自行处理（保持蓄力）
    if (G.Items && G.Items.fire) { try { G.Items.fire(S, p, FI, dt); } catch (e) { G.reportError(e); } }
    else basicFire(S, p, FI, dt);
  }
  function knightRelease(S) {
    const p = S.p, n = G.clamp(Math.max(12, p.absorbed), 12, 36);
    for (let i = 0; i < n; i++) { const a = i * Math.PI * 2 / n; G.spawnBullet(S, { own: 'p', x: p.x, y: p.y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, r: 5, dmg: 4 * p.st.dmgMul, life: 0.9, shape: 'orb', color: '#fee761', src: 'skill' }); }
    p.absorbed = 0; G.emit('skill', { cid: 'knight', x: p.x, y: p.y, release: true });
  }
  G.useSkill = function (S) {
    const p = S.p, sk = G.CHARS[p.cid].skill;
    if (p.skillCd > 0 || S.state !== 'play') return false;
    let cd = sk.cd * (p.st.skillCdMul || 1);
    if (p.cid === 'knight') cd = Math.max(cd, sk.dur * 3);
    p.skillCd = cd; p.skillMax = cd;
    if (p.cid === 'ranger') { p.skillT = sk.dur; p.rollCd = 0; }
    else if (p.cid === 'mage') {
      const R0 = 200; p.skillT = 0.45;
      S.bullets = S.bullets.filter(b => b.own !== 'e' || Math.hypot(b.x - p.x, b.y - p.y) > R0 + 20);
      for (const e of S.enemies.slice()) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < R0 + e.r) G.hurtEnemy(S, e, 10 * p.st.dmgMul, { kind: 'skill', status: { freeze: 3 * (1 + (p.st.freezeBonus || 0)) } });
    } else if (p.cid === 'knight') { p.wall = sk.dur; p.skillT = sk.dur; p.absorbed = 0; }
    else if (p.cid === 'alchemist') {
      const d = Math.min(260, Math.hypot((p.ax || p.x) - p.x, (p.ay || p.y) - p.y));
      const f = G.placeFree(S.room, p.x + Math.cos(p.aim) * d, p.y + Math.sin(p.aim) * d, 4, 'b');
      p.skillT = 0.3;
      G.addHazard(S, { kind: 'poison', own: 'p', x: f.x, y: f.y, rad: 105, t: 5.5, dps: 9 * p.st.dmgMul * 1.5, slow: true, status: { poison: [4 * p.st.dmgMul, 3] }, src: 'skill' });
    }
    G.emit('skill', { cid: p.cid, x: p.x, y: p.y, ax: p.ax, ay: p.ay });
    return true;
  };

  // ---------- 敌人 ----------
  G.canSpawn = function (S, n) { let k = 0; for (const e of S.enemies) if (!e.dead) k++; return k + (n || 1) <= G.MAX_ENEMIES; };
  G.spawnEnemy = function (S, type, x, y, o) {
    o = o || {};
    const d = G.ENEMIES[type]; if (!d) return null;
    if (!o.force && !G.canSpawn(S, 1)) return null;
    const who = d.flying ? 'f' : 'e', r = d.r || 12;
    const f = G.placeFree(S.room, x, y, r, who);
    const e = {
      id: S.nextId++, type, def: d, name: d.name, x: f.x, y: f.y, r, hp: d.hp, maxHp: d.hp, spd: d.spd || 60, ai: d.ai || '_chase',
      elite: o.elite || null, boss: !!d.boss, summon: !!o.summon, owner: o.owner || null,
      vx: 0, vy: 0, flash: 0, spawnT: o.spawnT !== undefined ? o.spawnT : 0.7, moving: false, face: 0, t: 0, st: 'idle', tele: null,
      inv: 0, phase: 1, air: 0, hidden: 0, status: {}, mem: {}, anim: 0
    };
    if (e.elite) e.name = ((G.AFFIXES && G.AFFIXES[e.elite]) ? G.AFFIXES[e.elite].name : '精英') + '·' + d.name;
    if (G.Enemies && G.Enemies.onSpawn) safe(() => G.Enemies.onSpawn(S, e));
    else { const k = (d.boss ? 1 : (1 + S.floor * 0.35)) * (S.dm.ehp || 1) * (e.elite ? 2 : 1); e.hp = e.maxHp = d.hp * k; }
    if (G.hitsSolid(S.room, e.x, e.y, e.r, who)) { const f2 = G.placeFree(S.room, e.x, e.y, e.r, who); e.x = f2.x; e.y = f2.y; }
    S.enemies.push(e); return e;
  };
  G.updateEnemies = function (S, dt) {
    const p = S.p;
    for (let i = 0; i < S.enemies.length; i++) {
      const e = S.enemies[i]; if (e.dead) continue;
      e.flash = Math.max(0, e.flash - dt); e.inv = Math.max(0, (e.inv || 0) - dt); e.anim += dt;
      if (e.boss && G.Enemies && G.Enemies.phaseCheck) safe(() => G.Enemies.phaseCheck(S, e));
      if (e.spawnT > 0) { e.spawnT -= dt; continue; }
      const ox = e.x, oy = e.y, who = e.def.flying ? 'f' : 'e';
      if (e.vx || e.vy) { G.moveCircle(S.room, e, e.vx * dt, e.vy * dt, who); e.vx *= 0.82; e.vy *= 0.82; if (Math.abs(e.vx) + Math.abs(e.vy) < 5) e.vx = e.vy = 0; }
      const es = e.status;
      if (es.burn && es.burn.t > 0) { es.burn.t -= dt; es.bt = (es.bt || 0) - dt; if (es.bt <= 0) { es.bt = 0.5; G.hurtEnemy(S, e, es.burn.dps * 0.5, { kind: 'burn' }); } }
      if (es.poison && es.poison.t > 0) {
        es.poison.t -= dt; es.pt = (es.pt || 0) - dt;
        if (es.pt <= 0) { es.pt = 0.5; const k = (1 + 0.25 * Math.max(0, es.poison.stacks - 1)) * (p.cid === 'alchemist' ? 1.5 : 1); G.hurtEnemy(S, e, es.poison.dps * 0.5 * k, { kind: 'poison' }); }
        if (es.poison.t <= 0) es.poison.stacks = 0;
      }
      if (e.dead) continue;
      if (es.chill > 0) es.chill -= dt;
      if (es.freeze > 0) { es.freeze -= dt; if (!e.air && !e.hidden) { e.moving = false; continue; } }
      if (G.Enemies && G.Enemies.onTick) safe(() => G.Enemies.onTick(S, e, dt));
      if (e.dead) continue;
      const sdt = es.chill > 0 ? dt * 0.6 : dt;
      const d = Math.hypot(p.x - e.x, p.y - e.y), a = Math.atan2(p.y - e.y, p.x - e.x);
      const ai = G.AI[e.ai] || G.AI._chase;
      try { ai(e, S, sdt, d, a); } catch (err) { G.reportError(err); e.ai = '_chase'; }
      if (e.dead) continue;
      e.moving = Math.abs(e.x - ox) + Math.abs(e.y - oy) > 0.05;
      if (!e.air && !e.hidden && e.def.contact !== 0 && d < e.r + p.r - 3) G.hurtPlayer(S, (S.dm.heavy && (e.elite || e.boss)) ? 2 : (e.def.contact || 1), e.name);
      if (!isFinite(e.x) || !isFinite(e.y)) { e.x = ox; e.y = oy; if (!isFinite(e.x) || !isFinite(e.y)) { e.x = G.RW / 2; e.y = G.RH / 2; } }
      if ((S.steps + e.id) % 30 === 0 && !e.air && G.hitsSolid(S.room, e.x, e.y, e.r * 0.8, who)) { const f = G.placeFree(S.room, e.x, e.y, e.r, who); e.x = f.x; e.y = f.y; }
    }
    S.enemies = S.enemies.filter(e => !e.dead);
  };

  // ---------- 固定步长推进 ----------
  G.step = function (S, inp) {
    inp = inp || G.input;
    if (S.state !== 'play') { G.clearEdges(inp); return; }
    S.steps++;
    if (S.hitstop > 0) { S.hitstop -= G.DT; return; }
    const dt = G.DT;
    S.time += dt;
    updatePlayer(S, inp, dt);
    G.clearEdges(inp);
    if (S.state !== 'play') return;
    G.updateEnemies(S, dt);
    updateBullets(S, dt);
    updateHazards(S, dt);
    updatePickups(S, dt);
    hook(S, 'onTick', { dt });
    if (S.state !== 'play') return;
    roomLogic(S, dt);
    if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
    if (S.toast) { S.toast.t -= dt; if (S.toast.t <= 0) S.toast = null; }
    if (S.bossIntro) { S.bossIntro.t -= dt; if (S.bossIntro.t <= 0) S.bossIntro = null; }
    if (S.victoryT > 0) { S.victoryT -= dt; if (S.victoryT <= 0) { G.finishRun(S, true, ''); return; } }
    G.checkDoors(S);
  };

  // ---------- 结算 ----------
  G.finishRun = function (S, win, cause) {
    if (S.summary) return S.summary;
    S.state = win ? 'victory' : 'dead';
    if (win) S.stats.floorsCleared = 3;
    S.stats.cause = win ? '' : (cause || '未知');
    S.choice = null;
    S.summary = {
      win: !!win, floor: S.floor + 1, floorName: S.fdef.name, kills: S.stats.kills, bossKills: S.stats.bossKills, elites: S.stats.elites,
      time: S.time, seed: S.seed, cid: S.cid, diff: S.diff, cause: S.stats.cause,
      relics: S.p.relicOrder.slice(), relicCounts: Object.assign({}, S.p.relics), weapons: S.p.weapons.filter(Boolean),
      gold: S.stats.goldEarned, dmgDealt: Math.round(S.stats.dmgDealt), dmgTaken: S.stats.dmgTaken, rooms: S.stats.roomsCleared, reward: null,
      abandoned: !!S.abandoned, daily: (typeof S.daily === 'string') ? S.daily : null
    };
    G.emit('runend', { win: !!win, summary: S.summary });
    return S.summary;
  };
})(window.Game = window.Game || {});
