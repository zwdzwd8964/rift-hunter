/* ui.js — 全部菜单与覆盖层：title/charselect/meta/records/help/settings/pause/map/relicchoice/end。所有者：ui
 * 每个 screen：{ enter(arg), render(ctx), key(code,ev)->bool, click(x,y)->bool, move(x,y), wheel(dy) }
 * 键盘与鼠标共用一套“按钮”逻辑：render 时登记按钮矩形，click/move 命中测试。 */
(function (G) {
  'use strict';
  const K = () => G.uik;
  // 评审 7：小窗口字号。uilint 以“逻辑字号 × 画面缩放 < 11 CSS px”判 TINY。缩放 < 0.79（如 800×450 窗口，约 0.66 倍）时，
  // 所有界面文字统一抬到最小字号，各界面再按 SM() 切换为紧凑布局（行距加大、次要信息截断/精简）。
  const VS = () => (G.view && G.view.scale) || 1;
  const MINF = () => { const s = VS(); return s < 0.79 ? Math.min(22, Math.ceil(11.05 / s)) : 0; };
  const SM = () => MINF() > 14;
  const F = (n) => Math.max(n, MINF());
  const T = (ctx, s, x, y, size, color, align, bold, o) => G.gfx.txt(ctx, s, x, y, F(size), color, align, bold, o);
  const W = (ctx, s, x, y, w, size, color, align, o) => {
    o = o || {};
    const fs = F(size);
    const o2 = fs > size && o.lineH ? Object.assign({}, o, { lineH: o.lineH + (fs - size) }) : o;
    return G.gfx.wrap(ctx, s, x, y, w, fs, color, align, o2);
  };
  const FIT = (ctx, s, w, size, bold) => G.gfx.fit(ctx, s, w, F(size), bold);
  const MEAS = (ctx, s, size, bold) => G.gfx.measure(ctx, s, F(size), bold);
  const fmtKey = (k) => { k = String(k || ''); return /^\d{8}$/.test(k) ? k.slice(0, 4) + '-' + k.slice(4, 6) + '-' + k.slice(6, 8) : k; };
  const metaCall = function (fn, dflt) {
    try { return (G.Meta && typeof G.Meta[fn] === 'function') ? G.Meta[fn].apply(G.Meta, [].slice.call(arguments, 2)) : dflt; } catch (e) { return dflt; }
  };
  const todayKey = () => {
    const k = metaCall('todayKey', null); if (k) return String(k);
    const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  };
  const now = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
  const inR = (x, y, r) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const isUp = c => c === 'ArrowUp' || c === 'KeyW';
  const isDown = c => c === 'ArrowDown' || c === 'KeyS';
  const isLeft = c => c === 'ArrowLeft' || c === 'KeyA';
  const isRight = c => c === 'ArrowRight' || c === 'KeyD';
  const isOk = c => c === 'Enter' || c === 'NumpadEnter' || c === 'Space';
  const isBack = c => c === 'Escape' || c === 'Backspace';
  const META = () => G.Meta;
  const md = () => (G.Meta && G.Meta.data) || {};
  const CHAR_ORDER = () => G.CHAR_ORDER || ['ranger', 'mage', 'knight', 'alchemist'];
  const DIFF_ORDER = () => G.DIFF_ORDER || ['casual', 'normal', 'hard'];
  const go = (id, arg) => { if (G.go) G.go(id, arg); };
  const sfx = (n) => { try { if (G.Audio && G.Audio.play) G.Audio.play(n); } catch (e) { /* */ } };

  // ---------- 通用按钮 ----------
  function button(ctx, b, sel, o) {
    o = o || {};
    const hot = sel;
    G.gfx.panel(ctx, b.x, b.y, b.w, b.h, { sel: hot, fill: hot ? 'rgba(58,68,102,0.95)' : 'rgba(24,20,37,0.88)', edge: o.edge || (hot ? G.COL.edgeHi : G.COL.edge), shadow: o.shadow });
    const size = o.size || 18;
    T(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, size, o.color || (hot ? '#fff' : '#c0cbdc'), 'center', true, { shadow: true });
  }
  function crystalTag(ctx, x, y, n, align) {
    const s = String(n);
    const w = MEAS(ctx, s, 16, true);
    const ix = align === 'right' ? x - w - 14 : x + 8;
    K().icon(ctx, 'ui_crystal', ix, y, 18, K().crystalFb);
    T(ctx, s, align === 'right' ? x : x + 20, y + 1, 16, G.COL.crystalHi, align === 'right' ? 'right' : 'left', true);
  }
  function footer(ctx, s) {
    ctx.fillStyle = 'rgba(24,20,37,0.85)'; ctx.fillRect(0, 512, G.VW, 28);
    T(ctx, s, 480, 526, 14, G.COL.dim, 'center');
  }
  function header(ctx, title, sub) {
    T(ctx, title, 480, 34, 28, '#fff', 'center', true, { shadow: true });
    if (sub) T(ctx, sub, 480, 64, 14, G.COL.dim, 'center');
  }
  function dimBg(ctx, a) { ctx.fillStyle = 'rgba(12,10,20,' + (a || 0.78) + ')'; ctx.fillRect(0, 0, G.VW, G.VH); }

  // ---------- 程序化背景（裂隙 + 星尘 + 地平线） ----------
  const bgDust = [];
  function bg(ctx, intensity, rx) {
    const t = now();
    const g = ctx.createLinearGradient(0, 0, 0, G.VH);
    g.addColorStop(0, '#181425'); g.addColorStop(0.6, '#262b44'); g.addColorStop(1, '#181425');
    ctx.fillStyle = g; ctx.fillRect(0, 0, G.VW, G.VH);
    if (!bgDust.length) for (let i = 0; i < 110; i++) bgDust.push({ x: Math.random() * 960, y: Math.random() * 540, s: 1 + Math.random() * 2.5, v: 6 + Math.random() * 20, c: ['#2ce8f5', '#b55088', '#68386c', '#c0cbdc'][i % 4], p: Math.random() * 6 });
    // 裂隙
    const cx = rx || 480, k = intensity || 1;
    for (let i = 2; i >= 0; i--) {
      ctx.save(); ctx.globalAlpha = (0.16 + 0.05 * Math.sin(t * 1.3 + i)) * k;
      G.gfx.circle(ctx, cx, 255, 90 + i * 70 + 8 * Math.sin(t + i), i === 0 ? '#b55088' : i === 1 ? '#68386c' : '#3a4466');
      ctx.restore();
    }
    ctx.save();
    for (let y = 60; y < 452; y += 4) {
      const off = Math.round(Math.sin(y * 0.05 + t * 2) * 6 + Math.sin(y * 0.013 - t) * 10);
      const w = Math.max(2, Math.round(16 - Math.abs(y - 255) / 14));
      ctx.globalAlpha = 0.55 * k; ctx.fillStyle = '#b55088'; ctx.fillRect(Math.round(cx + off - w * 1.4), y, Math.round(w * 2.8), 4);
      ctx.globalAlpha = 0.95 * k; ctx.fillStyle = '#2ce8f5'; ctx.fillRect(Math.round(cx + off - w * 0.7), y, Math.max(2, Math.round(w * 1.4)), 4);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(cx + off - w * 0.25), y, Math.max(2, Math.round(w * 0.5)), 4);
    }
    ctx.restore();
    bgDust.forEach(d => {
      const y = (d.y - t * d.v) % 540, yy = y < 0 ? y + 540 : y;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 2 + d.p);
      ctx.fillStyle = d.c; ctx.fillRect(Math.round(d.x), Math.round(yy), Math.ceil(d.s), Math.ceil(d.s));
    });
    ctx.globalAlpha = 1;
    // 像素地平线（废墟剪影）
    for (let x = 0; x < 960; x += 8) {
      const h = 34 + Math.round(18 * Math.abs(Math.sin(x * 0.021)) + 22 * (Math.sin(x * 0.0071) > 0.6 ? 1 : 0));
      ctx.fillStyle = '#3a4466'; ctx.fillRect(x, 540 - h - 2, 8, 2);
      ctx.fillStyle = '#262b44'; ctx.fillRect(x, 540 - h, 8, h);
    }
  }

  // ---------- 像素风标题（低分辨率渲染后整数放大 + 阈值化） ----------
  let titleCache = null;
  function pixelTitle(ctx, text, cx, cy, scale) {
    if (!titleCache || titleCache.text !== text) {
      try {
        const fs = 20, c = document.createElement('canvas');
        const m = c.getContext('2d'); m.font = 'bold ' + fs + 'px ' + G.FONT;
        const w = Math.ceil(m.measureText(text).width) + 6, h = fs + 8;
        c.width = w; c.height = h;
        m.font = 'bold ' + fs + 'px ' + G.FONT; m.textBaseline = 'middle'; m.fillStyle = '#fff'; m.fillText(text, 3, h / 2 + 1);
        const id = m.getImageData(0, 0, w, h), d = id.data;
        const grad = ['#fee761', '#fee761', '#feae34', '#feae34', '#f77622', '#f77622', '#be4a2f'];
        for (let y = 0; y < h; y++) {
          const col = grad[Math.min(grad.length - 1, Math.floor(y / h * grad.length))];
          const r = parseInt(col.slice(1, 3), 16), g = parseInt(col.slice(3, 5), 16), b = parseInt(col.slice(5, 7), 16);
          for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i + 3] > 110) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } else d[i + 3] = 0; }
        }
        m.putImageData(id, 0, 0);
        // 描边版
        const o = document.createElement('canvas'); o.width = w + 2; o.height = h + 2;
        const om = o.getContext('2d');
        const sil = document.createElement('canvas'); sil.width = w; sil.height = h;
        const sm = sil.getContext('2d'); sm.drawImage(c, 0, 0); sm.globalCompositeOperation = 'source-in'; sm.fillStyle = '#181425'; sm.fillRect(0, 0, w, h);
        for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2], [2, 2]]) om.drawImage(sil, dx, dy);
        om.drawImage(c, 1, 1);
        titleCache = { text, c: o };
      } catch (e) { titleCache = { text, c: null }; }
    }
    if (titleCache.c) {
      const c = titleCache.c, w = c.width * scale, h = c.height * scale;
      const prev = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
      ctx.imageSmoothingEnabled = prev;
    } else T(ctx, text, cx, cy, 72, G.COL.gold, 'center', true, { shadow: true });
  }

  // ---------- 列表菜单工具 ----------
  function listNav(scr, code, n) {
    if (isUp(code)) { scr.sel = (scr.sel + n - 1) % n; sfx('ui'); return true; }
    if (isDown(code)) { scr.sel = (scr.sel + 1) % n; sfx('ui'); return true; }
    return false;
  }
  function hitIndex(btns, x, y) { for (let i = 0; i < btns.length; i++) if (inR(x, y, btns[i])) return i; return -1; }

  const screens = {};
  G.UI = {
    screens,
    go(id, arg) { if (G.go) G.go(id, arg); else if (screens[id]) screens[id].enter(arg); },
    // main.js 每帧调用（场景模式下调用一次 update(1)）：推进各界面的“出现时长”，用于入场输入冷却
    update(dt) { for (const k in screens) { const sc = screens[k]; sc.age = (sc.age || 0) + (dt || 0); } },
    bg, button, header, footer, dimBg
  };

  // =====================================================================
  // 标题
  // =====================================================================
  const TITLE_MENU = [['start', '开始游戏'], ['daily', '每日裂隙'], ['meta', '魂晶商店'], ['records', '纪录'], ['help', '操作说明'], ['settings', '设置']];
  screens.title = {
    sel: 0, btns: [],
    enter() { this.sel = 0; this.t0 = now(); },
    render(ctx) {
      bg(ctx, 1, 690);
      const t = now();
      // 裂隙前的猎人剪影
      K().icon(ctx, 'char_ranger', 690, 430 + Math.round(Math.sin(t * 2) * 1) * 2, 96, function (c, x, y) { G.gfx.circle(c, x, y, 26, '#63c74d', '#181425', 3); }, { frame: Math.floor(t * 2) % 2 ? 'idle1' : 'idle0' });
      pixelTitle(ctx, G.TITLE || '裂隙猎人', 480, 100 + Math.round(Math.sin(t * 1.5) * 2) * 2, 4);
      T(ctx, '即时动作肉鸽 · 俯视角射击', 480, 162, 16, G.COL.crystalHi, 'center', true, { shadow: true });
      const nAff = metaCall('affordableCount', 0) || 0;
      this.btns = TITLE_MENU.map((m, i) => ({ x: 150, y: 196 + i * 50, w: 220, h: 42, label: m[1], id: m[0] }));
      this.btns.forEach((b, i) => {
        button(ctx, b, i === this.sel);
        if (b.id === 'meta' && nAff > 0) { // 评审 4：有买得起的项目时显示小红点
          G.gfx.circle(ctx, b.x + b.w - 14, b.y + 12, 6, G.COL.hp, '#181425', 2);
        }
        if (b.id === 'daily') {
          const dd = md().daily, played = dd && String(dd.key) === todayKey() && (dd.tries || 0) > 0;
          if (!played) G.gfx.circle(ctx, b.x + b.w - 14, b.y + 12, 5, G.COL.gold, '#181425', 2);
        }
      });
      const selId = TITLE_MENU[this.sel] && TITLE_MENU[this.sel][0];
      let tip = '';
      if (selId === 'daily') tip = '今日裂隙 ' + fmtKey(todayKey()) + ' · 所有猎人同一张地图';
      else if (selId === 'meta' || selId === 'start') tip = metaCall('goalLine', '') || '';
      if (tip) T(ctx, FIT(ctx, tip, 400, 14), 390, this.btns[this.sel].y + 21, 14, selId === 'daily' ? G.COL.gold : '#c0cbdc', 'left', false, { shadow: true });
      const d = md();
      ctx.fillStyle = 'rgba(24,20,37,0.8)'; ctx.fillRect(0, 0, G.VW, 30);
      K().icon(ctx, 'ui_crystal', 20, 15, 18, K().crystalFb);
      T(ctx, '魂晶 ' + (d.crystals || 0), 34, 16, 14, G.COL.crystalHi, 'left', true);
      const best = d.best || {};
      T(ctx, best.floor ? '最高到达第 ' + best.floor + ' 层 · 通关 ' + (d.wins || 0) + ' 次' : '还没有纪录', 940, 16, 14, G.COL.dim, 'right');
      footer(ctx, '↑↓ 选择 · 回车 确认 · 也可以用鼠标点击      v' + (G.VERSION || '3'));
    },
    act(i) {
      const id = TITLE_MENU[i][0];
      sfx('ui');
      if (id === 'start') go('charselect');
      else if (id === 'daily') go('charselect', 'daily');
      else go(id, 'title');
    },
    key(code) {
      if (listNav(this, code, TITLE_MENU.length)) return true;
      if (isOk(code)) { this.act(this.sel); return true; }
      if (code === 'KeyH' || code === 'F1') { go('help', 'title'); return true; }
      return false;
    },
    click(x, y) { const i = hitIndex(this.btns, x, y); if (i >= 0) { this.sel = i; this.act(i); return true; } return false; },
    move(x, y) { const i = hitIndex(this.btns, x, y); if (i >= 0) this.sel = i; },
    wheel() {}
  };

  // =====================================================================
  // 角色选择 + 难度
  // =====================================================================
  screens.charselect = {
    ci: 0, di: 1, btns: [], cards: [], diffs: [], startBtn: null, msg: '', msgT: 0,
    daily: false,
    enter(arg) {
      const d = md();
      this.daily = arg === 'daily';
      this.ci = Math.max(0, CHAR_ORDER().indexOf(d.lastChar || 'ranger'));
      this.di = this.daily ? Math.max(0, DIFF_ORDER().indexOf('normal')) : Math.max(0, DIFF_ORDER().indexOf(d.lastDiff || 'normal'));
      this.msg = ''; this.t0 = now();
    },
    cid() { return CHAR_ORDER()[this.ci]; },
    unlocked(cid) { return !G.Meta || G.Meta.isUnlocked('char', cid); },
    flash(m) { this.msg = m; this.msgT = now(); },
    tryUnlock(cid) {
      const r = G.Meta.buy(cid);
      this.flash(r.msg); sfx(r.ok ? 'buy' : 'deny');
      return r.ok;
    },
    start() {
      const cid = this.cid(), diff = DIFF_ORDER()[this.di];
      if (!this.unlocked(cid)) { this.tryUnlock(cid); return; }
      sfx('ui');
      if (this.daily) {
        if (typeof G.startDaily === 'function') G.startDaily(cid);
        else if (G.startRun) G.startRun(cid, 'normal');
        return;
      }
      if (G.Meta && G.Meta.setLast) G.Meta.setLast(cid, diff);
      if (G.startRun) G.startRun(cid, diff);
    },
    render(ctx) {
      bg(ctx, 0.35);
      header(ctx, this.daily ? '每日裂隙 · 选择角色' : '选择角色');
      const sm = SM();
      crystalTag(ctx, 940, 34, md().crystals || 0, 'right');
      const ids = CHAR_ORDER();
      this.cards = [];
      ids.forEach((cid, i) => {
        const c = (G.CHARS && G.CHARS[cid]) || { name: cid };
        const x = 39 + i * 224, y = 62, w = 210, h = 362;
        const un = this.unlocked(cid), sel = i === this.ci;
        this.cards.push({ x, y, w, h, i });
        G.gfx.panel(ctx, x, y, w, h, { sel, fill: sel ? 'rgba(38,43,68,0.97)' : 'rgba(24,20,37,0.92)', edge: sel ? (c.color || G.COL.edgeHi) : G.COL.edge });
        // 精灵
        ctx.save();
        if (!un) { ctx.globalAlpha = 0.55; ctx.filter = 'brightness(0.15)'; }
        const fr = sel ? (Math.floor(now() * 3) % 2 ? 'idle1' : 'idle0') : 'idle0';
        K().icon(ctx, 'char_' + cid, x + w / 2, y + 52, 72, function (cx2, px, py) {
          G.gfx.circle(cx2, px, py, 22, c.color || '#8b9bb4', '#181425', 3);
        }, { frame: fr });
        ctx.restore();
        T(ctx, c.name || cid, x + w / 2, y + 106, 20, un ? (c.color || '#fff') : G.COL.dim, 'center', true, { shadow: true });
        const hearts = (c.hp || 0) / 2;
        // 紧凑布局（小窗口）：字号更大，描述最多 2 行
        const L = sm ? { s1: 130, s2: 152, sk: 178, skd: 199, skn: 2, ps: 250, psd: 271, wp: 342 } : { s1: 136, s2: 158, sk: 186, skd: 207, skn: 3, ps: 272, psd: 293, wp: 344 };
        T(ctx, FIT(ctx, '生命 ' + K().fmtNum(hearts) + ' 心   护盾 ' + (c.shield || 0), w - 24, 14), x + 14, y + L.s1, 14, '#fff', 'left');
        T(ctx, FIT(ctx, '能量 ' + (c.energy || 0) + '   移速 ' + (c.spd || 0), w - 24, 14), x + 14, y + L.s2, 14, '#fff', 'left');
        const sk = c.skill || {}, ps = c.passive || {};
        T(ctx, FIT(ctx, '技能 · ' + (sk.name || ''), w - 24, 14, true), x + 14, y + L.sk, 14, G.COL.gold, 'left', true);
        W(ctx, sk.desc || '', x + 14, y + L.skd, w - 28, 14, '#c0cbdc', 'left', { maxLines: L.skn, lineH: 19 });
        T(ctx, FIT(ctx, '被动 · ' + (ps.name || ''), w - 24, 14, true), x + 14, y + L.ps, 14, G.COL.crystalHi, 'left', true);
        W(ctx, ps.desc || '', x + 14, y + L.psd, w - 28, 14, '#c0cbdc', 'left', { maxLines: 2, lineH: 19 });
        const wd = G.WEAPONS && c.weapon && G.WEAPONS[c.weapon];
        T(ctx, FIT(ctx, '初始武器：' + (wd ? wd.name : (c.weapon || '')), w - 24, 14), x + 14, y + L.wp, 14, '#fff', 'left');
        if (!un) {
          const cost = G.Meta && G.Meta.unlockDef(cid) ? G.Meta.unlockDef(cid).cost : (c.cost || 0);
          G.gfx.panel(ctx, x + 20, y + 22, w - 40, 60, { fill: 'rgba(24,20,37,0.95)', edge: G.COL.crystal });
          T(ctx, '未解锁', x + w / 2, y + 40, 16, '#fff', 'center', true);
          crystalTag(ctx, x + w / 2 - 22, y + 64, cost, 'left');
        }
      });
      // 难度
      const dids = DIFF_ORDER();
      const un = this.unlocked(this.cid());
      if (this.daily) {
        // 每日裂隙：难度固定普通，所有猎人同一张地图
        this.diffs = [];
        G.gfx.panel(ctx, 39, 438, 680, 58, { shadow: false, edge: G.COL.gold, fill: 'rgba(24,20,37,0.92)' });
        T(ctx, FIT(ctx, '今日裂隙 ' + fmtKey(todayKey()) + ' · 所有猎人同一张地图', 650, 15, true), 55, 455, 15, G.COL.gold, 'left', true);
        const dd = md().daily, today = dd && String(dd.key) === todayKey();
        const rec = today && (dd.tries || 0) > 0 ? '今日已挑战 ' + dd.tries + ' 次 · 最佳：' + (dd.win ? '已通关' : '第 ' + (dd.floor || 1) + ' 层') + (dd.kills ? ' · 击杀 ' + dd.kills : '')
          : '难度固定为普通 · 今日首次挑战';
        T(ctx, FIT(ctx, rec, 650, 14), 55, 479, 14, '#c0cbdc', 'left');
      } else {
        this.diffs = dids.map((id, i) => ({ x: 39 + i * 124, y: 444, w: 116, h: 40, label: (G.DIFFS && G.DIFFS[id] ? G.DIFFS[id].name : id), i }));
        this.diffs.forEach((b, i) => button(ctx, b, i === this.di, { size: 16, color: i === this.di ? (i === 2 ? G.COL.hp : i === 0 ? G.COL.ok : '#fff') : undefined }));
        const dd = G.DIFFS && G.DIFFS[dids[this.di]];
        if (dd) W(ctx, dd.desc || '', 416, sm ? 452 : 455, 310, 14, '#c0cbdc', 'left', { maxLines: 2, lineH: 20 });
      }
      this.startBtn = { x: 742, y: 444, w: 180, h: 44, label: un ? (this.daily ? '开始挑战' : '开始冒险') : '解锁角色' };
      button(ctx, this.startBtn, true, { size: 18, color: un ? G.COL.gold : G.COL.crystalHi });
      if (this.msg && now() - this.msgT < 2.5) T(ctx, FIT(ctx, this.msg, 206, 14, true), 832, 501, 14, G.COL.key, 'center', true);
      footer(ctx, '←→ 选择角色 · ' + (this.daily ? '' : '↑↓ 切换难度 · ') + '回车 ' + (un ? '开始' : '解锁') + ' · Esc 返回');
    },
    key(code) {
      const n = CHAR_ORDER().length, nd = DIFF_ORDER().length;
      if (isLeft(code)) { this.ci = (this.ci + n - 1) % n; sfx('ui'); return true; }
      if (isRight(code)) { this.ci = (this.ci + 1) % n; sfx('ui'); return true; }
      if (this.daily && (isUp(code) || isDown(code))) return true;
      if (isUp(code)) { this.di = (this.di + nd - 1) % nd; sfx('ui'); return true; }
      if (isDown(code)) { this.di = (this.di + 1) % nd; sfx('ui'); return true; }
      if (/^Digit[1-4]$/.test(code)) { this.ci = Math.min(n - 1, +code.slice(5) - 1); return true; }
      if (isOk(code)) { this.start(); return true; }
      if (isBack(code)) { go('title'); return true; }
      return false;
    },
    click(x, y) {
      for (const c of this.cards) if (inR(x, y, c)) {
        if (this.ci === c.i) this.start(); else { this.ci = c.i; sfx('ui'); }
        return true;
      }
      for (const b of this.diffs) if (inR(x, y, b)) { this.di = b.i; sfx('ui'); return true; }
      if (inR(x, y, this.startBtn)) { this.start(); return true; }
      return false;
    },
    move() {}, wheel() {}
  };

  // =====================================================================
  // 魂晶商店：角色解锁 / 永久强化 / 内容解锁
  // =====================================================================
  function shopCols() {
    const M = G.Meta; if (!M) return [[], [], []];
    const chars = M.UNLOCKS.filter(u => u.kind === 'char').map(u => {
      const c = G.CHARS && G.CHARS[u.id];
      return { id: u.id, name: M.unlockName(u), color: c ? c.color : '#fff', desc: (c && c.desc) || u.desc, owned: M.ownedUnlock(u), cost: u.cost, kind: '角色', icon: 'char_' + u.id };
    });
    const upg = M.UPGRADES.map(u => {
      const l = M.level(u.id);
      return { id: u.id, name: u.name, lv: l, max: u.max, color: '#fff', desc: u.desc, owned: l >= u.max, cost: M.upgCost(u.id), kind: '永久强化', icon: u.icon, upg: true };
    });
    const items = M.UNLOCKS.filter(u => u.kind === 'item').map(u => {
      const d = (u.type === 'weapon' ? G.WEAPONS : G.RELICS) || {};
      const def = d[u.id];
      return { id: u.id, name: M.unlockName(u), color: def ? G.rarityColor(def.rarity) : '#fff', desc: (def && def.desc) || u.desc, owned: M.ownedUnlock(u), cost: u.cost,
        kind: (u.type === 'weapon' ? '武器' : '遗物') + (def ? ' · ' + G.rarityName(def.rarity) : ''), icon: (u.type === 'weapon' ? 'weapon_' : 'icon_') + u.id, weapon: u.type === 'weapon' };
    });
    return [chars, upg, items];
  }
  screens.meta = {
    col: 1, row: 0, rows: [], msg: '', msgT: 0,
    enter() { this.msg = ''; this.t0 = now(); },
    cur() { const c = shopCols()[this.col] || []; return c[Math.min(this.row, c.length - 1)]; },
    buy(it) {
      if (!it || !G.Meta) return;
      const r = G.Meta.buy(it.id);
      this.msg = r.msg; this.msgOk = r.ok; this.msgT = now(); sfx(r.ok ? 'buy' : 'deny');
    },
    render(ctx) {
      bg(ctx, 0.25);
      header(ctx, '魂晶商店');
      crystalTag(ctx, 940, 34, md().crystals || 0, 'right');
      T(ctx, '累计获得 ' + (md().crystalsTotal || 0), 20, 34, 14, G.COL.dim, 'left');
      const cols = shopCols(), xs = [10, 328, 646], heads = ['角色解锁', '永久强化', '内容解锁'];
      this.rows = [];
      cols.forEach((list, ci) => {
        T(ctx, heads[ci], xs[ci] + 4, 70, 15, G.COL.gold, 'left', true);
        list.forEach((it, ri) => {
          const x = xs[ci], y = 84 + ri * 44, w = 304, h = 40;
          const sel = ci === this.col && ri === this.row;
          this.rows.push({ x, y, w, h, ci, ri });
          G.gfx.panel(ctx, x, y, w, h, { sel, shadow: false, fill: sel ? 'rgba(58,68,102,0.95)' : 'rgba(24,20,37,0.88)' });
          ctx.save(); if (it.owned && !it.upg) ctx.globalAlpha = 0.6;
          if (it.weapon) K().weaponIcon(ctx, it.id, x + 20, y + 20, 30);
          else if (it.icon && it.icon.indexOf('icon_') === 0) K().relicIcon(ctx, it.id, x + 20, y + 20, 26);
          else K().icon(ctx, it.icon, x + 20, y + 20, 30, function (c, px, py) { G.gfx.circle(c, px, py, 9, it.color); });
          ctx.restore();
          T(ctx, FIT(ctx, it.name, 160, 15, true), x + 40, y + 13, 15, it.owned && !it.upg ? G.COL.dim : it.color, 'left', true);
          T(ctx, FIT(ctx, it.desc, 254, 14), x + 40, y + 31, 14, G.COL.dim, 'left');
          if (it.owned) T(ctx, it.upg ? '满级' : '已解锁', x + w - 10, y + 13, 14, G.COL.ok, 'right', true);
          else {
            const afford = (md().crystals || 0) >= it.cost;
            K().icon(ctx, 'ui_crystal', x + w - 14 - MEAS(ctx, String(it.cost), 15, true) - 8, y + 13, 16, K().crystalFb);
            T(ctx, String(it.cost), x + w - 10, y + 13, 15, afford ? G.COL.crystalHi : G.COL.hp, 'right', true);
          }
          if (it.upg) for (let k = 0; k < it.max; k++) { ctx.fillStyle = k < it.lv ? G.COL.gold : '#3a4466'; ctx.fillRect(x + 168 + k * 10, y + 10, 7, 7); }
        });
      });
      // 详情面板
      const it = this.cur();
      G.gfx.panel(ctx, 10, 224, 304, 276, { edge: G.COL.edgeHi });
      if (it) {
        T(ctx, FIT(ctx, it.name, 280, 18, true), 24, 246, 18, it.color, 'left', true);
        T(ctx, it.kind + (it.upg ? ' · 等级 ' + it.lv + '/' + it.max : ''), 24, 272, 14, G.COL.dim, 'left');
        W(ctx, it.desc || '', 24, 298, 276, 14, '#fff', 'left', { maxLines: 5, lineH: 20 });
        let st;
        if (it.owned) st = it.upg ? '已达到最高等级' : '已拥有';
        else st = ((md().crystals || 0) >= it.cost ? '回车 / 再次点击 购买' : '魂晶不足') + '（' + it.cost + ' 魂晶）';
        T(ctx, st, 24, 418, 14, it.owned ? G.COL.ok : G.COL.key, 'left', true);
      }
      if (this.msg && now() - this.msgT < 3) W(ctx, this.msg, 24, 450, 276, 15, this.msgOk ? G.COL.ok : G.COL.hp, 'left', { bold: true, maxLines: 2, lineH: 20 });
      footer(ctx, '←→ 切换分栏 · ↑↓ 选择 · 回车 购买 · Esc 返回');
    },
    key(code) {
      const cols = shopCols();
      if (isLeft(code)) { this.col = (this.col + 2) % 3; this.row = Math.min(this.row, cols[this.col].length - 1); sfx('ui'); return true; }
      if (isRight(code)) { this.col = (this.col + 1) % 3; this.row = Math.min(this.row, cols[this.col].length - 1); sfx('ui'); return true; }
      const n = cols[this.col].length || 1;
      if (isUp(code)) { this.row = (this.row + n - 1) % n; sfx('ui'); return true; }
      if (isDown(code)) { this.row = (this.row + 1) % n; sfx('ui'); return true; }
      if (isOk(code)) { this.buy(this.cur()); return true; }
      if (isBack(code)) { go('title'); return true; }
      return false;
    },
    click(x, y) {
      for (const r of this.rows) if (inR(x, y, r)) {
        if (r.ci === this.col && r.ri === this.row) this.buy(this.cur());
        else { this.col = r.ci; this.row = r.ri; sfx('ui'); }
        return true;
      }
      return false;
    },
    move() {}, wheel() {}
  };

  // =====================================================================
  // 纪录
  // =====================================================================
  const CNAME = (cid) => (G.CHARS && G.CHARS[cid] ? G.CHARS[cid].name : cid);
  const DNAME = (d) => (G.DIFFS && G.DIFFS[d] ? G.DIFFS[d].name : d);
  screens.records = {
    enter() { this.t0 = now(); },
    render(ctx) {
      bg(ctx, 0.25);
      header(ctx, '纪录');
      const d = md(), b = d.best || {};
      const stats = [['最高到达', b.floor ? '第 ' + b.floor + ' 层' : '—'], ['最多击杀', String(b.kills || 0)], ['最快通关', b.fastestWin ? G.fmtTime(b.fastestWin) : '—'],
        ['单局最多魂晶', String(b.bestCrystals || 0)], ['总局数 / 通关', (d.runs || 0) + ' / ' + (d.wins || 0)], ['累计魂晶', String(d.crystalsTotal || 0)]];
      stats.forEach((s, i) => {
        const x = 30 + i * 151, y = 58;
        G.gfx.panel(ctx, x, y, 143, 56, { shadow: false });
        T(ctx, FIT(ctx, s[0], 135, 14), x + 71, y + 17, 14, G.COL.dim, 'center');
        T(ctx, FIT(ctx, s[1], 135, 18, true), x + 71, y + 39, 18, G.COL.gold, 'center', true);
      });
      // 各难度通关次数 + 每日裂隙
      const wb = d.winsBy || {};
      G.gfx.panel(ctx, 30, 122, 445, 44, { shadow: false });
      T(ctx, '各难度通关', 44, 144, 14, G.COL.dim, 'left', true);
      const dids = DIFF_ORDER(), dcol = { casual: G.COL.ok, normal: '#fff', hard: G.COL.hp };
      dids.forEach((id, i) => {
        T(ctx, DNAME(id) + ' ' + (wb[id] || 0), 150 + i * 106, 144, 16, dcol[id] || '#fff', 'left', true);
      });
      G.gfx.panel(ctx, 485, 122, 445, 44, { shadow: false, edge: G.COL.gold });
      const dy = d.daily, tk = todayKey(), today = dy && String(dy.key) === tk;
      T(ctx, '每日裂隙', 499, 144, 14, G.COL.gold, 'left', true);
      const dtxt = today && (dy.tries || 0) > 0
        ? '今日 ' + dy.tries + ' 次 · 最佳 ' + (dy.win ? '已通关' : '第 ' + (dy.floor || 1) + ' 层') + (dy.time ? ' · ' + G.fmtTime(dy.time) : '')
        : '今日（' + fmtKey(tk) + '）还未挑战';
      T(ctx, FIT(ctx, dtxt, 330, 14), 590, 144, 14, '#fff', 'left');
      T(ctx, '最近 10 局', 30, 188, 16, '#fff', 'left', true);
      const cols = [[30, '#'], [62, '日期'], [180, '角色'], [262, '难度'], [326, '结果'], [396, '层数'], [456, '击杀'], [522, '用时'], [596, '魂晶'], [664, '种子'], [764, '结局']];
      G.gfx.panel(ctx, 20, 202, 920, 304, { shadow: false });
      cols.forEach(c => T(ctx, c[1], c[0], 220, 14, G.COL.dim, 'left', true));
      const h = d.history || [];
      if (!h.length) T(ctx, '还没有完成的冒险。去裂隙里闯一闯吧！', 480, 340, 16, G.COL.dim, 'center');
      h.slice(0, 10).forEach((r, i) => {
        const y = 245 + i * 26;
        if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(24, y - 13, 912, 26); }
        const quit = !r.win && /放弃/.test(r.cause || '');
        let date = '—';
        try { if (r.t) { const dt = new Date(r.t); date = (dt.getMonth() + 1) + '-' + String(dt.getDate()).padStart(2, '0') + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'); } } catch (e) { /* */ }
        const v = [String(i + 1), date, CNAME(r.cid), r.daily ? '每日' : DNAME(r.diff), r.win ? '通关' : quit ? '放弃' : '阵亡', String(r.floor), String(r.kills), G.fmtTime(r.time), '+' + r.crystals, String(r.seed), r.win ? '封印裂隙' : quit ? '主动放弃' : (r.cause ? '被' + r.cause + '击倒' : '倒下')];
        v.forEach((s, j) => {
          const col = j === 4 ? (r.win ? G.COL.ok : quit ? G.COL.dim : G.COL.hp) : j === 8 ? G.COL.crystalHi : '#fff';
          T(ctx, j === 10 ? FIT(ctx, s, 166, 14) : j === 9 ? FIT(ctx, s, 94, 14) : s, cols[j][0], y, 14, col, 'left', j === 4);
        });
      });
      footer(ctx, 'Esc / 回车 返回');
    },
    key(code) { if (isBack(code) || isOk(code)) { go('title'); return true; } return false; },
    click() { go('title'); return true; },
    move() {}, wheel() {}
  };

  // =====================================================================
  // 操作说明（标题或暂停页内）
  // =====================================================================
  // 键位以 main.js 的实际绑定为准（gameKey / pollPad / padInput / hud.js 的 Enter 关闭提示）
  const KEYS = [['WASD', '移动'], ['鼠标 / 左键', '瞄准 / 按住射击'], ['方向键', '朝该方向射击（纯键盘）'], ['空格 / 右键', '翻滚（翻滚中无敌）'],
    ['Q', '角色技能'], ['E', '交互：拾取 / 开箱 / 购买 / 献祭'], ['X / 滚轮', '切换武器'], ['F', '主动道具'], ['Tab', '地图（打开时游戏暂停）'],
    ['Esc / P', '暂停'], ['H / F1', '操作说明'], ['M', '静音']];
  const KEYS_UI = [['回车', '关闭新手提示'], ['1 / 2 / 3', '遗物三选一（或点击卡片）'], ['R / 回车', '结算页：再来一局'], ['S', '结算页：魂晶商店']];
  const KEYS_PAD = [['左摇杆', '移动（菜单中为方向）'], ['右摇杆 / RT', '瞄准并射击'], ['A / RB', '翻滚（菜单中为确认）'], ['B · X · Y', '技能 · 交互 · 换枪'],
    ['LB', '主动道具'], ['Start · Back', '暂停 · 地图']];
  const TIPS = [
    ['生命与护盾', '一颗心等于 2 点生命。护盾每格抵挡一次伤害，脱离战斗 5 秒后自动回复。临时护甲最先抵消伤害。'],
    ['能量', '强力武器每次射击消耗能量，初始武器不消耗。击败敌人和打破箱子会掉落能量球。'],
    ['房间与首领', '进入战斗房后门会锁上，清光所有波次才会打开。每层尽头是首领房：地上的红色区域填满时落下攻击，提前离开。'],
    ['遗物与协同', '遗物效果可以叠加。同系遗物集齐 2 件和 3 件会触发协同，暂停页可查看进度。'],
    ['魂晶', '每局结束按到达层数、击败首领和击杀数获得魂晶。清理不足 2 个房间就放弃不结算魂晶。'],
    ['每日裂隙', '每天一张固定地图，难度为普通，所有猎人挑战同一个种子。纪录页单独记录今日成绩。']
  ];
  const HELP_TABS = ['键位', '机制'];
  function keyRows(ctx, list, x, y, step, kw) {
    list.forEach((k, i) => {
      T(ctx, FIT(ctx, k[0], kw - 10, 14, true), x, y + i * step, 14, G.COL.key, 'left', true);
      T(ctx, FIT(ctx, k[1], 440 - kw - 40, 14), x + kw, y + i * step, 14, '#fff', 'left');
    });
    return y + list.length * step;
  }
  function drawHelp(ctx, tab, scr) {
    header(ctx, '操作说明');
    // 页签
    scr.tabs = HELP_TABS.map((n, i) => ({ x: 650 + i * 140, y: 18, w: 130, h: 34, label: n, i }));
    scr.tabs.forEach((b, i) => button(ctx, b, i === tab, { size: 16, shadow: false, color: i === tab ? G.COL.gold : undefined }));
    const step = SM() ? 30 : 28;
    if (tab === 0) {
      G.gfx.panel(ctx, 30, 70, 440, 432, { shadow: false });
      T(ctx, '键盘与鼠标', 50, 92, 16, G.COL.gold, 'left', true);
      keyRows(ctx, KEYS, 50, 124, step, 130);
      G.gfx.panel(ctx, 490, 70, 440, 432, { shadow: false });
      T(ctx, '界面', 510, 92, 16, G.COL.gold, 'left', true);
      let y = keyRows(ctx, KEYS_UI, 510, 124, step, 130);
      T(ctx, '手柄', 510, y + 8, 16, G.COL.gold, 'left', true);
      keyRows(ctx, KEYS_PAD, 510, y + 8 + step + 2, step, 140);
    } else {
      G.gfx.panel(ctx, 30, 70, 900, 432, { shadow: false });
      let y = 100;
      const lh = SM() ? 22 : 20;
      TIPS.forEach(t => {
        T(ctx, t[0], 50, y, 15, G.COL.crystalHi, 'left', true);
        const n = W(ctx, t[1], 190, y, 720, 14, '#c0cbdc', 'left', { lineH: lh - (F(14) - 14), maxLines: 2 });
        y += Math.max(1, n) * lh + (SM() ? 14 : 22);
      });
    }
  }
  screens.help = {
    tab: 0, tabs: [],
    enter(arg) { this.t0 = now(); this.tab = arg === 'tips' ? 1 : 0; },
    render(ctx, overlay) {
      if (overlay) dimBg(ctx, 0.92); else bg(ctx, 0.2);
      drawHelp(ctx, this.tab, this);
      footer(ctx, '←→ 切换页面 · Esc / 回车 返回');
    },
    close() { if (this.onClose) { const f = this.onClose; this.onClose = null; f(); } else go('title'); },
    key(code) {
      if (isLeft(code) || isRight(code) || code === 'Tab') { this.tab = (this.tab + 1) % HELP_TABS.length; sfx('ui'); return true; }
      if (isBack(code) || isOk(code) || code === 'KeyH' || code === 'F1') { this.close(); return true; }
      return false;
    },
    click(x, y) {
      const i = hitIndex(this.tabs, x, y);
      if (i >= 0) { this.tab = i; sfx('ui'); return true; }
      this.close(); return true;
    },
    move() {}, wheel(dy) { this.tab = dy > 0 ? 1 : 0; }
  };

  // =====================================================================
  // 设置
  // =====================================================================
  const SET_ROWS = [
    { k: 'master', name: '主音量', type: 'vol', desc: '整体音量。' },
    { k: 'sfx', name: '音效', type: 'vol', desc: '射击、受击、拾取等音效的音量。' },
    { k: 'music', name: '音乐', type: 'vol', desc: '背景音乐音量。' },
    { k: 'mute', name: '静音', type: 'bool', desc: '关闭所有声音（游戏中按 M 也可以切换）。' },
    { k: 'shake', name: '屏幕震动', type: 'bool', desc: '爆炸、受击时的镜头震动。容易头晕可以关闭。' },
    { k: 'aimAssist', name: '瞄准辅助', type: 'bool', desc: '用方向键射击时，子弹自动偏向该方向上最近的敌人。' },
    { k: 'hints', name: '新手提示', type: 'bool', desc: '第 1 层按情况弹出操作提示。' },
    { k: 'dmgNumbers', name: '伤害数字', type: 'bool', desc: '命中敌人时显示伤害数值。' },
    { k: 'pixelPerfect', name: '像素完美缩放', type: 'bool', desc: '按整数倍放大，像素更锐利，四周会留黑边。' },
    { k: 'resetHints', name: '重新显示新手提示', type: 'act', desc: '清除已读记录，之后重新显示所有提示。' },
    { k: 'back', name: '返回', type: 'act', desc: '设置会自动保存。' }
  ];
  const SET_Y0 = 74, SET_STEP = 36;
  screens.settings = {
    sel: 0, rows: [], msg: '', msgT: 0,
    enter() { this.sel = 0; this.t0 = now(); },
    val(k) { return (G.settings || {})[k]; },
    set(k, v) { if (G.Meta && G.Meta.setSetting) G.Meta.setSetting(k, v); else if (G.settings) G.settings[k] = v; },
    act(i, dir) {
      const r = SET_ROWS[i];
      if (r.type === 'vol') { const v = Math.round(((this.val(r.k) || 0) + (dir || 0.1)) * 10) / 10; this.set(r.k, Math.max(0, Math.min(1, v))); sfx('ui'); }
      else if (r.type === 'bool') {
        this.set(r.k, !this.val(r.k)); sfx('ui');
        if (r.k === 'pixelPerfect' && typeof G.refit === 'function') { try { G.refit(); } catch (e) { /* 画布重算失败不影响设置保存 */ } }
      }
      else if (r.k === 'resetHints') { if (G.Meta && G.Meta.resetHints) G.Meta.resetHints(); if (G.HUD && G.HUD.resetHints) G.HUD.resetHints(); this.msg = '新手提示已重置'; this.msgT = now(); sfx('ui'); }
      else if (r.k === 'back') this.close();
    },
    close() { if (this.onClose) { const f = this.onClose; this.onClose = null; f(); } else go('title'); },
    render(ctx, overlay) {
      if (overlay) dimBg(ctx, 0.92); else bg(ctx, 0.2);
      header(ctx, '设置');
      this.rows = [];
      G.gfx.panel(ctx, 200, 66, 560, 414, { shadow: false });
      SET_ROWS.forEach((r, i) => {
        const y = SET_Y0 + i * SET_STEP, sel = i === this.sel;
        const row = { x: 212, y, w: 536, h: SET_STEP - 3, i };
        this.rows.push(row);
        if (sel) { ctx.fillStyle = 'rgba(90,105,136,0.35)'; ctx.fillRect(row.x, row.y, row.w, row.h); ctx.fillStyle = G.COL.sel; ctx.fillRect(row.x, row.y, 3, row.h); }
        T(ctx, r.name, 230, y + 16, 16, sel ? '#fff' : '#c0cbdc', 'left', true);
        const v = this.val(r.k);
        if (r.type === 'vol') {
          row.bar = { x: 470, y: y + 8, w: 200, h: 16 };
          G.gfx.bar(ctx, 470, y + 10, 200, 12, v || 0, G.COL.energy, 'rgba(0,0,0,0.5)', G.COL.edgeHi);
          T(ctx, Math.round((v || 0) * 100) + '%', 736, y + 16, 14, '#fff', 'right', true);
        } else if (r.type === 'bool') {
          G.gfx.rrect(ctx, 470, y + 5, 60, 22, 11, v ? 'rgba(99,199,77,0.85)' : 'rgba(58,68,102,0.9)', null);
          G.gfx.circle(ctx, v ? 519 : 481, y + 16, 8, '#fff');
          T(ctx, v ? '开' : '关', 548, y + 16, 14, v ? G.COL.ok : G.COL.dim, 'left', true);
        }
      });
      const r = SET_ROWS[this.sel];
      if (this.msg && now() - this.msgT < 2) T(ctx, this.msg, 480, 496, 14, G.COL.ok, 'center', true);
      else if (r && r.desc) T(ctx, FIT(ctx, r.desc, 900, 14), 480, 496, 14, G.COL.dim, 'center');
      footer(ctx, '↑↓ 选择 · ←→ 调节 · 回车 切换 · Esc 返回');
    },
    key(code) {
      if (listNav(this, code, SET_ROWS.length)) return true;
      const r = SET_ROWS[this.sel];
      if (isLeft(code) || isRight(code)) { if (r.type === 'vol') this.act(this.sel, isLeft(code) ? -0.1 : 0.1); else if (r.type === 'bool') this.act(this.sel); return true; }
      if (isOk(code)) { this.act(this.sel, 0.1); return true; }
      if (isBack(code)) { this.close(); return true; }
      return false;
    },
    click(x, y) {
      for (const row of this.rows) if (inR(x, y, row)) {
        this.sel = row.i;
        const r = SET_ROWS[row.i];
        if (r.type === 'vol') { if (row.bar && x >= row.bar.x - 6 && x <= row.bar.x + row.bar.w + 6) { this.set(r.k, Math.round(Math.max(0, Math.min(1, (x - row.bar.x) / row.bar.w)) * 20) / 20); sfx('ui'); } }
        else this.act(row.i);
        return true;
      }
      return false;
    },
    move(x, y) { for (const row of this.rows) if (inR(x, y, row)) this.sel = row.i; },
    wheel(dy) { const r = SET_ROWS[this.sel]; if (r && r.type === 'vol') this.act(this.sel, dy > 0 ? -0.1 : 0.1); }
  };

  // =====================================================================
  // 暂停（含设置/操作说明子页、遗物列表、协同进度、种子）
  // =====================================================================
  function synergyList(S) {
    let info = [];
    try { if (G.Items && G.Items.synergyInfo) info = G.Items.synergyInfo(S) || []; } catch (e) { info = []; }
    if (!info.length && G.SYNERGIES) {
      info = Object.keys(G.SYNERGIES).map(f => ({ family: f, name: G.SYNERGIES[f].name, have: 0, tiers: (G.SYNERGIES[f].tiers || []).map(t => ({ n: t.n, desc: t.desc, active: false })) }));
    }
    return info;
  }
  const PAUSE_MENU = [['resume', '继续游戏'], ['settings', '设置'], ['help', '操作说明'], ['abandon', '放弃本局'], ['title', '返回标题']];
  screens.pause = {
    sel: 0, btns: [], sub: null, confirm: null, scroll: 0, relicRects: [],
    enter(page) {
      this.sel = 0; this.sub = null; this.confirm = null; this.scroll = 0; this.t0 = now(); this.age = 0;
      if (page === 'help' || page === 'settings') this.act(page === 'help' ? 2 : 1);
    },
    act(i) {
      const id = PAUSE_MENU[i][0];
      sfx('ui');
      if (id === 'resume') { this.confirm = null; if (G.resume) G.resume(); else G.paused = false; return; }
      if (id === 'settings' || id === 'help') {
        this.sub = id; this.confirm = null;
        const s = screens[id]; s.enter('pause');
        s.onClose = () => { this.sub = null; };
        return;
      }
      if (this.confirm !== id) { this.confirm = id; return; }
      this.confirm = null;
      if (id === 'abandon') { G.paused = false; if (G.abandonRun) G.abandonRun(); }
      else if (id === 'title') { G.paused = false; if (G.toTitle) G.toTitle(); else { if (G.abandonRun) G.abandonRun(); go('title'); } }
    },
    // S1：放弃 / 返回标题（同样会放弃本局）的二次确认文案——按 Meta.previewAbandon(S) 提示是否结算魂晶
    confirmText(S) {
      const pv = S ? metaCall('previewAbandon', null, S) : null;
      if (!pv) return '再按一次确认放弃本局';
      if (pv.recorded === false) return '清理不足 2 个房间，放弃不结算魂晶';
      return '放弃后按进度结算约 ' + (pv.crystals || 0) + ' 魂晶';
    },
    render(ctx) {
      const S = G.S;
      if (this.sub) { screens[this.sub].render(ctx, true); return; }
      dimBg(ctx, 0.8);
      // 左：菜单
      G.gfx.panel(ctx, 30, 40, 240, 456, {});
      T(ctx, '暂停', 150, 74, 28, '#fff', 'center', true, { shadow: true });
      this.btns = PAUSE_MENU.map((m, i) => {
        let label = m[1];
        if (this.confirm === m[0]) label = m[0] === 'abandon' ? '确认放弃？' : '确认返回？';
        return { x: 50, y: 108 + i * 52, w: 200, h: 42, label, id: m[0] };
      });
      this.btns.forEach((b, i) => button(ctx, b, i === this.sel, { size: 17, color: this.confirm === b.id ? G.COL.hp : undefined }));
      if (this.confirm) W(ctx, this.confirmText(S), 150, 376, 210, 14, G.COL.hp, 'center', { maxLines: 2, lineH: 19 });
      if (S) {
        const ch = G.CHARS && G.CHARS[S.p && S.p.cid];
        const iy = SM() ? 424 : 420, st = SM() ? 21 : 22;
        T(ctx, FIT(ctx, (ch ? ch.name : '') + ' · ' + (S.daily ? '每日裂隙' : (S.dm && S.dm.name ? S.dm.name : '')), 210, 14), 150, iy, 14, '#fff', 'center');
        T(ctx, '第 ' + ((S.floor || 0) + 1) + ' 层 · 用时 ' + G.fmtTime(S.time || 0), 150, iy + st, 14, G.COL.dim, 'center');
        T(ctx, '种子 ' + (S.seed >>> 0), 150, iy + st * 2, 14, G.COL.dim, 'center');
      }
      // 右：遗物 + 协同
      G.gfx.panel(ctx, 290, 40, 640, 456, {});
      const p = S && S.p, ids = (p && p.relicOrder) || [];
      T(ctx, '遗物（' + ids.length + '）', 310, 64, 16, G.COL.gold, 'left', true);
      this.relicRects = [];
      const perPage = 14, maxScroll = Math.max(0, Math.ceil((ids.length - perPage) / 2));
      this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
      if (!ids.length) T(ctx, '还没有获得遗物。打开宝箱、击败精英和首领可以获得遗物。', 610, 180, 14, G.COL.dim, 'center');
      ids.slice(this.scroll * 2, this.scroll * 2 + perPage).forEach((id, k) => {
        const d = (G.RELICS && G.RELICS[id]) || { name: id, desc: '' };
        const x = 302 + (k % 2) * 312, y = 82 + Math.floor(k / 2) * 40;
        K().relicIcon(ctx, id, x + 18, y + 18, 26);
        const c = p.relics ? p.relics[id] || 1 : 1;
        T(ctx, FIT(ctx, d.name + (c > 1 ? ' ×' + c : ''), 250, 15, true), x + 40, y + 9, 15, G.rarityColor(d.rarity), 'left', true);
        T(ctx, FIT(ctx, d.desc || '', 262, 14), x + 40, y + 28, 14, '#c0cbdc', 'left');
        this.relicRects.push({ x, y, w: 308, h: 38, id });
      });
      if (maxScroll > 0) T(ctx, '滚轮查看更多（' + (this.scroll + 1) + '/' + (maxScroll + 1) + '）', 914, 64, 14, G.COL.dim, 'right');
      // 协同
      ctx.fillStyle = G.COL.edge; ctx.fillRect(306, 368, 608, 2);
      T(ctx, '协同进度', 310, 386, 16, G.COL.gold, 'left', true);
      synergyList(S).slice(0, 6).forEach((f, i) => {
        const x = 310 + (i % 3) * 206, y = 410 + Math.floor(i / 3) * 42;
        const top = f.tiers && f.tiers.length ? f.tiers[f.tiers.length - 1].n : 3;
        const act = (f.tiers || []).filter(t => t.active).pop();
        const next = (f.tiers || []).find(t => !t.active);
        const col = f.have > 0 ? K().familyColor(f.family) : G.COL.dim;
        K().icon(ctx, 'icon_family_' + f.family, x + 8, y, 18, function (c2, cx, cy) { G.gfx.circle(c2, cx, cy, 6, col); });
        T(ctx, (f.name || K().familyName(f.family)) + ' ' + Math.min(f.have || 0, top) + '/' + top, x + 22, y, 15, col, 'left', true);
        const ds = act ? '已激活：' + act.desc : next ? next.n + ' 件：' + next.desc : '';
        T(ctx, FIT(ctx, ds, 196, 14), x + 4, y + 20, 14, act ? '#fff' : G.COL.dim, 'left');
      });
      footer(ctx, 'Esc 继续 · ↑↓ 选择 · 回车 确认 · 悬停遗物查看详情');
      // 悬停详情
      const m = G.mouse;
      if (m) for (const r of this.relicRects) if (inR(m.x, m.y, r)) {
        const d = G.RELICS && G.RELICS[r.id]; if (!d) break;
        K().tooltip(ctx, m.x, m.y, d.name, G.rarityColor(d.rarity), [{ text: d.desc || '' }, { text: G.rarityName(d.rarity) + (d.family ? ' · ' + K().familyName(d.family) + '系' : ''), color: G.COL.dim }]);
        break;
      }
    },
    key(code, ev) {
      if (this.sub) return screens[this.sub].key(code, ev);
      if (listNav(this, code, PAUSE_MENU.length)) { this.confirm = null; return true; }
      if (isOk(code)) { this.act(this.sel); return true; }
      if (code === 'Escape' || code === 'KeyP') { this.act(0); return true; }
      if (code === 'PageDown') { this.scroll++; return true; }
      if (code === 'PageUp') { this.scroll = Math.max(0, this.scroll - 1); return true; }
      if (code === 'KeyH' || code === 'F1') { this.act(2); return true; }
      return true; // 暂停中吞掉其他按键
    },
    click(x, y) {
      if (this.sub) return screens[this.sub].click(x, y);
      const i = hitIndex(this.btns, x, y);
      if (i >= 0) { if (this.sel !== i) this.confirm = null; this.sel = i; this.act(i); }
      return true;
    },
    move(x, y) { if (this.sub) { screens[this.sub].move(x, y); return; } const i = hitIndex(this.btns, x, y); if (i >= 0 && i !== this.sel) { this.sel = i; this.confirm = null; } },
    wheel(dy) { if (this.sub) { screens[this.sub].wheel(dy); return; } this.scroll = Math.max(0, this.scroll + (dy > 0 ? 1 : -1)); }
  };

  // =====================================================================
  // 地图覆盖层
  // =====================================================================
  screens.map = {
    enter() { this.t0 = now(); },
    close() { G.mapOpen = false; },
    render(ctx) {
      const S = G.S; if (!S) return;
      dimBg(ctx, 0.7);
      G.gfx.panel(ctx, 110, 40, 740, 460, {});
      const fd = S.fdef || {};
      T(ctx, '第 ' + ((S.floor || 0) + 1) + ' 层 · ' + (fd.name || '') + ' 地图', 130, 66, 18, '#fff', 'left', true);
      const rooms = (S.rooms || []).filter(r => r.seen || r.visited || r === S.room);
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      (S.rooms || []).forEach(r => { minx = Math.min(minx, r.gx); maxx = Math.max(maxx, r.gx); miny = Math.min(miny, r.gy); maxy = Math.max(maxy, r.gy); });
      if (rooms.length) {
        const cw = maxx - minx + 1, chh = maxy - miny + 1;
        const cell = Math.max(16, Math.min(56, Math.floor(500 / cw), Math.floor(380 / chh)));
        const ox = 130 + 250 - cw * cell / 2, oy = 90 + 200 - chh * cell / 2;
        K().drawMap(ctx, S, rooms, ox, oy, cell, minx, miny);
      }
      // 图例
      const lx = 660;
      G.gfx.panel(ctx, lx - 14, 84, 194, 340, { shadow: false, fill: 'rgba(38,43,68,0.6)' });
      T(ctx, '图例', lx, 104, 15, G.COL.gold, 'left', true);
      const leg = [['#ffffff', '当前位置'], ['#8b9bb4', '已清理'], ['#5a6988', '已进入'], ['#3a4466', '已发现']];
      leg.forEach((l, i) => {
        const y = 134 + i * 30;
        ctx.fillStyle = l[0]; ctx.fillRect(lx, y - 8, 16, 16);
        if (i === 0) { ctx.strokeStyle = G.COL.gold; ctx.lineWidth = 2; ctx.strokeRect(lx - 1, y - 9, 18, 18); }
        T(ctx, l[1], lx + 28, y, 14, '#fff', 'left');
      });
      const ics = [['boss', '首领'], ['treasure', '宝箱'], ['shop', '商店'], ['altar', '祭坛'], ['elite', '精英']];
      ics.forEach((l, i) => {
        const y = 134 + (i + 4) * 30;
        K().icon(ctx, K().roomIcon[l[0]], lx + 8, y, 18, function (c2, cx, cy) { c2.fillStyle = K().roomIconColor[l[0]]; c2.fillRect(cx - 5, cy - 5, 10, 10); });
        T(ctx, l[1], lx + 28, y, 14, '#fff', 'left');
      });
      const vis = (S.rooms || []).filter(r => r.visited).length;
      T(ctx, '已探索 ' + vis + ' / ' + (S.rooms || []).length + ' 个房间', lx, 444, 14, G.COL.dim, 'left');
      footer(ctx, 'Tab / Esc 关闭地图 · 地图打开时游戏暂停');
    },
    key(code) {
      if (code === 'Tab' || isBack(code) || code === 'KeyM' && false) { this.close(); return true; }
      return false; // 其他按键交给 main.js（地图打开时主循环暂停，见 G.tick）
    },
    click() { this.close(); return true; },
    move() {}, wheel() {}
  };

  // =====================================================================
  // 遗物三选一
  // =====================================================================
  const LOCK_CHOICE = 0.6, LOCK_END = 0.8;
  function optInfo(id) {
    if (G.RELICS && G.RELICS[id]) { const d = G.RELICS[id]; return { kind: 'relic', name: d.name, desc: d.desc, rarity: d.rarity, family: d.family }; }
    if (G.WEAPONS && G.WEAPONS[id]) { const d = G.WEAPONS[id]; return { kind: 'weapon', name: d.name, desc: d.desc, rarity: d.rarity, family: null }; }
    return { kind: 'relic', name: String(id), desc: '', rarity: 1, family: null };
  }
  screens.relicchoice = {
    sel: 0, cards: [],
    enter() { this.sel = 0; this.t0 = now(); this.age = 0; },
    locked() { return (this.age || 0) < LOCK_CHOICE; },
    pick(i) {
      const S = G.S; if (!S || !S.choice || this.locked()) return;
      const n = (S.choice.opts || []).length; if (i < 0 || i >= n) return;
      sfx('ui');
      if (G.chooseOption) G.chooseOption(S, i);
    },
    render(ctx) {
      const S = G.S; if (!S || !S.choice) return;
      dimBg(ctx, 0.78);
      const opts = S.choice.opts || [];
      T(ctx, '选择一件遗物', 480, 56, 28, '#fff', 'center', true, { shadow: true });
      T(ctx, '来自：' + (S.choice.src || '宝箱'), 480, 88, 14, G.COL.dim, 'center');
      const lockA = Math.min(1, (this.age || 0) / LOCK_CHOICE);
      const n = opts.length, w = 240, gap = 16, x0 = 480 - (n * w + (n - 1) * gap) / 2;
      const syn = synergyList(S);
      this.cards = [];
      opts.forEach((id, i) => {
        const o = optInfo(id), x = x0 + i * (w + gap), y = 108 + Math.round((1 - lockA) * 20), h = 330;
        const sel = i === this.sel, col = G.rarityColor(o.rarity);
        this.cards.push({ x, y, w, h, i });
        ctx.save(); ctx.globalAlpha = 0.4 + 0.6 * lockA;
        G.gfx.panel(ctx, x, y, w, h, { sel, edge: col, fill: sel ? 'rgba(38,43,68,0.98)' : 'rgba(24,20,37,0.96)' });
        G.gfx.keycap(ctx, String(i + 1), x + 12, y + 22, F(14));
        if (o.kind === 'weapon') K().weaponIcon(ctx, id, x + w / 2, y + 72, 72);
        else K().relicIcon(ctx, id, x + w / 2, y + 72, 64);
        T(ctx, FIT(ctx, o.name, w - 24, 20, true), x + w / 2, y + 134, 20, col, 'center', true, { shadow: true });
        T(ctx, G.rarityName(o.rarity) + (o.kind === 'weapon' ? ' · 武器' : o.family ? ' · ' + K().familyName(o.family) + '系' : ''), x + w / 2, y + 160, 14, G.COL.dim, 'center');
        W(ctx, o.desc || '', x + 16, y + 190, w - 32, 14, '#fff', 'left', { maxLines: SM() ? 4 : 5, lineH: 20 });
        if (o.family) {
          const f = syn.find(s => s.family === o.family);
          if (f) {
            const top = f.tiers && f.tiers.length ? f.tiers[f.tiers.length - 1].n : 3;
            const after = Math.min(top, (f.have || 0) + 1);
            const tier = (f.tiers || []).find(t => t.n === after);
            ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + 8, y + h - 52, w - 16, 44);
            T(ctx, K().familyName(o.family) + '协同 ' + Math.min(f.have || 0, top) + '/' + top + ' → ' + after + '/' + top, x + 16, y + h - 40, 14, K().familyColor(o.family), 'left', true);
            T(ctx, FIT(ctx, tier ? '触发：' + tier.desc : '继续收集同系遗物', w - 32, 14), x + 16, y + h - 19, 14, tier ? '#fff' : G.COL.dim, 'left');
          }
        }
        ctx.restore();
      });
      footer(ctx, '1 / 2 / 3 或 ←→ + 回车 选择 · 也可以直接点击卡片');
    },
    key(code) {
      const S = G.S, n = S && S.choice ? (S.choice.opts || []).length : 0;
      if (!n) return false;
      if (isLeft(code)) { this.sel = (this.sel + n - 1) % n; sfx('ui'); return true; }
      if (isRight(code)) { this.sel = (this.sel + 1) % n; sfx('ui'); return true; }
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (m) { const i = +m[1] - 1; if (i < n) { this.sel = i; this.pick(i); } return true; }
      if (code === 'Enter' || code === 'NumpadEnter') { this.pick(this.sel); return true; }
      return true; // 三选一期间吞掉其他按键
    },
    click(x, y) { const i = hitIndex(this.cards, x, y); if (i >= 0) { this.sel = i; this.pick(i); } return true; },
    move(x, y) { const i = hitIndex(this.cards, x, y); if (i >= 0) this.sel = i; },
    wheel() {}
  };

  // =====================================================================
  // 结算（dead / victory）
  // =====================================================================
  function win2tip(s) {
    if (s.win) return '想要更大的挑战？试试更高难度，或者去挑战每日裂隙。';
    return '在魂晶商店解锁强化与新角色，下一次走得更远。';
  }
  screens.end = {
    btns: [], sel: 0, relicRects: [],
    enter() { this.t0 = now(); this.sel = 0; this.age = 0; },
    locked() { return (this.age || 0) < LOCK_END; },
    act(id) {
      if (this.locked()) return;
      sfx('ui');
      if (id === 'restart') { if (G.restartRun) G.restartRun(); }
      else if (id === 'meta') go('meta');
      else if (G.toTitle) G.toTitle(); else go('title');
    },
    summary() {
      const S = G.S || {};
      const s = S.summary || {};
      const p = S.p || {};
      return {
        win: s.win !== undefined ? s.win : S.state === 'victory', floor: s.floor || (S.floor || 0) + 1, kills: s.kills !== undefined ? s.kills : (S.stats ? S.stats.kills : 0),
        elites: s.elites !== undefined ? s.elites : (S.stats ? S.stats.elites : 0), bossKills: s.bossKills !== undefined ? s.bossKills : (S.stats ? S.stats.bossKills : 0),
        time: s.time !== undefined ? s.time : S.time || 0, seed: s.seed !== undefined ? s.seed : S.seed, cid: s.cid || p.cid, diff: s.diff || S.diff,
        cause: s.cause || (S.stats && S.stats.cause) || '', relics: s.relics || p.relicOrder || [], weapons: s.weapons || (p.weapons || []).filter(Boolean),
        reward: s.reward || null, daily: s.daily || S.daily || null, raw: s
      };
    },
    // 结算提示行（最多 3 行）：S1 未计入 / 评审 8 首胜与每日最佳 / 解锁提示
    notes(s, rw) {
      const out = [];
      if (rw.skipped) out.push({ text: '本局过短，未计入纪录与魂晶', color: G.COL.hp, bold: true });
      if (rw.firstWin === 'hard') out.push({ text: '首次通关困难！你已是真正的裂隙猎人。', color: G.COL.gold, bold: true });
      else if (rw.firstWin === 'normal' || rw.firstWin === 'casual') out.push({ text: '首次通关！试试困难难度——为熟练猎人准备。', color: G.COL.gold, bold: true });
      if (s.daily) {
        const best = !!(rw.daily && rw.daily.best);
        out.push({ text: '每日裂隙 ' + fmtKey(rw.daily && rw.daily.key || s.daily) + (best ? ' · 今日最佳！' : ' · 未超过今日最佳'), color: best ? G.COL.gold : '#c0cbdc', bold: best });
      }
      // unlockHint 与 goalLine 含义重叠：只在本局让新项目变得买得起时额外提示
      const gl = rw.goalLine || metaCall('goalLine', '');
      if (rw.unlockHint && (!Array.isArray(rw.unlocks) || rw.unlocks.length) && rw.unlockHint !== gl && !rw.skipped) out.push({ text: rw.unlockHint, color: G.COL.crystalHi, bold: false });
      if (!out.length) out.push({ text: s.raw && s.raw.abandoned ? '你放弃了这次冒险，按进度结算魂晶。' : win2tip(s), color: '#c0cbdc', bold: false });
      return out;
    },
    render(ctx) {
      const S = G.S; if (!S) return;
      const s = this.summary(), win = !!s.win;
      dimBg(ctx, 0.86);
      const rw = s.reward || { crystals: G.Meta ? G.Meta.crystalsFor(s) : 0, newBest: false, unlockHint: '' };
      const ab = !win && !!(s.raw && s.raw.abandoned);
      T(ctx, win ? '裂隙已封印' : ab ? '冒险中止' : '你倒下了', 480, 46, 36, win ? G.COL.gold : ab ? '#c0cbdc' : G.COL.hp, 'center', true, { shadow: true });
      const fl = G.FLOORS && G.FLOORS[Math.max(0, s.floor - 1)];
      const where = '第 ' + s.floor + ' 层' + (fl ? '「' + fl.name + '」' : '');
      const sub = win ? '你击败了深渊的主宰，裂隙重归平静。' : ab ? '你在' + where + '放弃了这次冒险。' : '倒在' + where + (s.cause ? '，击倒你的是 ' + s.cause : '');
      T(ctx, sub, 480, 86, 15, '#fff', 'center');
      // 左：数据
      G.gfx.panel(ctx, 40, 110, 290, 312, {});
      T(ctx, '本局数据', 58, 132, 16, G.COL.gold, 'left', true);
      const rows = [['角色', CNAME(s.cid)], ['难度', DNAME(s.diff)], ['到达层数', '第 ' + s.floor + ' 层'], ['击杀', String(s.kills)], ['精英', String(s.elites || 0)],
        ['首领', String(s.bossKills || 0)], ['用时', G.fmtTime(s.time)], ['种子', String(s.seed >>> 0)]];
      rows.forEach((r, i) => {
        const y = 164 + i * 31;
        T(ctx, r[0], 58, y, 14, G.COL.dim, 'left');
        T(ctx, r[1], 312, y, 15, '#fff', 'right', true);
      });
      // 右：构筑
      G.gfx.panel(ctx, 346, 110, 574, 222, {});
      T(ctx, '本局构筑', 364, 132, 16, G.COL.gold, 'left', true);
      (s.weapons || []).slice(0, 2).forEach((wid, i) => {
        const wd = G.WEAPONS && G.WEAPONS[wid], x = 364 + i * 270;
        K().weaponIcon(ctx, wid, x + 26, 172, 46);
        T(ctx, FIT(ctx, wd ? wd.name : wid, 200, 15, true), x + 58, 172, 15, wd ? G.rarityColor(wd.rarity) : '#fff', 'left', true);
      });
      const rl = s.relics || [];
      T(ctx, '遗物 ' + rl.length + ' 件', 364, 212, 14, G.COL.dim, 'left');
      this.relicRects = [];
      const per = 14, maxShow = per * 2;
      rl.slice(0, rl.length > maxShow ? maxShow - 1 : maxShow).forEach((id, i) => {
        const cx = 382 + (i % per) * 38, cy = 248 + Math.floor(i / per) * 40;
        K().relicIcon(ctx, id, cx, cy, 30);
        this.relicRects.push({ x: cx - 19, y: cy - 19, w: 38, h: 38, id });
      });
      if (rl.length > maxShow) T(ctx, '+' + (rl.length - maxShow + 1), 382 + (per - 1) * 38, 288, 14, G.COL.dim, 'center', true);
      if (!rl.length) T(ctx, '这一局没有获得遗物。', 364, 248, 14, G.COL.dim, 'left');
      // 本局提示：未计入 / 首胜 / 每日最佳 / 解锁提示
      G.gfx.panel(ctx, 346, 342, 574, 80, { edge: rw.skipped ? G.COL.hp : rw.firstWin || (rw.daily && rw.daily.best) ? G.COL.gold : G.COL.edge });
      const notes = this.notes(s, rw);
      const nn = Math.min(3, notes.length), nst = nn === 3 ? (SM() ? 22 : 21) : 26, ny0 = 382 - (nn - 1) * nst / 2;
      notes.slice(0, nn).forEach((n, i) => T(ctx, FIT(ctx, n.text, 540, 15, n.bold), 364, Math.round(ny0 + i * nst), 15, n.color, 'left', n.bold));
      // 下：奖励 + 按钮
      G.gfx.panel(ctx, 40, 436, 470, 68, { edge: G.COL.crystal });
      K().icon(ctx, 'ui_crystal', 64, 458, 22, K().crystalFb);
      T(ctx, '+' + (rw.crystals || 0) + ' 魂晶', 82, 459, 20, G.COL.crystalHi, 'left', true);
      if (rw.newBest) T(ctx, '新纪录！', 494, 459, 16, G.COL.gold, 'right', true);
      else T(ctx, '当前 ' + (md().crystals || 0), 494, 459, 14, G.COL.dim, 'right');
      // 评审 4：下一个目标
      const gl = rw.goalLine || metaCall('goalLine', '') || ('当前魂晶 ' + (md().crystals || 0));
      T(ctx, FIT(ctx, gl, 440, 14), 58, 487, 14, '#c0cbdc', 'left');
      const lk = this.locked();
      this.btns = [{ id: 'restart', label: s.daily ? '再次挑战' : '再来一局', x: 530, y: 444, w: 124, h: 48 }, { id: 'meta', label: '魂晶商店', x: 663, y: 444, w: 124, h: 48 }, { id: 'title', label: '返回标题', x: 796, y: 444, w: 124, h: 48 }];
      ctx.save(); if (lk) ctx.globalAlpha = 0.45;
      this.btns.forEach((b, i) => button(ctx, b, i === this.sel, { size: 17, color: i === 0 ? G.COL.gold : undefined }));
      ctx.restore();
      footer(ctx, 'R / 回车 ' + (s.daily ? '再次挑战今日裂隙' : '再来一局') + ' · S 魂晶商店 · Esc 返回标题');
      const m = G.mouse;
      if (m) for (const r of this.relicRects) if (inR(m.x, m.y, r)) {
        const d = G.RELICS && G.RELICS[r.id]; if (!d) break;
        K().tooltip(ctx, m.x, m.y, d.name, G.rarityColor(d.rarity), [{ text: d.desc || '' }]);
        break;
      }
    },
    key(code) {
      if (isLeft(code)) { this.sel = (this.sel + 2) % 3; return true; }
      if (isRight(code)) { this.sel = (this.sel + 1) % 3; return true; }
      if (code === 'KeyR') { this.act('restart'); return true; }
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') { this.act(this.btns[this.sel] ? this.btns[this.sel].id : 'restart'); return true; }
      if (code === 'KeyS') { this.act('meta'); return true; }
      if (code === 'Escape') { this.act('title'); return true; }
      return true;
    },
    click(x, y) { const i = hitIndex(this.btns, x, y); if (i >= 0) { this.sel = i; this.act(this.btns[i].id); } return true; },
    move(x, y) { const i = hitIndex(this.btns, x, y); if (i >= 0) this.sel = i; },
    wheel() {}
  };
  screens.dead = screens.end;
  screens.victory = screens.end;
})(window.Game = window.Game || {});
