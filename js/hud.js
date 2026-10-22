/* hud.js — 局内 HUD（逻辑坐标 960x540）。所有者：ui
 * 布局：顶部条 y∈[0,84)（左：生命/护盾/护甲/能量/金币；中：层数/用时/种子；右：武器 2 槽）；
 *       左边栏 x∈[0,100)：技能冷却环、主动道具、遗物栏；右边栏 x∈[860,960)：小地图、协同进度。
 *       新手提示：顶部 HUD 带中间的紧凑提示条（暂时替换层数/用时），不进入战斗区；战斗中自动变淡。
 *       临时元素（横幅/提示/首领字幕/交互提示/对比卡）只出现在房间上沿或下沿，不挡房间中心。
 *       小窗口（G.view.scale<0.9）：所有 HUD 文字至少 ceil(11.1/scale) 逻辑 px，次要信息（种子等）隐藏。
 * 只读 S，不修改 S。G.uik 是 hud/ui 共用的小工具。 */
(function (G) {
  'use strict';
  const K = G.uik = {};

  // ---------- 共用工具 ----------
  K.gfx = () => G.gfx;
  K.T = (ctx, s, x, y, size, color, align, bold, o) => G.gfx.txt(ctx, s, x, y, size, color, align, bold, o);
  K.sprite = function (name, frame) {
    try { if (G.Sprites && G.Sprites.has && G.Sprites.has(name)) return G.Sprites.get(name, frame === undefined ? 0 : frame); } catch (e) { /* ignore */ }
    return null;
  };
  // 在 (cx,cy) 居中画精灵，按整数倍缩放到不超过 box；没有精灵时调用 fb(ctx,cx,cy,box)；返回是否画了精灵
  K.icon = function (ctx, name, cx, cy, box, fb, o) {
    const c = K.sprite(name, o && o.frame);
    if (c && c.width) {
      let sc = Math.max(1, Math.floor(box / Math.max(c.width, c.height)));
      if (o && o.scale) sc = o.scale;
      const w = c.width * sc, h = c.height * sc;
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      if (o && o.alpha !== undefined) { ctx.save(); ctx.globalAlpha *= o.alpha; }
      ctx.drawImage(c, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
      if (o && o.alpha !== undefined) ctx.restore();
      ctx.imageSmoothingEnabled = prev;
      return true;
    }
    if (fb) fb(ctx, cx, cy, box);
    else { ctx.fillStyle = (o && o.color) || '#5a6988'; ctx.fillRect(Math.round(cx - box / 3), Math.round(cy - box / 3), Math.round(box * 2 / 3), Math.round(box * 2 / 3)); }
    return false;
  };
  // 像素心形后备图（kind 0 空 1 半 2 满）
  K.heartFb = function (kind) {
    return function (ctx, cx, cy, box) {
      const u = Math.max(2, Math.floor(box / 8));
      const P = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
      const x0 = Math.round(cx - 3.5 * u), y0 = Math.round(cy - 3 * u);
      for (let r = 0; r < P.length; r++) for (let c = 0; c < 7; c++) {
        if (P[r][c] !== '#') continue;
        const full = kind === 2 || (kind === 1 && c < 4);
        ctx.fillStyle = full ? G.COL.hp : '#3a4466';
        ctx.fillRect(x0 + c * u, y0 + r * u, u, u);
      }
    };
  };
  K.shieldFb = function (on, color) {
    return function (ctx, cx, cy, box) {
      const u = Math.max(2, Math.floor(box / 8));
      const P = ['######', '######', '######', '.####.', '..##..'];
      const x0 = Math.round(cx - 3 * u), y0 = Math.round(cy - 2.5 * u);
      for (let r = 0; r < P.length; r++) for (let c = 0; c < 6; c++) {
        if (P[r][c] !== '#') continue;
        ctx.fillStyle = on ? (color || G.COL.shield) : '#3a4466';
        ctx.fillRect(x0 + c * u, y0 + r * u, u, u);
      }
    };
  };
  K.coinFb = function (ctx, cx, cy, box) { G.gfx.circle(ctx, cx, cy, box * 0.32, G.COL.gold, '#be4a2f', 2); };
  K.crystalFb = function (ctx, cx, cy, box) {
    const r = box * 0.38; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.7, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.7, cy); ctx.closePath();
    ctx.fillStyle = G.COL.crystal; ctx.fill(); ctx.strokeStyle = G.COL.crystalHi; ctx.lineWidth = 1.5; ctx.stroke();
  };
  K.relicColor = function (id) { const r = G.RELICS && G.RELICS[id]; return G.rarityColor(r ? r.rarity : 1); };
  K.relicIcon = function (ctx, id, cx, cy, box) {
    K.icon(ctx, 'icon_' + id, cx, cy, box, function (c, x, y, b) {
      G.gfx.rrect(c, x - b * 0.38, y - b * 0.38, b * 0.76, b * 0.76, 3, '#262b44', K.relicColor(id), 2);
    });
  };
  K.weaponIcon = function (ctx, wid, cx, cy, box) {
    K.icon(ctx, 'weapon_' + wid, cx, cy, box, function (c, x, y, b) {
      const w = G.WEAPONS && G.WEAPONS[wid];
      c.fillStyle = w ? G.rarityColor(w.rarity) : '#8b9bb4'; c.fillRect(Math.round(x - b * 0.4), Math.round(y - 3), Math.round(b * 0.8), 6);
      c.fillRect(Math.round(x - b * 0.3), Math.round(y), 6, 8);
    });
  };
  K.familyName = function (f) {
    const s = G.SYNERGIES && G.SYNERGIES[f];
    if (s && s.name) return s.name;
    return { fire: '烈焰', frost: '寒霜', barrage: '弹幕', crit: '暴击', aegis: '护盾', toxic: '剧毒' }[f] || '';
  };
  K.familyColor = function (f) {
    const s = G.SYNERGIES && G.SYNERGIES[f];
    if (s && s.color) return s.color;
    return { fire: '#f77622', frost: '#2ce8f5', barrage: '#fee761', crit: '#e43b44', aegis: '#c0cbdc', toxic: '#63c74d' }[f] || '#8b9bb4';
  };
  K.weaponStats = function (w) {
    if (!w) return null;
    const n = Math.max(1, w.n || 1), rate = w.rate || 1, dmg = w.dmg || 0;
    return { dmg, n, rate, cost: w.cost || 0, dps: dmg * n * rate };
  };
  K.fmtNum = function (v) { return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1); };
  K.inRect = (x, y, r) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  K.tooltip = function (ctx, mx, my, title, tcolor, lines, w) {
    w = w || 240;
    const body = [];
    const f1 = Math.max(14, minF), f2 = Math.max(16, minF), lh = f1 + 6;   // minF 只在 HUD.draw 期间非 0
    lines.forEach(l => { G.gfx.wrapLines(ctx, l.text, w - 20, f1).forEach(s => body.push({ text: s, color: l.color })); });
    const h = 34 + body.length * lh + 6;
    let x = mx + 16, y = my + 12;
    if (x + w > G.VW - 4) x = mx - w - 12;
    if (y + h > G.VH - 4) y = G.VH - 4 - h;
    x = Math.max(4, x); y = Math.max(4, y);
    G.gfx.panel(ctx, x, y, w, h, { edge: tcolor || G.COL.edgeHi, fill: 'rgba(24,20,37,0.97)' });
    K.T(ctx, G.gfx.fit(ctx, title, w - 20, f2, true), x + 10, y + 18, f2, tcolor || '#fff', 'left', true);
    body.forEach((b, i) => K.T(ctx, b.text, x + 10, y + 42 + i * lh, f1, b.color || G.COL.text, 'left'));
  };
  K.now = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

  // ---------- 小窗口字号 ----------
  // HUD.draw 期间有效：G.view.scale < 0.9 时把所有 HUD 文字抬到 ceil(11.1/scale) 逻辑 px（换算后 ≥11 CSS px），并启用紧凑布局。
  let minF = 0, compact = false;
  const fz = (n) => Math.max(n, minF);
  const T = (ctx, s, x, y, size, color, align, bold, o) => K.T(ctx, s, x, y, fz(size), color, align, bold, o);
  K.hudFont = fz;

  // ---------- 新手提示 ----------
  // 显示为顶部 HUD 带中间的紧凑提示条（x≈260..626, y 3..81），完全不进入战斗区（100..860 × 84..524）。
  const HINTS = {
    move: { title: '基本操作', text: 'WASD 移动，鼠标瞄准、按住左键射击；只用键盘时按方向键朝该方向射击。' },
    dodge: { title: '翻滚躲弹', text: '按空格或右键翻滚：翻滚过程中无敌，可以直接穿过子弹。' },
    tele: { title: '危险预警', text: '红色区域 = 即将受到攻击，填满前离开。' },
    boss: { title: '首领战', text: '首领登场！地上的红色区域填满时就会落下攻击，提前离开；翻滚可以穿过子弹。' },
    weapon: { title: '拾取武器', text: '按 E 拾取地上的武器，最多携带两把；按 X 或滚动滚轮切换。' },
    chest: { title: '宝箱', text: '按 E 打开宝箱，从三件遗物中挑选一件带走。' },
    shop: { title: '商店', text: '靠近商品按 E 用金币购买。金币来自击败敌人、清理房间、打破木箱。' },
    altar: { title: '祭坛', text: '两座祭坛只能选一座：献祭生命或供奉金币，换取遗物。' },
    skill: { title: '技能就绪', text: '角色技能冷却完毕（左侧圆环）：按 Q 释放，危急时刻用它扭转战局。' },
    synergy: { title: '遗物协同', text: '同系遗物集齐 2 件和 3 件会触发协同效果，按 Esc 可在暂停页查看进度。' }
  };
  K.HINTS = HINTS;
  const HINT_BAR = { x1: 626, y: 3, h: 78, bgAlpha: 0.6, combatAlpha: 0.5 };
  const hs = { cur: null, t0: 0, rect: null, forced: [], done: {}, alpha: 1, lastT: 0, combat: false };

  function hintsOn() { return !G.settings || G.settings.hints !== false; }
  function seen(id) { return !!hs.done[id] || (G.Meta && G.Meta.hintSeen ? G.Meta.hintSeen(id) : false); }
  function closeHint() {
    if (!hs.cur) return false;
    hs.done[hs.cur] = true;
    try { if (G.Meta && G.Meta.markHint) G.Meta.markHint(hs.cur); } catch (e) { /* ignore */ }
    hs.cur = null; hs.rect = null;
    return true;
  }
  function enqueue(id) {
    if (HINTS[id] && !seen(id) && hs.forced.indexOf(id) < 0 && hs.cur !== id) hs.forced.push(id);
  }
  // 根据状态检测需要排队的提示（只读 S，不改 sim）
  function detectHints(S) {
    if (S.state !== 'play') return;
    const b = S.boss;
    // 首领登场字幕结束（S.bossIntro 为空或 t<=0）且首领还活着
    if (b && !b.dead && b.hp > 0 && !(S.bossIntro && S.bossIntro.t > 0)) enqueue('boss');
    // 第 1 层第一次出现敌人预警（敌人 e.tele / 落点打击 S.strikes）
    if (S.floor === 0) {
      const tele = (S.enemies || []).some(e => e && !e.dead && e.tele) || (S.strikes && S.strikes.length > 0);
      if (tele) enqueue('tele');
    }
  }
  function pickHint(S) {
    while (hs.forced.length) { const id = hs.forced.shift(); if (!seen(id)) return id; }
    if (S.floor !== 0 || S.state !== 'play') return null;
    const p = S.p, room = S.room || {}, ni = S.nearItem;
    const cand = [];
    cand.push('move');
    if (S.bullets && S.bullets.some(b => b.own === 'e')) cand.push('dodge');
    if (ni && ni.kind === 'weapon') cand.push('weapon');
    if (ni && ni.kind === 'chest') cand.push('chest');
    if (room.type === 'shop') cand.push('shop');
    if (room.type === 'altar') cand.push('altar');
    if (p && p.skillCd <= 0 && S.enemies && S.enemies.length && S.time > 25) cand.push('skill');
    if (p && p.relicOrder && G.RELICS && p.relicOrder.some(id => G.RELICS[id] && G.RELICS[id].family)) cand.push('synergy');
    for (const id of cand) if (!seen(id)) return id;
    return null;
  }
  // 战斗中：房间里有活着的敌人，且玩家附近（260 px 内）有敌弹
  function inCombat(S) {
    const p = S.p; if (!p) return false;
    const alive = (S.enemies || []).some(e => e && !e.dead && e.hp > 0);
    if (!alive) return false;
    return (S.bullets || []).some(b => b && b.own === 'e' && Math.abs(b.x - p.x) < 260 && Math.abs(b.y - p.y) < 260 && Math.hypot(b.x - p.x, b.y - p.y) < 260);
  }
  // 每帧更新提示状态（检测/排队/计时/战斗淡出）；返回当前提示 id 或 null
  function updateHint(S) {
    if (!hintsOn()) { hs.cur = null; hs.rect = null; return null; }
    detectHints(S);
    const st = S.time || 0;
    if (hs.cur && (st - hs.t0 > 14 || st < hs.t0)) closeHint();
    if (!hs.cur) { const id = pickHint(S); if (id) { hs.cur = id; hs.t0 = st; hs.alpha = 1; hs.lastT = st; } }
    if (!hs.cur || !HINTS[hs.cur]) { hs.cur = null; return null; }
    hs.combat = inCombat(S);
    const target = hs.combat ? HINT_BAR.combatAlpha : 1, dt = Math.max(0, Math.min(0.2, st - hs.lastT));
    hs.lastT = st;
    hs.alpha = target < hs.alpha ? Math.max(target, hs.alpha - dt * 3) : Math.min(target, hs.alpha + dt * 1.5);
    return hs.cur;
  }
  // 提示条左边界：避开生命/护盾/能量/金币
  function vitalsRight(ctx, S) {
    const p = S.p || {};
    const hearts = Math.max(1, Math.ceil((p.maxHp || 2) / 2)), shown = Math.min(hearts, 10);
    let r = 20 + shown * 28 - 14 + (hearts > shown ? 34 : 0);
    const sm = Math.min(p.shieldMax || 0, 8), ar = Math.min(p.armor || 0, 3);
    r = Math.max(r, 8 + sm * 24 + (ar > 0 ? (sm ? 6 : 0) + ar * 24 : 0), 184);
    r = Math.max(r, 216 + G.gfx.measure(ctx, String(p.gold || 0), fz(16), true));
    return Math.round(r + 12);
  }
  function hintLayout(ctx, S) {
    const h = HINTS[hs.cur];
    const x = Math.max(250, vitalsRight(ctx, S)), w = HINT_BAR.x1 - x, y = HINT_BAR.y, hgt = HINT_BAR.h;
    const fb = fz(14), ft = fz(15);
    let lines = G.gfx.wrapLines(ctx, h.text, w - 20, fb), titled = true;
    if (lines.length > 2) {     // 放不下：把标题并入正文，三行排满，不显示“回车关闭”
      titled = false;
      lines = G.gfx.wrapLines(ctx, '【' + h.title + '】' + h.text, w - 20, fb);
      if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = G.gfx.fit(ctx, lines[2] + '……', w - 20, fb); }
    }
    return { x, y, w, h: hgt, fb, ft, lines, titled, title: '提示 · ' + h.title };
  }
  function drawHint(ctx, S) {
    if (!hs.cur || !HINTS[hs.cur]) return;
    const L = hintLayout(ctx, S), x = L.x, y = L.y, w = L.w;
    hs.rect = { x, y, w, h: L.h };
    const st = S.time || 0, pop = Math.min(1, Math.max(0, (st - hs.t0) * 4) + 0.6);
    ctx.save(); ctx.globalAlpha *= Math.min(pop, hs.alpha);
    ctx.fillStyle = 'rgba(38,43,68,' + HINT_BAR.bgAlpha + ')'; ctx.fillRect(x, y, w, L.h);
    ctx.fillStyle = G.COL.key;
    ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y + L.h - 2, w, 2); ctx.fillRect(x, y, 2, L.h); ctx.fillRect(x + w - 2, y, 2, L.h);
    if (L.titled) {
      const close = '回车关闭', cw = G.gfx.measure(ctx, close, L.fb, false);
      T(ctx, G.gfx.fit(ctx, L.title, w - 34 - cw, L.ft, true), x + 10, y + 12, L.ft, G.COL.key, 'left', true);
      T(ctx, close, x + w - 10, y + 12, L.fb, G.COL.dim, 'right');
      L.lines.forEach((ln, i) => T(ctx, ln, x + 10, y + 35 + i * 23, L.fb, '#fff', 'left'));
    } else {
      L.lines.forEach((ln, i) => T(ctx, ln, x + 10, y + 13 + i * 26, L.fb, i === 0 ? G.COL.key : '#fff', 'left'));
    }
    ctx.restore();
  }

  // ---------- 各块 ----------
  function drawVitals(ctx, S) {
    const p = S.p; if (!p) return;
    const hearts = Math.max(1, Math.ceil((p.maxHp || 2) / 2)), shown = Math.min(hearts, 10);
    for (let i = 0; i < shown; i++) {
      const v = (p.hp || 0) - i * 2, kind = v >= 2 ? 2 : v === 1 ? 1 : 0;
      const nm = kind === 2 ? 'ui_heart_full' : kind === 1 ? 'ui_heart_half' : 'ui_heart_empty';
      K.icon(ctx, nm, 20 + i * 28, 18, 26, K.heartFb(kind));
    }
    if (hearts > shown) T(ctx, '+' + (hearts - shown), 20 + shown * 28 - 6, 18, 14, G.COL.hp, 'left', true);
    // 护盾格 + 临时护甲
    const sm = Math.min(p.shieldMax || 0, 8);
    let x = 20;
    for (let i = 0; i < sm; i++) {
      const on = i < (p.shield || 0);
      K.icon(ctx, on ? 'ui_shield' : 'ui_shield_empty', x, 44, 22, K.shieldFb(on));
      x += 24;
    }
    const ar = Math.min(p.armor || 0, 3);
    if (ar > 0) {
      x += sm ? 6 : 0;
      for (let i = 0; i < ar; i++) { K.icon(ctx, 'ui_armor', x, 44, 22, K.shieldFb(true, G.COL.armor)); x += 24; }
    }
    // 能量条
    const em = Math.max(1, p.energyMax || 1), en = Math.max(0, Math.floor(p.energy || 0));
    K.icon(ctx, 'ui_energy', 18, 70, 20, function (c, cx, cy) { c.fillStyle = G.COL.energy; c.fillRect(cx - 4, cy - 7, 8, 14); });
    G.gfx.bar(ctx, 32, compact ? 61 : 62, 150, compact ? 18 : 16, en / em, G.COL.energy, 'rgba(18,78,137,0.35)', G.COL.edgeHi);
    T(ctx, en + ' / ' + Math.round(em), 107, 71, 14, '#fff', 'center', true, { shadow: true });
    // 金币
    K.icon(ctx, 'ui_coin', 202, 70, 20, K.coinFb);
    T(ctx, String(p.gold || 0), 216, 71, 16, G.COL.gold, 'left', true, { shadow: true });
  }

  function drawCenterInfo(ctx, S) {
    const fd = S.fdef || (G.FLOORS && G.FLOORS[S.floor]) || {};
    const name = '第 ' + ((S.floor || 0) + 1) + ' 层 · ' + (fd.name || '裂隙');
    T(ctx, name, 446, 20, 18, '#fff', 'center', true, { shadow: true });
    const dn = S.dm && S.dm.name ? S.dm.name : '';
    if (compact) {   // 小窗口：只留难度与用时（字号放大），隐藏种子
      T(ctx, (dn ? dn + ' · ' : '') + G.fmtTime(S.time || 0), 446, 54, 14, G.COL.dim, 'center');
      return;
    }
    T(ctx, (dn ? dn + ' · ' : '') + '用时 ' + G.fmtTime(S.time || 0), 446, 46, 14, G.COL.dim, 'center');
    T(ctx, '种子 ' + (S.seed >>> 0), 446, 68, 14, G.COL.dim, 'center');
  }

  const weaponRects = [];
  function drawWeapons(ctx, S) {
    const p = S.p; if (!p) return;
    weaponRects.length = 0;
    for (let i = 0; i < 2; i++) {
      const x = 634 + i * 162, y = 6, w = 156, h = 72;
      const wid = p.weapons ? p.weapons[i] : null, cur = i === (p.wi || 0) && wid;
      const wd = wid && G.WEAPONS ? G.WEAPONS[wid] : null;
      weaponRects.push({ x, y, w, h, wid });
      G.gfx.panel(ctx, x, y, w, h, { sel: !!cur, edge: cur ? G.COL.edgeHi : G.COL.edge, fill: cur ? 'rgba(38,43,68,0.95)' : 'rgba(24,20,37,0.85)' });
      if (!wid) { T(ctx, '空武器槽', x + w / 2, y + h / 2, 14, G.COL.dim, 'center'); continue; }
      ctx.save(); if (!cur) ctx.globalAlpha *= 0.75;
      K.weaponIcon(ctx, wid, x + 30, y + 30, 50);
      ctx.restore();
      const col = wd ? G.rarityColor(wd.rarity) : '#fff';
      const cost = wd ? (wd.cost || 0) : 0;
      if (compact) {   // 小窗口：两行（名称 / 耗能或切换键），字号放大
        T(ctx, G.gfx.fit(ctx, wd ? wd.name : wid, w - 64, fz(15), true), x + 58, y + 22, 15, col, 'left', true);
        const s2 = cur ? (cost ? '耗能 ' + cost : '使用中') : 'X 切换';
        T(ctx, G.gfx.fit(ctx, s2, w - 64, fz(14)), x + 58, y + 50, 14, cur ? (cost ? G.COL.energyHi : G.COL.gold) : G.COL.dim, 'left');
      } else {
        T(ctx, G.gfx.fit(ctx, wd ? wd.name : wid, w - 66, 15, true), x + 60, y + 20, 15, col, 'left', true);
        T(ctx, cost ? '耗能 ' + cost : '不耗能', x + 60, y + 43, 14, cost ? G.COL.energyHi : G.COL.dim, 'left');
        T(ctx, cur ? '使用中' : 'X 切换', x + 60, y + 61, 14, cur ? G.COL.gold : G.COL.dim, 'left');
      }
      // 蓄力 / 预热进度
      if (cur && (p.charge > 0 || p.spin > 0)) G.gfx.bar(ctx, x + 6, y + h - 8, w - 12, 4, Math.max(p.charge || 0, p.spin || 0), G.COL.gold, 'rgba(0,0,0,0.5)');
    }
  }

  function drawSkill(ctx, S) {
    const p = S.p; if (!p) return;
    const ch = G.CHARS && G.CHARS[p.cid], sk = ch && ch.skill;
    const cx = 50, cy = 124, r = 28;
    const maxCd = p.skillMax || (sk ? sk.cd * ((p.st && p.st.skillCdMul) || 1) : 10);
    const cd = Math.max(0, p.skillCd || 0), active = (p.skillT || 0) > 0;
    G.gfx.circle(ctx, cx, cy, r + 3, 'rgba(24,20,37,0.92)', G.COL.edge, 2);
    const frac = cd > 0 ? 1 - Math.min(1, cd / Math.max(0.1, maxCd)) : 1;
    ctx.beginPath(); ctx.arc(cx, cy, r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.strokeStyle = active ? G.COL.gold : cd > 0 ? G.COL.edgeHi : (ch ? ch.color : G.COL.ok); ctx.lineWidth = 5; ctx.stroke();
    if (cd > 0 && !active) T(ctx, cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1), cx, cy + 1, 18, G.COL.dim, 'center', true);
    else T(ctx, 'Q', cx, cy + 1, 22, active ? G.COL.gold : '#fff', 'center', true, { shadow: true });
    T(ctx, sk ? G.gfx.fit(ctx, sk.name, 94, fz(14), true) : '技能', cx, cy + r + 18, 14, active ? G.COL.gold : cd > 0 ? G.COL.dim : '#fff', 'center', true);
    // 主动道具（P1）
    if (p.active && p.active.id) {
      const a = G.ACTIVES && G.ACTIVES[p.active.id];
      const y = 196;
      G.gfx.panel(ctx, 8, y, 84, 40, { edge: p.active.charge >= p.active.max ? G.COL.gold : G.COL.edge });
      K.icon(ctx, 'icon_active_' + p.active.id, 28, y + 20, 28);
      T(ctx, 'F', 72, y + 14, 14, G.COL.key, 'center', true);
      G.gfx.bar(ctx, 52, y + 26, 34, 6, (p.active.charge || 0) / Math.max(1, p.active.max || 1), G.COL.gold);
      activeRect = { x: 8, y, w: 84, h: 40, a };
    } else activeRect = null;
  }
  let activeRect = null;

  const relicRects = [];
  function drawRelics(ctx, S) {
    const p = S.p; relicRects.length = 0;
    if (!p || !p.relicOrder) return;
    const ids = p.relicOrder, y0 = p.active && p.active.id ? 250 : 206;
    T(ctx, '遗物 ' + ids.length, 50, y0, 14, G.COL.dim, 'center', true);
    const cell = 30, cols = 3, x0 = 5, gy = y0 + 14;
    const maxRows = Math.floor((534 - gy) / cell), maxN = maxRows * cols;
    const n = Math.min(ids.length, maxN);
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const cx = x0 + (i % cols) * cell + cell / 2, cy = gy + Math.floor(i / cols) * cell + cell / 2;
      if (i === maxN - 1 && ids.length > maxN) { T(ctx, '+' + (ids.length - maxN + 1), cx, cy, 14, G.COL.dim, 'center', true); break; }
      K.relicIcon(ctx, id, cx, cy, 26);
      const c = p.relics ? p.relics[id] : 1;
      if (c > 1) T(ctx, String(c), cx + 13, cy + 8, 14, '#fff', 'right', true, { shadow: true });
      relicRects.push({ x: cx - cell / 2, y: cy - cell / 2, w: cell, h: cell, id });
    }
  }

  function drawMinimap(ctx, S) {
    const rooms = (S.rooms || []).filter(r => r.seen || r.visited || r === S.room);
    G.gfx.panel(ctx, 864, 90, 92, 132, { fill: 'rgba(24,20,37,0.85)' });
    if (!rooms.length) return;
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    S.rooms.forEach(r => { minx = Math.min(minx, r.gx); maxx = Math.max(maxx, r.gx); miny = Math.min(miny, r.gy); maxy = Math.max(maxy, r.gy); });
    const cw = maxx - minx + 1, chh = maxy - miny + 1;
    const cell = Math.max(8, Math.min(16, Math.floor(84 / cw), Math.floor(104 / chh)));
    const ox = 864 + 46 - (cw * cell) / 2, oy = 94 + 56 - (chh * cell) / 2;
    K.drawMap(ctx, S, rooms, ox, oy, cell, minx, miny);
    T(ctx, 'Tab 地图', 910, 236, 14, G.COL.dim, 'center');
  }
  K.roomIcon = { boss: 'ui_skull', treasure: 'ui_chest', shop: 'ui_shop', altar: 'ui_altar', elite: 'ui_star' };
  K.roomIconColor = { boss: '#ff0044', treasure: '#feae34', shop: '#63c74d', altar: '#b55088', elite: '#f77622', challenge: '#2ce8f5' };
  // 通用地图绘制（HUD 小地图与地图覆盖层共用）
  K.drawMap = function (ctx, S, rooms, ox, oy, cell, minx, miny) {
    const pad = Math.max(1, Math.round(cell * 0.12));
    const set = new Set(rooms);
    // 走廊
    ctx.fillStyle = '#5a6988';
    rooms.forEach(r => {
      const x = ox + (r.gx - minx) * cell, y = oy + (r.gy - miny) * cell;
      if (r.doors && r.doors[1]) { const o = S.roomMap && S.roomMap.get(G.key(r.gx + 1, r.gy)); if (o && set.has(o)) ctx.fillRect(x + cell - pad, y + cell / 2 - 1, pad * 2, 2); }
      if (r.doors && r.doors[2]) { const o = S.roomMap && S.roomMap.get(G.key(r.gx, r.gy + 1)); if (o && set.has(o)) ctx.fillRect(x + cell / 2 - 1, y + cell - pad, 2, pad * 2); }
    });
    rooms.forEach(r => {
      const x = ox + (r.gx - minx) * cell + pad, y = oy + (r.gy - miny) * cell + pad, s = cell - pad * 2;
      const cur = r === S.room;
      ctx.fillStyle = cur ? '#ffffff' : r.visited ? (r.cleared || r.type === 'start' ? '#8b9bb4' : '#5a6988') : '#3a4466';
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(s), Math.round(s));
      if (cur) { ctx.strokeStyle = G.COL.gold; ctx.lineWidth = 2; ctx.strokeRect(Math.round(x) - 1, Math.round(y) - 1, Math.round(s) + 2, Math.round(s) + 2); }
      const ic = K.roomIcon[r.type];
      if (ic) {
        K.icon(ctx, ic, x + s / 2, y + s / 2, Math.max(8, s - 2), function (c, cx, cy, b) {
          c.fillStyle = K.roomIconColor[r.type] || '#fff'; c.fillRect(Math.round(cx - b / 4), Math.round(cy - b / 4), Math.round(b / 2), Math.round(b / 2));
        });
      }
    });
  };

  function drawSynergies(ctx, S) {
    if (!G.Items || !G.Items.synergyInfo) return;
    let info = [];
    try { info = G.Items.synergyInfo(S) || []; } catch (e) { return; }
    info = info.filter(f => f.have > 0).slice(0, 6);
    if (!info.length) return;
    T(ctx, '协同', 910, 266, 14, G.COL.dim, 'center', true);
    info.forEach((f, i) => {
      const top = f.tiers && f.tiers.length ? f.tiers[f.tiers.length - 1].n : 3;
      const act = f.tiers && f.tiers.some(t => t.active);
      const y = 290 + i * 24;
      K.icon(ctx, 'icon_family_' + f.family, compact ? 874 : 876, y, compact ? 14 : 18, function (c, cx, cy) { G.gfx.circle(c, cx, cy, 6, K.familyColor(f.family)); });
      const label = (f.name || K.familyName(f.family)) + ' ' + Math.min(f.have, top) + '/' + top;
      T(ctx, compact ? G.gfx.fit(ctx, label, 70, fz(14), act) : label, compact ? 886 : 890, y, 14, act ? K.familyColor(f.family) : G.COL.dim, 'left', act);
    });
  }

  function drawBoss(ctx, S) {
    const b = S.boss; if (!b || b.hp <= 0 || b.dead) return;
    const x = 250, y = 94, w = 460, h = compact ? 20 : 18;
    const p2 = (b.phase || 1) >= 2;
    G.gfx.panel(ctx, x - 4, y - 4, w + 8, h + 8, { edge: p2 ? G.COL.danger : G.COL.edgeHi, fill: 'rgba(24,20,37,0.9)', shadow: false });
    G.gfx.bar(ctx, x, y, w, h, b.hp / Math.max(1, b.maxHp), p2 ? '#b55088' : G.COL.hp, 'rgba(62,39,49,0.9)');
    const nm = (b.name || (b.def && b.def.name) || '首领') + (p2 ? ' · 第二阶段' : '');
    T(ctx, nm, x + w / 2, y + h / 2 + 1, 14, '#fff', 'center', true, { shadow: true });
  }

  function fade(t, max) { return Math.max(0, Math.min(1, t / 0.35, max ? (max - t) / 0.25 + 1 : 1)); }

  function drawBossIntro(ctx, S) {
    const bi = S.bossIntro; if (!bi || !(bi.t > 0)) return;
    const a = Math.min(1, bi.t / 0.4);
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(24,20,37,0.82)'; ctx.fillRect(140, 150, 680, 96);
    ctx.fillStyle = G.COL.danger; ctx.fillRect(140, 150, 680, 3); ctx.fillRect(140, 243, 680, 3);
    T(ctx, bi.name || '', 480, 186, 36, '#fff', 'center', true, { shadow: true });
    T(ctx, bi.title || '', 480, 226, 16, G.COL.gold, 'center', false);
    ctx.restore();
  }

  function drawBanner(ctx, S) {
    const bn = S.banner; if (!bn || !(bn.t > 0) || (S.bossIntro && S.bossIntro.t > 0)) return;
    ctx.save(); ctx.globalAlpha = fade(bn.t);
    const w = Math.max(260, G.gfx.measure(ctx, bn.text || '', 24, true) + 60, bn.sub ? G.gfx.measure(ctx, bn.sub, fz(14)) + 40 : 0);
    ctx.fillStyle = 'rgba(24,20,37,0.78)'; ctx.fillRect(480 - w / 2, 128, w, bn.sub ? 70 : 46);
    T(ctx, bn.text || '', 480, 151, 24, G.COL.gold, 'center', true, { shadow: true });
    if (bn.sub) T(ctx, G.gfx.fit(ctx, bn.sub, w - 24, fz(14)), 480, 182, 14, '#fff', 'center');
    ctx.restore();
  }

  function drawToast(ctx, S) {
    const t = S.toast; if (!t || !(t.t > 0)) return;
    ctx.save(); ctx.globalAlpha = fade(t.t);
    const w = G.gfx.measure(ctx, t.text, fz(15), true) + 32, y = S.bossIntro && S.bossIntro.t > 0 ? 262 : 208;
    G.gfx.rrect(ctx, 480 - w / 2, y, w, 28, 6, 'rgba(24,20,37,0.88)', G.COL.warn, 2);
    T(ctx, t.text, 480, y + 15, 15, '#fff', 'center', true);
    ctx.restore();
  }

  function drawPrompt(ctx, S) {
    if (!S.prompt) return;
    const s = String(S.prompt);
    const w = G.gfx.measure(ctx, s, fz(16), true) + 36;
    G.gfx.rrect(ctx, 480 - w / 2, 500, w, 30, 6, 'rgba(24,20,37,0.9)', G.COL.key, 2);
    T(ctx, s, 480, 516, 16, '#fff', 'center', true);
    drawCompare(ctx, S);
  }

  function drawCompare(ctx, S) {
    const it = S.nearItem; if (!it) return;
    const p = S.p;
    let wid = null, rid = null;
    if (it.kind === 'weapon') wid = it.wid;
    else if (it.kind === 'shop' && it.what === 'weapon') wid = it.ref;
    else if (it.kind === 'shop' && it.what === 'relic') rid = it.ref;
    const x = 450, w = 300;
    if (wid && G.WEAPONS && G.WEAPONS[wid]) {
      const nw = G.WEAPONS[wid], cwid = p && p.weapons ? p.weapons[p.wi || 0] : null, cw = cwid && G.WEAPONS[cwid];
      const a = K.weaponStats(nw), b = K.weaponStats(cw);
      const h = 112, y = 494 - h;
      G.gfx.panel(ctx, x, y, w, h, { edge: G.rarityColor(nw.rarity), fill: 'rgba(24,20,37,0.95)' });
      K.weaponIcon(ctx, wid, x + 30, y + 26, 44);
      T(ctx, G.gfx.fit(ctx, nw.name, 150, fz(16), true), x + 60, y + 18, 16, G.rarityColor(nw.rarity), 'left', true);
      T(ctx, G.rarityName(nw.rarity), x + w - 12, y + 18, 14, G.rarityColor(nw.rarity), 'right');
      T(ctx, G.gfx.fit(ctx, nw.desc || '', w - 72, fz(14)), x + 60, y + 40, 14, G.COL.dim, 'left');
      const rows = [['伤害', K.fmtNum(a.dmg) + (a.n > 1 ? '×' + a.n : ''), b ? a.dmg * a.n - b.dmg * b.n : 0],
        ['射速', K.fmtNum(a.rate) + '/秒', b ? a.rate - b.rate : 0],
        ['耗能', String(a.cost), b ? b.cost - a.cost : 0]];
      rows.forEach((r, i) => {
        const cx = x + 12 + i * 96, cy = y + 70;
        T(ctx, r[0], cx, cy, 14, G.COL.dim, 'left');
        const col = !b || Math.abs(r[2]) < 1e-6 ? '#fff' : r[2] > 0 ? G.COL.ok : G.COL.hp;
        T(ctx, r[1] + (b && Math.abs(r[2]) > 1e-6 ? (r[2] > 0 ? '▲' : '▼') : ''), cx, cy + 22, 14, col, 'left', true);
      });
      return;
    }
    if (!rid && it.kind === 'shop' && G.SHOP_DESC && G.SHOP_DESC[it.what]) {
      const nm = G.shopName ? G.shopName(it) : '';
      const h = 60, y = 494 - h, cw = 260, cx = 480 - cw / 2;
      G.gfx.panel(ctx, cx, y, cw, h, { edge: G.COL.edgeHi, fill: 'rgba(24,20,37,0.95)' });
      const icon = { heart: 'item_heart', armor: 'item_armor', energy: 'item_energy' }[it.what];
      K.icon(ctx, icon, cx + 24, y + 30, 28);
      T(ctx, G.gfx.fit(ctx, nm, cw - 60, fz(16), true), cx + 46, y + 19, 16, '#fff', 'left', true);
      T(ctx, G.gfx.fit(ctx, G.SHOP_DESC[it.what], cw - 60, fz(14)), cx + 46, y + 42, 14, G.COL.dim, 'left');
      return;
    }
    if (rid && G.RELICS && G.RELICS[rid]) {
      const r = G.RELICS[rid];
      const lines = G.gfx.wrapLines(ctx, r.desc || '', w - 24, fz(14)).slice(0, 3);
      const h = 44 + lines.length * 20, y = 494 - h;
      G.gfx.panel(ctx, x, y, w, h, { edge: G.rarityColor(r.rarity), fill: 'rgba(24,20,37,0.95)' });
      K.relicIcon(ctx, rid, x + 22, y + 20, 26);
      T(ctx, G.gfx.fit(ctx, r.name, 160, fz(16), true), x + 42, y + 20, 16, G.rarityColor(r.rarity), 'left', true);
      T(ctx, (r.family ? K.familyName(r.family) + '系 · ' : '') + G.rarityName(r.rarity), x + w - 12, y + 20, 14, G.COL.dim, 'right');
      lines.forEach((ln, i) => T(ctx, ln, x + 12, y + 46 + i * 20, 14, '#fff', 'left'));
    }
  }

  function drawHover(ctx, S) {
    const m = G.mouse; if (!m) return;
    for (const r of relicRects) {
      if (!K.inRect(m.x, m.y, r)) continue;
      const d = G.RELICS && G.RELICS[r.id]; if (!d) return;
      const c = S.p.relics ? S.p.relics[r.id] || 1 : 1;
      const lines = [{ text: d.desc || '' }];
      lines.push({ text: G.rarityName(d.rarity) + (d.family ? ' · ' + K.familyName(d.family) + '系' : '') + (c > 1 ? ' · 叠加 ' + c + (d.max ? '/' + d.max : '') : ''), color: G.COL.dim });
      K.tooltip(ctx, 106 - 16, r.y - 12, d.name, G.rarityColor(d.rarity), lines);   // 固定在左边栏右侧，不盖住 HUD 文字
      return;
    }
    for (const r of weaponRects) {
      if (!r.wid || !K.inRect(m.x, m.y, r)) continue;
      const d = G.WEAPONS && G.WEAPONS[r.wid]; if (!d) return;
      const s = K.weaponStats(d);
      K.tooltip(ctx, 600, 76, d.name, G.rarityColor(d.rarity), [{ text: d.desc || '' },
        { text: '伤害 ' + K.fmtNum(s.dmg) + (s.n > 1 ? '×' + s.n : '') + ' · 射速 ' + K.fmtNum(s.rate) + '/秒 · 耗能 ' + s.cost, color: G.COL.dim }]);
      return;
    }
    if (activeRect && activeRect.a && K.inRect(m.x, m.y, activeRect)) {
      K.tooltip(ctx, 106 - 16, activeRect.y - 12, activeRect.a.name, G.COL.gold, [{ text: activeRect.a.desc || '' }]);
    }
  }

  G.HUD = {
    draw(ctx, S) {
      if (!S || !S.p) return;
      const sc = (G.view && G.view.scale) || 1;
      compact = sc < 0.9; minF = compact ? Math.min(24, Math.ceil(11.1 / Math.max(0.3, sc))) : 0;
      try {
        ctx.save();
        // 有覆盖层（暂停/地图/三选一/结算）时 HUD 只淡淡地画在下面，不参与交互
        const ov = S.state !== 'play' || G.paused || G.mapOpen;
        const hint = ov ? null : updateHint(S);
        if (ov) ctx.globalAlpha = 0.3;
        // 顶部条与边栏底色
        ctx.fillStyle = 'rgba(24,20,37,0.92)'; ctx.fillRect(0, 0, G.VW, 84);
        ctx.fillStyle = 'rgba(24,20,37,0.80)'; ctx.fillRect(0, 84, 100, 456); ctx.fillRect(860, 84, 100, 456);
        ctx.fillStyle = G.COL.edge; ctx.fillRect(0, 83, G.VW, 1);
        drawVitals(ctx, S); drawWeapons(ctx, S);
        if (hint) drawHint(ctx, S); else { hs.rect = null; drawCenterInfo(ctx, S); }   // 新手提示条占用顶部 HUD 带中间（层数/用时暂时让位）
        drawSkill(ctx, S); drawRelics(ctx, S);
        drawMinimap(ctx, S); drawSynergies(ctx, S);
        drawBoss(ctx, S);
        if (!ov) {
          drawPrompt(ctx, S);
          drawBanner(ctx, S); drawToast(ctx, S);
          drawBossIntro(ctx, S);
          drawHover(ctx, S);
        }
        ctx.restore();
      } catch (e) { try { ctx.restore(); } catch (x) { /* */ } G.reportError && G.reportError(e); }
      minF = 0; compact = false;
    },
    // 立即显示某条新手提示（不论楼层）
    hint(id) { if (HINTS[id] && !seen(id) && hs.forced.indexOf(id) < 0 && hs.cur !== id) hs.forced.push(id); },
    hintActive() { return !!hs.cur; },
    // main.js 在 game 模式（无覆盖层）下先把按键/点击交给 HUD；返回 true 表示已处理
    key(code) { if (hs.cur && (code === 'Enter' || code === 'NumpadEnter')) return closeHint(); return false; },
    click(x, y) { if (hs.cur && K.inRect(x, y, hs.rect)) return closeHint(); return false; },
    resetHints() { hs.cur = null; hs.rect = null; hs.forced.length = 0; hs.done = {}; },
    // 测试/调试用：提示条状态与常量（只读副本）
    hintInfo() { return { cur: hs.cur, queue: hs.forced.slice(), rect: hs.rect ? Object.assign({}, hs.rect) : null, alpha: hs.alpha, combat: hs.combat, bgAlpha: HINT_BAR.bgAlpha }; }
  };
})(window.Game = window.Game || {});
(function (G) {
  'use strict';
  // 模拟层可以 emit('hint',{id}) 主动触发新手提示
  if (G.on) G.on('hint', function (d) { if (d && d.id && G.HUD) G.HUD.hint(d.id); });
})(window.Game = window.Game || {});
