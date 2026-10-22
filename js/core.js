// 核心：命名空间、常量、RNG、数学工具、事件总线、URL 参数、默认设置。
// 本文件属于“模拟层”：加载时不碰 DOM，不用 Math.random。
(function (G) {
  'use strict';
  G.VERSION = '3.0.0';
  G.TITLE = '裂隙猎人';
  G.SUBTITLE = 'Rift Hunter';

  // ---- 布局与模拟常量（见 ARCH.md §2）----
  G.VW = 960; G.VH = 540;
  G.T = 40; G.COLS = 19; G.ROWS = 11;
  G.RW = G.COLS * G.T; G.RH = G.ROWS * G.T;
  G.OX = 100; G.OY = 84;
  G.PX = 2;                 // 1 美术像素 = 2 逻辑像素
  G.DT = 1 / 60;
  G.DX = [0, 1, 0, -1]; G.DY = [-1, 0, 1, 0];   // 0上 1右 2下 3左
  G.DOOR_TILE = [[9, 0], [18, 5], [9, 10], [0, 5]];
  G.MAX_ENEMIES = 36;
  G.MAX_BULLETS = 700;

  // ---- RNG（mulberry32）----
  G.makeRng = function (seed) {
    let a = (seed >>> 0) || 0x9E3779B9;
    const r = {
      next() {
        a = (a + 0x6D2B79F5) >>> 0; let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int(lo, hi) { return lo + Math.floor(r.next() * (hi - lo + 1)); },
      range(lo, hi) { return lo + r.next() * (hi - lo); },
      pick(arr) { return arr.length ? arr[Math.floor(r.next() * arr.length)] : undefined; },
      chance(p) { return r.next() < p; },
      shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; },
      weighted(items, wfn) {
        let tot = 0; for (const it of items) tot += Math.max(0, wfn(it));
        if (tot <= 0) return r.pick(items);
        let x = r.next() * tot;
        for (const it of items) { x -= Math.max(0, wfn(it)); if (x < 0) return it; }
        return items[items.length - 1];
      },
      state() { return a; }
    };
    return r;
  };
  // 派生种子（整数哈希混合）
  G.mix = function (a, b) {
    let h = (Math.imul((a >>> 0) ^ 0x85EBCA6B, 0x9E3779B1) + Math.imul((b >>> 0) + 0x632BE5AB, 0xC2B2AE35)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846CA68B) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  };

  // ---- 数学工具 ----
  G.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  G.angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  G.angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  G.fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  G.key = (x, y) => x + ',' + y;

  // ---- 事件总线（模拟 → 表现；监听器不得修改 S）----
  const LS = {};
  G.on = function (type, fn) { (LS[type] || (LS[type] = [])).push(fn); };
  G.off = function (type, fn) { const a = LS[type]; if (!a) return; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  G.emit = function (type, data) {
    const a = LS[type]; if (!a || !a.length) return;
    for (let i = 0; i < a.length; i++) { try { a[i](data || {}, type); } catch (e) { G.reportError(e); } }
  };

  // ---- 错误输出（契约：" [ERROR] <msg>" 追加到 #autotest-result）----
  G.errors = 0;
  const seenErr = {};
  G.reportError = function (e) {
    G.errors++;
    const msg = (e && (e.message || e)) + (e && e.stack ? ' @' + String(e.stack).split('\n').slice(1, 2).join('').trim() : '');
    if (seenErr[msg] || Object.keys(seenErr).length > 30) return;   // 去重，避免每帧刷屏
    seenErr[msg] = 1;
    try {
      if (typeof document !== 'undefined') {
        const d = document.getElementById('autotest-result');
        if (d) d.appendChild(document.createTextNode(' [ERROR] ' + msg + ' '));
      } else if (typeof console !== 'undefined') console.error('[ERROR] ' + msg);
    } catch (x) { /* 忽略 */ }
  };

  // ---- URL 参数 ----
  function parseParams() {
    let qs = null;
    try { if (typeof location !== 'undefined' && location.search) qs = new URLSearchParams(location.search); } catch (e) { qs = null; }
    const get = (k) => qs ? qs.get(k) : null;
    const seedS = get('seed');
    return {
      autotest: get('autotest') === '1',
      god: get('god') === '1',
      seed: seedS !== null && seedS !== '' && isFinite(parseInt(seedS, 10)) ? (parseInt(seedS, 10) >>> 0) : null,
      scene: get('scene') || null,
      uilint: get('uilint') === '1',
      unlockall: get('unlockall') === '1',
      char: get('char') || get('class') || null,
      diff: get('diff') || null,
      human: get('human') === '1',
      shot: parseInt(get('shot') || '0', 10) || 0,
      spt: parseInt(get('spt') || '0', 10) || 0
    };
  }
  G.params = parseParams();
  G.reparseParams = function () { G.params = parseParams(); return G.params; };

  // ---- 设置（meta.js 加载存档后覆盖）----
  G.defaultSettings = function () {
    return { master: 0.8, sfx: 0.8, music: 0.5, mute: false, shake: true, aimAssist: true, hints: true, dmgNumbers: true, pixelPerfect: false };
  };
  G.settings = G.defaultSettings();
})(window.Game = window.Game || {});
