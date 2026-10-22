/* meta.js — 存档（schema v1 + 逐字段校验）、设置持久化、局外升级/解锁表、纪录与历史、魂晶结算。所有者：ui
 * 加载时不碰 DOM / localStorage；node 下可用 vm 加载测试。 */
(function (G) {
  'use strict';
  const KEY = 'rift_hunter_save';
  const V = 1;
  const MAX_CRYSTALS = 999999;
  const HISTORY_MAX = 10;

  // ---------- 局外永久强化 ----------
  // costs[i] = 从 i 级升到 i+1 级的费用；per = 每级效果（runBonuses 用）
  const UPGRADES = [
    { id: 'hp', name: '坚韧之心', icon: 'ui_heart_full', desc: '每级最大生命 +1（半颗心）', costs: [25, 50, 90, 140], per: 1, stat: 'maxHp' },
    { id: 'shield', name: '源质护盾', icon: 'ui_shield', desc: '每级护盾上限 +1 格', costs: [40, 90, 160], per: 1, stat: 'shield' },
    { id: 'gold', name: '富裕出身', icon: 'ui_coin', desc: '每级开局金币 +15', costs: [15, 30, 55], per: 15, stat: 'gold' },
    { id: 'dmg', name: '锋锐训练', icon: 'ui_star', desc: '每级全部伤害 +6%', costs: [30, 60, 100, 150], per: 0.06, stat: 'dmgMul' },
    { id: 'dodge', name: '灵巧步法', icon: 'ui_energy', desc: '每级翻滚冷却 -8%', costs: [20, 45, 80], per: 0.08, stat: 'dodgeCdMul' },
    { id: 'shop', name: '商会会员', icon: 'ui_shop', desc: '每级商店价格 -6%', costs: [25, 55, 95], per: 0.06, stat: 'shopDiscount' },
    { id: 'energy', name: '能量扩容', icon: 'ui_energy', desc: '每级能量上限 +20', costs: [20, 40, 70], per: 20, stat: 'energyMax' },
    { id: 'armor', name: '临战铠甲', icon: 'ui_armor', desc: '每级开局获得 1 层临时护甲', costs: [35, 80], per: 1, stat: 'armor' }
  ];
  UPGRADES.forEach(u => { u.max = u.costs.length; });

  // ---------- 内容解锁（角色 + 掉落池物品） ----------
  const UNLOCKS = [
    { id: 'mage', kind: 'char', name: '冰法师', cost: 60, desc: '护盾更厚；技能冰霜新星：冻结周围敌人并清除附近敌弹' },
    { id: 'knight', kind: 'char', name: '重装骑士', cost: 100, desc: '生命最高；技能钢铁壁垒：短时免伤并反射吸收的弹幕' },
    { id: 'alchemist', kind: 'char', name: '炼金师', cost: 150, desc: '药瓶越过障碍爆炸留毒；技能剧毒迷雾：大范围毒雾减速' },
    { id: 'thunder_staff', kind: 'item', type: 'weapon', name: '雷霆法杖', cost: 60, desc: '史诗武器：闪电连锁 4 个敌人，加入掉落池' },
    { id: 'dragon_breath', kind: 'item', type: 'weapon', name: '龙息喷火器', cost: 70, desc: '史诗武器：穿透喷火、必定点燃，加入掉落池' },
    { id: 'railgun', kind: 'item', type: 'weapon', name: '电磁炮', cost: 90, desc: '传说武器：满蓄力 46 伤害贯穿全部，加入掉落池' },
    { id: 'void_cannon', kind: 'item', type: 'weapon', name: '虚空炮', cost: 120, desc: '传说武器：黑洞吸附敌人、吞噬敌弹，加入掉落池' },
    { id: 'golden_idol', kind: 'item', type: 'relic', name: '黄金神像', cost: 50, desc: '史诗遗物：金币越多伤害越高，加入掉落池' },
    { id: 'phoenix_feather', kind: 'item', type: 'relic', name: '凤凰之羽', cost: 100, desc: '传说遗物：致命伤时浴火重生一次，加入掉落池' },
    { id: 'glacier_crown', kind: 'item', type: 'relic', name: '冰川王冠', cost: 80, desc: '寒霜系史诗遗物：冻结减速中的敌人，加入掉落池' },
    { id: 'inferno_heart', kind: 'item', type: 'relic', name: '炼狱之心', cost: 80, desc: '烈焰系史诗遗物：燃烧的敌人死亡爆炸，加入掉落池' },
    { id: 'toxic_crown', kind: 'item', type: 'relic', name: '剧毒王冠', cost: 80, desc: '剧毒系传说遗物：中毒死亡时传染周围，加入掉落池' }
  ];
  const CHAR_IDS = ['ranger', 'mage', 'knight', 'alchemist'];
  const DIFF_IDS = ['casual', 'normal', 'hard'];
  const DIFF_CRYSTAL = { casual: 0.7, normal: 1, hard: 1.5 };

  function defaultSettings() {
    if (typeof G.defaultSettings === 'function') { try { return G.defaultSettings(); } catch (e) { /* fallthrough */ } }
    return { master: 0.8, sfx: 0.8, music: 0.5, mute: false, shake: true, aimAssist: true, hints: true, dmgNumbers: true, pixelPerfect: false };
  }
  const SETTING_TYPES = { master: 'num', sfx: 'num', music: 'num', mute: 'bool', shake: 'bool', aimAssist: 'bool', hints: 'bool', dmgNumbers: 'bool', pixelPerfect: 'bool' };

  function defaults() {
    return {
      v: V, crystals: 0, crystalsTotal: 0, runs: 0, wins: 0,
      unlocked: { chars: { ranger: true }, items: {} },
      upg: {},
      best: { floor: 0, kills: 0, fastestWin: 0, bestCrystals: 0 },
      history: [],
      winsBy: { casual: 0, normal: 0, hard: 0 },
      daily: null,
      settings: defaultSettings(),
      tutorial: {},
      lastChar: 'ranger', lastDiff: 'normal'
    };
  }

  // ---------- 校验工具 ----------
  // rogue3 修复（QA M5）：越界值按“损坏字段”处理，回退默认值，而不是钳到上下限（避免 upg=99 变满级、1e308 变 999999）
  function num(v, lo, hi, def) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return def;
    return v;
  }
  function int(v, lo, hi, def) { const n = num(v, lo, hi, def); return Math.floor(n); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function str(v, maxLen, def) { return typeof v === 'string' ? v.slice(0, maxLen) : def; }
  const ID_RE = /^[a-z0-9_]{1,40}$/;

  // 把任意对象逐字段钳制为合法存档；o 不是对象则返回 null
  function sanitize(o) {
    if (!isObj(o) || o.v !== V) return null;
    const d = defaults();
    d.crystals = int(o.crystals, 0, MAX_CRYSTALS, 0);
    d.crystalsTotal = int(o.crystalsTotal, 0, 1e9, 0);
    if (d.crystalsTotal < d.crystals) d.crystalsTotal = d.crystals;
    d.runs = int(o.runs, 0, 1e7, 0);
    d.wins = int(o.wins, 0, d.runs, 0);
    if (isObj(o.winsBy)) DIFF_IDS.forEach(k => { d.winsBy[k] = int(o.winsBy[k], 0, d.runs, 0); });
    if (isObj(o.daily) && typeof o.daily.key === 'string' && /^\d{8}$/.test(o.daily.key)) {
      d.daily = { key: o.daily.key, tries: int(o.daily.tries, 0, 1e6, 0), win: o.daily.win === true, floor: int(o.daily.floor, 0, 3, 0), kills: int(o.daily.kills, 0, 1e6, 0), time: num(o.daily.time, 0, 1e7, 0) };
    }
    if (isObj(o.unlocked)) {
      if (isObj(o.unlocked.chars)) CHAR_IDS.forEach(c => { if (o.unlocked.chars[c] === true) d.unlocked.chars[c] = true; });
      d.unlocked.chars.ranger = true;
      if (isObj(o.unlocked.items)) UNLOCKS.forEach(u => { if (u.kind === 'item' && o.unlocked.items[u.id] === true) d.unlocked.items[u.id] = true; });
    }
    if (isObj(o.upg)) UPGRADES.forEach(u => { const l = int(o.upg[u.id], 0, u.max, 0); if (l > 0) d.upg[u.id] = l; });
    if (isObj(o.best)) {
      d.best.floor = int(o.best.floor, 0, 3, 0);
      d.best.kills = int(o.best.kills, 0, 1e6, 0);
      d.best.fastestWin = num(o.best.fastestWin, 0, 1e7, 0);
      d.best.bestCrystals = int(o.best.bestCrystals, 0, MAX_CRYSTALS, 0);
    }
    if (Array.isArray(o.history)) {
      for (const h of o.history.slice(0, HISTORY_MAX)) {
        if (!isObj(h)) continue;
        d.history.push({
          t: num(h.t, 0, 1e15, 0),
          cid: CHAR_IDS.indexOf(h.cid) >= 0 ? h.cid : 'ranger',
          diff: DIFF_IDS.indexOf(h.diff) >= 0 ? h.diff : 'normal',
          win: h.win === true,
          floor: int(h.floor, 0, 3, 0),
          kills: int(h.kills, 0, 1e6, 0),
          time: num(h.time, 0, 1e7, 0),
          seed: int(h.seed, 0, 4294967295, 0),
          cause: str(h.cause, 24, ''),
          crystals: int(h.crystals, 0, MAX_CRYSTALS, 0),
          daily: h.daily === true
        });
      }
    }
    if (isObj(o.settings)) {
      for (const k in SETTING_TYPES) {
        const v = o.settings[k];
        if (SETTING_TYPES[k] === 'num') d.settings[k] = num(v, 0, 1, d.settings[k]);
        else if (typeof v === 'boolean') d.settings[k] = v;
      }
    }
    if (isObj(o.tutorial)) {
      let n = 0;
      for (const k in o.tutorial) { if (n > 64) break; if (ID_RE.test(k) && o.tutorial[k] === true) { d.tutorial[k] = true; n++; } }
    }
    if (CHAR_IDS.indexOf(o.lastChar) >= 0) d.lastChar = o.lastChar;
    if (DIFF_IDS.indexOf(o.lastDiff) >= 0) d.lastDiff = o.lastDiff;
    return d;
  }

  function serialize(d) { try { return JSON.stringify(sanitize(d) || defaults()); } catch (e) { return JSON.stringify(defaults()); } }
  function deserialize(s) {
    if (typeof s !== 'string' || s.length > 200000) return null;
    try { return sanitize(JSON.parse(s)); } catch (e) { return null; }
  }

  function noWrite() { const p = G.params || {}; return !!(p.autotest || p.scene); }
  function storage() {
    try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch (e) { /* file:// 或隐私模式 */ }
    return null;
  }

  function syncSettings() {
    G.settings = Object.assign(defaultSettings(), M.data.settings);
    M.data.settings = G.settings;
  }

  const M = G.Meta = {
    KEY, UPGRADES, UNLOCKS, CHAR_IDS, DIFF_IDS,
    data: defaults(),
    defaults, serialize, deserialize, sanitize,
    load() {
      let d = null;
      const ls = storage();
      if (ls) { try { d = deserialize(ls.getItem(KEY)); } catch (e) { d = null; } }
      M.data = d || defaults();
      syncSettings();
      return M.data;
    },
    save() {
      if (noWrite()) return false;
      const ls = storage();
      if (!ls) return false;
      try { ls.setItem(KEY, serialize(M.data)); return true; } catch (e) { return false; }
    },
    reset() { M.data = defaults(); syncSettings(); M.save(); return M.data; },

    // ----- 设置 -----
    setSetting(k, v) {
      if (!(k in SETTING_TYPES)) return;
      if (SETTING_TYPES[k] === 'num') v = num(+v, 0, 1, M.data.settings[k]); else v = !!v;
      M.data.settings[k] = v;
      syncSettings();
      M.save();
      try { if (G.Audio && G.Audio.applySettings) G.Audio.applySettings(); } catch (e) { /* ignore */ }
    },
    // ----- 新手提示 -----
    hintSeen(id) { return !!M.data.tutorial[id]; },
    markHint(id) { if (ID_RE.test(id)) { M.data.tutorial[id] = true; M.save(); } },
    resetHints() { M.data.tutorial = {}; M.save(); },
    setLast(cid, diff) {
      if (CHAR_IDS.indexOf(cid) >= 0) M.data.lastChar = cid;
      if (DIFF_IDS.indexOf(diff) >= 0) M.data.lastDiff = diff;
      M.save();
    },

    // ----- 升级 / 解锁 -----
    upgrade(id) { return UPGRADES.find(u => u.id === id) || null; },
    unlockDef(id) { return UNLOCKS.find(u => u.id === id) || null; },
    level(id) { return M.data.upg[id] || 0; },
    upgCost(id) { const u = M.upgrade(id); if (!u) return 0; const l = M.level(id); return l >= u.max ? 0 : u.costs[l]; },
    isUnlocked(kind, id) {
      if (G.params && G.params.unlockall) return true;
      if (kind === 'char') return id === 'ranger' || !!M.data.unlocked.chars[id];
      const u = UNLOCKS.find(x => x.id === id && x.kind === 'item');
      if (!u) return true; // 不在解锁表里 = 基础池
      return !!M.data.unlocked.items[id];
    },
    ownedUnlock(u) { return u.kind === 'char' ? !!M.data.unlocked.chars[u.id] : !!M.data.unlocked.items[u.id]; },
    unlockName(u) {
      try {
        if (u.kind === 'char' && G.CHARS && G.CHARS[u.id]) return G.CHARS[u.id].name || u.name;
        if (u.type === 'weapon' && G.WEAPONS && G.WEAPONS[u.id]) return G.WEAPONS[u.id].name || u.name;
        if (u.type === 'relic' && G.RELICS && G.RELICS[u.id]) return G.RELICS[u.id].name || u.name;
      } catch (e) { /* ignore */ }
      return u.name;
    },
    buy(id) {
      const u = M.upgrade(id);
      if (u) {
        const l = M.level(id);
        if (l >= u.max) return { ok: false, msg: u.name + ' 已满级' };
        const c = u.costs[l];
        if (M.data.crystals < c) return { ok: false, msg: '魂晶不足（需要 ' + c + '）' };
        M.data.crystals -= c; M.data.upg[id] = l + 1; M.save();
        return { ok: true, msg: u.name + ' 提升到 ' + (l + 1) + ' 级' };
      }
      const k = M.unlockDef(id);
      if (k) {
        const nm = M.unlockName(k);
        if (M.ownedUnlock(k)) return { ok: false, msg: nm + ' 已解锁' };
        if (M.data.crystals < k.cost) return { ok: false, msg: '魂晶不足（需要 ' + k.cost + '）' };
        M.data.crystals -= k.cost;
        if (k.kind === 'char') M.data.unlocked.chars[k.id] = true; else M.data.unlocked.items[k.id] = true;
        M.save();
        return { ok: true, msg: '已解锁 ' + nm };
      }
      return { ok: false, msg: '未知项目' };
    },
    runBonuses() {
      const b = { maxHp: 0, shield: 0, gold: 0, dmgMul: 1, dodgeCdMul: 1, shopDiscount: 0, energyMax: 0, armor: 0 };
      UPGRADES.forEach(u => {
        const l = M.level(u.id); if (!l) return;
        if (u.stat === 'dmgMul') b.dmgMul = 1 + u.per * l;
        else if (u.stat === 'dodgeCdMul') b.dodgeCdMul = Math.max(0.5, 1 - u.per * l);
        else b[u.stat] += u.per * l;
      });
      b.shopDiscount = Math.min(0.5, Math.round(b.shopDiscount * 100) / 100);
      return b;
    },

    // ----- 结算 -----
    // summary.floor：到达的层数（1..3，1 基）；kills 已排除召唤物（sim 保证）
    crystalsFor(s) {
      if (!isObj(s)) return 0;
      const floor = int(s.floor, 0, 3, 1);
      const kills = int(s.kills, 0, 100000, 0);
      const boss = int(s.bossKills, 0, 3, 0);
      const elites = int(s.elites, 0, 1000, 0);
      // rogue3 修复（QA S1）：保底 5 魂晶只在清理过 ≥2 个房间时给（防“开局即死/即放弃”刷取）；
      // 主动放弃：没有保底和胜利奖励，只按进度结算；清理不足 2 个房间时为 0（且不计入纪录，见 recordRun）。
      const rooms = s.rooms === undefined ? 99 : int(s.rooms, 0, 1e4, 0);
      const ab = s.abandoned === true;
      if (ab && rooms < 2) return 0;
      let c = (!ab && rooms >= 2 ? 5 : 0) + 10 * Math.max(0, floor - 1) + 15 * boss + Math.floor(kills / 5) + 3 * elites + (s.win === true && !ab ? 30 : 0);
      let mul = DIFF_CRYSTAL[s.diff] || 1;
      try { if (G.DIFFS && G.DIFFS[s.diff] && Number.isFinite(G.DIFFS[s.diff].crystal)) mul = G.DIFFS[s.diff].crystal; } catch (e) { /* ignore */ }
      return Math.max(0, Math.min(5000, Math.round(c * mul)));
    },
    // 下一个最便宜的未拥有项目（角色/内容/强化）
    nextGoal() {
      let best = null;
      UNLOCKS.forEach(u => { if (!M.ownedUnlock(u) && (!best || u.cost < best.cost)) best = { name: M.unlockName(u), cost: u.cost, kind: 'unlock' }; });
      UPGRADES.forEach(u => { const c = M.upgCost(u.id); if (c && (!best || c < best.cost)) best = { name: u.name, cost: c, kind: 'upgrade' }; });
      return best;
    },
    // 评审 4：下一个目标（结算页/标题页用）。need = 还差多少魂晶（0 = 已买得起）
    goal() {
      const g = M.nextGoal(); if (!g) return null;
      return { name: g.name, cost: g.cost, kind: g.kind, need: Math.max(0, g.cost - M.data.crystals) };
    },
    affordableCount() {
      let n = 0;
      UNLOCKS.forEach(u => { if (!M.ownedUnlock(u) && u.cost <= M.data.crystals) n++; });
      UPGRADES.forEach(u => { const c = M.upgCost(u.id); if (c && c <= M.data.crystals) n++; });
      return n;
    },
    goalLine() {
      const n = M.affordableCount();
      if (n > 0) return '魂晶足够：可在魂晶商店购买 ' + n + ' 项';
      const g = M.goal(); if (!g) return '所有内容均已解锁';
      return (g.kind === 'upgrade' ? '距离强化「' : '距离解锁「') + g.name + '」还差 ' + g.need + ' 魂晶';
    },
    // S1：暂停页“放弃本局”的结算预览
    previewAbandon(S) {
      if (!isObj(S) || !isObj(S.stats)) return { crystals: 0, recorded: false };
      const rooms = int(S.stats.roomsCleared, 0, 1e4, 0);
      const c = M.crystalsFor({ floor: (S.floor | 0) + 1, kills: S.stats.kills, bossKills: S.stats.bossKills, elites: S.stats.elites, diff: S.diff, rooms, abandoned: true });
      return { crystals: c, recorded: rooms >= 2 };
    },
    // 评审 8：每日裂隙（本地日期 → 固定种子；所有玩家同一天同一张地图）
    todayKey(dt) {
      const d = (dt instanceof Date) ? dt : new Date();
      const y = d.getFullYear(), m = d.getMonth() + 1, da = d.getDate();
      return String(y) + (m < 10 ? '0' : '') + m + (da < 10 ? '0' : '') + da;
    },
    dailySeed(key) {
      const k = 'rift-daily-' + String(key);
      let h = 2166136261;
      for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return (h >>> 0) || 1;
    },
    affordable() {
      const out = [];
      UNLOCKS.forEach(u => { if (!M.ownedUnlock(u) && u.cost <= M.data.crystals) out.push(M.unlockName(u)); });
      return out;
    },
    recordRun(s) {
      if (!isObj(s)) return { crystals: 0, newBest: false, unlockHint: '', unlocks: [] };
      if (s.reward && s.reward._done) return s.reward;
      const d = M.data;
      const ab = s.abandoned === true, rooms = s.rooms === undefined ? 99 : int(s.rooms, 0, 1e4, 0);
      if (ab && rooms < 2) {
        // S1：开局即放弃 → 不计局数、不写历史、不给魂晶
        const r0 = { crystals: 0, newBest: false, unlockHint: M.goalLine(), unlocks: [], total: d.crystals, skipped: true, firstWin: null, goal: M.goal(), goalLine: M.goalLine(), daily: null };
        Object.defineProperty(r0, '_done', { value: true, enumerable: false });
        return r0;
      }
      const before = M.affordable();
      const c = M.crystalsFor(s);
      const floor = int(s.floor, 0, 3, 1), kills = int(s.kills, 0, 1e6, 0), time = num(s.time, 0, 1e7, 0);
      const win = s.win === true;
      let newBest = false;
      d.runs++; if (win) d.wins++;
      const dk = DIFF_IDS.indexOf(s.diff) >= 0 ? s.diff : 'normal';
      if (!isObj(d.winsBy)) d.winsBy = { casual: 0, normal: 0, hard: 0 };
      let firstWin = null;
      if (win) { if (!(d.winsBy[dk] > 0)) firstWin = dk; d.winsBy[dk] = (d.winsBy[dk] | 0) + 1; }
      let daily = null;
      if (typeof s.daily === 'string' && /^\d{8}$/.test(s.daily)) {
        if (!isObj(d.daily) || d.daily.key !== s.daily) d.daily = { key: s.daily, tries: 0, win: false, floor: 0, kills: 0, time: 0 };
        const dd = d.daily; dd.tries++;
        const better = dd.tries === 1 || (win && !dd.win) || (win === dd.win && (win ? time < dd.time : (floor > dd.floor || (floor === dd.floor && kills > dd.kills))));
        if (better) { dd.win = win; dd.floor = floor; dd.kills = kills; dd.time = time; }
        daily = { key: s.daily, best: !!better };
      }
      d.crystals = Math.min(MAX_CRYSTALS, d.crystals + c);
      d.crystalsTotal = Math.min(1e9, d.crystalsTotal + c);
      if (floor > d.best.floor) { d.best.floor = floor; newBest = true; }
      if (kills > d.best.kills) { d.best.kills = kills; newBest = true; }
      if (win && time > 0 && (!d.best.fastestWin || time < d.best.fastestWin)) { d.best.fastestWin = time; newBest = true; }
      if (c > d.best.bestCrystals) d.best.bestCrystals = c;
      d.history.unshift({
        t: (typeof Date !== 'undefined') ? Date.now() : 0,
        cid: CHAR_IDS.indexOf(s.cid) >= 0 ? s.cid : 'ranger',
        diff: DIFF_IDS.indexOf(s.diff) >= 0 ? s.diff : 'normal',
        win, floor, kills, time, seed: int(s.seed, 0, 4294967295, 0), cause: str(s.cause, 24, ''), crystals: c, daily: !!daily
      });
      if (d.history.length > HISTORY_MAX) d.history.length = HISTORY_MAX;
      const after = M.affordable();
      const unlocks = after.filter(n => before.indexOf(n) < 0);
      let unlockHint = '';
      if (after.length) unlockHint = '魂晶商店可解锁：' + after.slice(0, 3).join('、');
      else {
        const g = M.nextGoal();
        if (g) unlockHint = '再获得 ' + Math.max(0, g.cost - d.crystals) + ' 魂晶可解锁 ' + g.name;
        else unlockHint = '所有内容均已解锁';
      }
      M.save();
      const r = { crystals: c, newBest, unlockHint, unlocks, total: d.crystals, skipped: false, firstWin, goal: M.goal(), goalLine: M.goalLine(), daily };
      Object.defineProperty(r, '_done', { value: true, enumerable: false });
      return r;
    }
  };
})(window.Game = window.Game || {});
