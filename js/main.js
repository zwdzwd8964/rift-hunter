// 主程序：画布与 DPR、输入（键鼠）、模式路由、主循环、渲染编排、G.scene(id) 场景构造与冻结。表现层。
(function (G) {
  'use strict';
  let cv = null, ctx = null;
  G.view = { scale: 1, offX: 0, offY: 0, dpr: 1, w: G.VW, h: G.VH };
  G.mouse = { x: -1, y: -1, down: false, inside: false };
  G.mode = 'title'; G.paused = false; G.mapOpen = false; G.S = null; G.frozen = false; G._ov = null;
  G.runOpts = { cid: 'ranger', diff: 'normal' };
  const keys = {}, pending = { dodge: 0, skill: 0, interact: 0, swap: 0, active: 0 };
  let aimMode = 'mouse', kbDir = { x: 1, y: 0 };
  const safe = (fn, d) => { try { return fn(); } catch (e) { G.reportError(e); return d; } };
  const screen = (id) => (G.UI && G.UI.screens) ? G.UI.screens[id] : null;
  G.screen = screen;

  // ---------------- 画布 ----------------
  G.setupCanvas = function () {
    cv = document.getElementById('c'); ctx = cv.getContext('2d'); G.ctx = ctx; G.canvas = cv;
    fit(); window.addEventListener('resize', () => { fit(); if (G.frozen && G.params.scene) safe(() => G.renderFrame()); });
  };
  function fit() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.max(1, window.innerWidth || G.VW), h = Math.max(1, window.innerHeight || G.VH);
    cv.width = Math.max(1, Math.floor(w * dpr)); cv.height = Math.max(1, Math.floor(h * dpr));
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    let scale = Math.max(0.05, Math.min(w / G.VW, h / G.VH));
    // 评审 10：像素完美——让 1 个美术像素（G.PX 逻辑像素）正好落在整数个设备像素上。
    // 设置开启时总是吸附（四周留黑边）；关闭时，如果吸附后画面缩小不到 8%，也自动吸附。
    const unit = dpr * (G.PX || 2);
    const snapped = Math.floor(scale * unit + 1e-6) / unit;
    const pp = !!(G.settings && G.settings.pixelPerfect);
    if (snapped >= 0.05 && (pp || snapped >= scale * 0.92)) scale = snapped;
    G.view = { scale, offX: Math.round((w - G.VW * scale) / 2), offY: Math.round((h - G.VH * scale) / 2), dpr, w, h, snapped: scale === snapped };
  }
  G.refit = function () { if (cv) { fit(); if (G.frozen && G.params.scene) safe(() => G.renderFrame()); } return G.view; };
  G._fitFor = function (w, h, dpr, pp) { // 纯函数版本（测试用）：返回 {scale, snapped}
    let scale = Math.max(0.05, Math.min(w / G.VW, h / G.VH));
    const unit = dpr * (G.PX || 2), snapped = Math.floor(scale * unit + 1e-6) / unit;
    if (snapped >= 0.05 && (pp || snapped >= scale * 0.92)) scale = snapped;
    return { scale, snapped: scale === snapped };
  };
  G.toLogical = function (cx, cy) {
    const r = cv.getBoundingClientRect(), v = G.view;
    return { x: (cx - r.left - v.offX) / v.scale, y: (cy - r.top - v.offY) / v.scale };
  };
  G.screenToLogical = G.toLogical;

  // ---------------- 渲染编排 ----------------
  const UL = () => window.UILint || { beginFrame() {}, endFrame() {}, layer() {} };
  G.renderFrame = function () {
    if (!ctx) return;
    const L = UL();
    L.beginFrame();
    let tag = G.mode;
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#0b0912'; ctx.fillRect(0, 0, cv.width, cv.height);
      const v = G.view;
      ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, v.dpr * v.offX, v.dpr * v.offY);
      ctx.imageSmoothingEnabled = false;
      ctx.beginPath(); ctx.rect(0, 0, G.VW, G.VH); ctx.clip();
      ctx.fillStyle = G.COL.bg; ctx.fillRect(0, 0, G.VW, G.VH);
      if (G.mode === 'game' && G.S) tag = drawGame(ctx, G.S);
      else { const sc = screen(G.mode); if (sc && sc.render) sc.render(ctx); else fallbackScreen(ctx, G.mode); }
    } catch (e) { G.reportError(e); }
    ctx.restore();
    L.endFrame(tag);
  };
  function drawGame(ctx, S) {
    const L = UL();
    const sh = (G.FX && G.FX.shake) ? (safe(() => G.FX.shake()) || { x: 0, y: 0 }) : { x: 0, y: 0 };
    ctx.save();
    ctx.translate(G.OX + Math.round(sh.x || 0), G.OY + Math.round(sh.y || 0));
    ctx.beginPath(); ctx.rect(-6, -6, G.RW + 12, G.RH + 12); ctx.clip();
    try {
      if (G.R && G.R.drawWorld) G.R.drawWorld(ctx, S); else fallbackWorld(ctx, S);
      if (G.FX && G.FX.drawWorld) G.FX.drawWorld(ctx, S);
      L.layer('world');
      if (G.FX && G.FX.drawTexts) G.FX.drawTexts(ctx, S);
    } catch (e) { G.reportError(e); }
    L.layer('ui');
    ctx.restore();
    if (G.FX && G.FX.drawScreen) safe(() => G.FX.drawScreen(ctx, S));
    ctx.save();
    if (G.HUD && G.HUD.draw) safe(() => G.HUD.draw(ctx, S)); else fallbackHUD(ctx, S);
    ctx.restore();
    const ov = overlayId(S);
    if (ov) {
      ctx.save();
      const sc = screen(ov); if (sc && sc.render) safe(() => sc.render(ctx)); else fallbackScreen(ctx, ov);
      ctx.restore();
      return ov;
    }
    return S.room && S.room.type === 'boss' ? 'boss' : 'play';
  }
  function overlayId(S) {
    if (!S) return null;
    if (S.state === 'dead' || S.state === 'victory') return 'end';
    if (S.state === 'choice') return 'relicchoice';
    if (G.paused) return 'pause';
    if (G.mapOpen) return 'map';
    return null;
  }
  G.overlayId = () => overlayId(G.S);
  function syncOverlay(arg) {
    const ov = G.mode === 'game' ? overlayId(G.S) : null;
    if (ov !== G._ov) { G._ov = ov; if (ov) { const sc = screen(ov); if (sc && sc.enter) safe(() => sc.enter(arg)); } }
  }
  G.syncOverlay = syncOverlay;

  // ---------------- 模式切换与开局 ----------------
  G.go = function (mode, arg) {
    G.mode = mode; G.paused = false; G.mapOpen = false; G._ov = null;
    const sc = screen(mode); if (sc && sc.enter) safe(() => sc.enter(arg));
  };
  G.startRun = function (cid, diff, seed) {
    cid = G.CHARS[cid] ? cid : G.runOpts.cid; diff = G.DIFFS[diff] ? diff : G.runOpts.diff;
    if (!G.params.autotest && !G.params.scene && G.Meta && G.Meta.isUnlocked && !G.Meta.isUnlocked('char', cid)) return false;
    const sd = (seed !== undefined && seed !== null) ? (seed >>> 0) : (G.params.seed !== null ? G.params.seed : ((Math.random() * 1e9) >>> 0));
    G.runOpts = { cid, diff };
    if (G.Meta && G.Meta.setLast && !G.params.autotest) safe(() => G.Meta.setLast(cid, diff));
    if (G.FX && G.FX.clear) safe(() => G.FX.clear());
    G.S = G.newRun({ cid, seed: sd, diff, god: G.params.god, meta: G.Meta ? G.Meta.data : null });
    G.mode = 'game'; G.paused = false; G.mapOpen = false; G._ov = null; acc = 0;
    for (const k in pending) pending[k] = 0;
    G.mouse.down = false;
    if (G.Audio && G.Audio.music) safe(() => G.Audio.music(G.S.fdef.theme || 'moss'));
    return true;
  };
  // 评审 8：每日裂隙——普通难度 + 当天固定种子（Meta.dailySeed(Meta.todayKey())）
  G.startDaily = function (cid) {
    const key = (G.Meta && G.Meta.todayKey) ? G.Meta.todayKey() : null;
    const seed = (key && G.Meta.dailySeed) ? G.Meta.dailySeed(key) : undefined;
    const ok = G.startRun(cid, 'normal', seed);
    if (ok && G.S && key) { G.S.daily = key; G.runOpts.daily = key; }
    return ok;
  };
  G.restartRun = function () {
    if (G.runOpts.daily) return G.startDaily(G.runOpts.cid);
    return G.startRun(G.runOpts.cid, G.runOpts.diff, G.params.seed !== null ? G.params.seed : undefined);
  };
  G.abandonRun = function () {
    const S = G.S;
    // S1：标记为主动放弃——Meta 按进度结算（无保底）；清理不足 2 个房间时不结算、不写历史
    if (S && S.state !== 'dead' && S.state !== 'victory') { S.abandoned = true; G.finishRun(S, false, '主动放弃'); }
    G.paused = false; G.mapOpen = false;
  };
  G.toTitle = function () {
    if (G.mode === 'game') G.abandonRun();
    if (G.Audio && G.Audio.music) safe(() => G.Audio.music('title'));
    G.go('title');
  };
  G.openPause = function (page) {
    if (G.mode !== 'game' || !G.S || G.S.state !== 'play') return;
    G.paused = true; G.mapOpen = false; G._ov = 'pause';
    const sc = screen('pause'); if (sc && sc.enter) safe(() => sc.enter(page));
  };
  G.toggleMute = function () {
    const v = !G.settings.mute;
    if (G.Meta && G.Meta.setSetting) safe(() => G.Meta.setSetting('mute', v)); else G.settings.mute = v;
    if (G.Audio && G.Audio.applySettings) safe(() => G.Audio.applySettings());
    if (G.S && G.mode === 'game') G.S.toast = { text: v ? '已静音（M 恢复）' : '声音已开启', t: 1.4 };
  };

  // ---------------- 输入 ----------------
  const PREVENT = { Tab: 1, Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, F1: 1, Backspace: 1 };
  function onKeyDown(e) {
    if (G.Audio && G.Audio.unlock) safe(() => G.Audio.unlock());
    const k = e.code || e.key;
    if (PREVENT[k]) e.preventDefault();
    const repeat = !!(e.repeat || keys[k]); keys[k] = true;
    if (G.frozen) return;
    if (k === 'KeyM' && !repeat && !(G.mode === 'settings')) { G.toggleMute(); return; }
    if (G.mode === 'game' && G.S) { gameKey(k, e, repeat); return; }
    if (repeat && !/Arrow/.test(k)) return;
    const sc = screen(G.mode);
    if (sc && sc.key) safe(() => sc.key(k, e)); else fallbackKey(k);
  }
  function gameKey(k, e, repeat) {
    const S = G.S; syncOverlay();
    const ov = overlayId(S);
    if (ov) {
      if (repeat && !/Arrow/.test(k)) return;
      const sc = screen(ov);
      if (sc && sc.key && safe(() => sc.key(k, e))) return;
      if (ov === 'map' && (k === 'Tab' || k === 'Escape' || k === 'KeyP')) G.mapOpen = false;
      else if (ov === 'pause' && (k === 'Escape' || k === 'KeyP')) G.paused = false;
      else if (ov === 'relicchoice' && !sc) { const i = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[k]; if (i !== undefined) G.chooseOption(S, i); }
      else if (ov === 'end' && !sc) { if (k === 'KeyR' || k === 'Enter') G.restartRun(); else if (k === 'Escape') G.toTitle(); }
      return;
    }
    if (repeat) return;
    if (G.HUD && G.HUD.key && safe(() => G.HUD.key(k, e))) return;
    switch (k) {
      case 'Escape': case 'KeyP': G.openPause(); return;
      case 'Tab': G.mapOpen = true; return;
      case 'KeyH': case 'F1': G.openPause('help'); return;
      case 'Space': pending.dodge = 1; return;
      case 'KeyE': pending.interact = 1; return;
      case 'KeyQ': pending.skill = 1; return;
      case 'KeyX': pending.swap = 1; return;
      case 'KeyF': pending.active = 1; return;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': aimMode = 'kb'; return;
    }
  }
  function onKeyUp(e) { keys[e.code || e.key] = false; }
  function clearKeys() { for (const k in keys) keys[k] = false; G.mouse.down = false; }
  function sampleInput() {
    const inp = G.input, S = G.S, p = S.p;
    inp.mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    inp.my = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
    const adx = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0), ady = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
    if (adx || ady) {
      const l = Math.hypot(adx, ady); kbDir = { x: adx / l, y: ady / l }; aimMode = 'kb';
      inp.ax = p.x + kbDir.x * 120; inp.ay = p.y + kbDir.y * 120; inp.fire = 1; inp.assist = G.settings.aimAssist ? 1 : 0;
    } else {
      inp.assist = 0;
      if (aimMode === 'mouse' && G.mouse.x >= 0) { inp.ax = G.mouse.x - G.OX; inp.ay = G.mouse.y - G.OY; }
      else { inp.ax = p.x + Math.cos(p.aim) * 120; inp.ay = p.y + Math.sin(p.aim) * 120; }
      inp.fire = G.mouse.down ? 1 : 0;
    }
    padInput(inp, p);
    for (const k in pending) if (pending[k]) { inp[k] = 1; pending[k] = 0; }
  }
  function onMouseMove(e) {
    const m = G.toLogical(e.clientX, e.clientY); G.mouse.x = m.x; G.mouse.y = m.y; G.mouse.inside = true; aimMode = 'mouse';
    if (G.frozen) return;
    const id = G.mode === 'game' ? overlayId(G.S) : G.mode; const sc = id && screen(id);
    if (sc && sc.move) safe(() => sc.move(m.x, m.y));
  }
  function onMouseDown(e) {
    if (G.Audio && G.Audio.unlock) safe(() => G.Audio.unlock());
    const m = G.toLogical(e.clientX, e.clientY); G.mouse.x = m.x; G.mouse.y = m.y;
    if (G.frozen) return;
    if (G.mode === 'game' && G.S) {
      syncOverlay();
      const ov = overlayId(G.S);
      if (ov) { if (e.button === 0) { const sc = screen(ov); if (sc && sc.click) safe(() => sc.click(m.x, m.y)); } return; }
      if (e.button === 0) { if (G.HUD && G.HUD.click && safe(() => G.HUD.click(m.x, m.y))) return; G.mouse.down = true; aimMode = 'mouse'; }
      else if (e.button === 2) pending.dodge = 1;
      return;
    }
    if (e.button === 0) { const sc = screen(G.mode); if (sc && sc.click) safe(() => sc.click(m.x, m.y)); else fallbackKey('Enter'); }
  }
  function onMouseUp(e) { if (e.button === 0) G.mouse.down = false; }
  function onWheel(e) {
    if (G.frozen) return;
    if (G.mode === 'game' && G.S && !overlayId(G.S)) { e.preventDefault(); pending.swap = 1; return; }
    const id = G.mode === 'game' ? overlayId(G.S) : G.mode; const sc = id && screen(id);
    if (sc && sc.wheel) { e.preventDefault(); safe(() => sc.wheel(e.deltaY)); }
  }
  function autoPause() { clearKeys(); if (G.mode === 'game' && G.S && G.S.state === 'play' && !G.paused && !G.params.autotest && !G.frozen) G.openPause(); }
  function bindInput() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', autoPause);
    document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mouseleave', () => { G.mouse.inside = false; });
    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('wheel', onWheel, { passive: false });
  }

  // ---------------- 手柄（Gamepad API，P1）----------------
  // 标准布局：左摇杆/十字键 移动（菜单中为方向）；右摇杆 瞄准并射击；RT 射击；A 翻滚/确认；B 技能/返回；X 交互；Y 换枪；LB 主动道具；RB 翻滚；Back 地图；Start 暂停
  const GP = { prev: [], navT: 0, navDir: '', pad: null };
  function readPad() {
    try { const ps = navigator.getGamepads ? navigator.getGamepads() : null; if (ps) for (let i = 0; i < ps.length; i++) if (ps[i] && ps[i].connected) return ps[i]; } catch (e) { /* 忽略 */ }
    return null;
  }
  function vkey(code) { onKeyDown({ code, key: code, repeat: false, preventDefault() {} }); keys[code] = false; }
  function pollPad(dt) {
    const gp = readPad(); GP.pad = gp; if (!gp) return;
    const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    const edge = (i) => b(i) && !GP.prev[i];
    if (gp.buttons.some((x, i) => edge(i)) && G.Audio && G.Audio.unlock) safe(() => G.Audio.unlock());
    if (G.mode === 'game' && G.S && !overlayId(G.S)) {
      if (edge(0) || edge(5)) pending.dodge = 1;
      if (edge(1)) pending.skill = 1;
      if (edge(2)) pending.interact = 1;
      if (edge(3)) pending.swap = 1;
      if (edge(4)) pending.active = 1;
      if (edge(9)) G.openPause();
      if (edge(8)) G.mapOpen = true;
    } else {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const dir = (b(12) || ay < -0.6) ? 'ArrowUp' : (b(13) || ay > 0.6) ? 'ArrowDown' : (b(14) || ax < -0.6) ? 'ArrowLeft' : (b(15) || ax > 0.6) ? 'ArrowRight' : '';
      if (dir) { if (dir !== GP.navDir) { vkey(dir); GP.navT = 0.35; } else { GP.navT -= dt; if (GP.navT <= 0) { vkey(dir); GP.navT = 0.12; } } }
      GP.navDir = dir;
      if (edge(0)) vkey('Enter');
      if (edge(1) || edge(9)) vkey('Escape');
      if (edge(8) && G.mapOpen) G.mapOpen = false;
    }
    GP.prev = gp.buttons.map((x, i) => b(i));
  }
  function padInput(inp, p) {
    const gp = GP.pad; if (!gp) return;
    const dz = (v) => Math.abs(v) < 0.22 ? 0 : v;
    const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0), rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    const btn = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    let mx = lx, my = ly;
    if (btn(12)) my = -1; if (btn(13)) my = 1; if (btn(14)) mx = -1; if (btn(15)) mx = 1;
    if (mx || my) { inp.mx = mx; inp.my = my; }
    const rl = Math.hypot(rx, ry);
    if (rl > 0.35) { kbDir = { x: rx / rl, y: ry / rl }; aimMode = 'kb'; inp.ax = p.x + kbDir.x * 120; inp.ay = p.y + kbDir.y * 120; inp.fire = 1; inp.assist = G.settings.aimAssist ? 1 : 0; }
    if (btn(7)) inp.fire = 1;
  }

  // ---------------- 主循环 ----------------
  let acc = 0, last = 0;
  G.tick = function (dt) {
    if (G.UI && G.UI.update) safe(() => G.UI.update(dt));
    if (G.mode !== 'game' || !G.S) return;
    const S = G.S;
    syncOverlay();
    if (!G.paused && !G.mapOpen && S.state === 'play') {
      acc += dt; let n = 0;
      while (acc >= G.DT && n < 6) { sampleInput(); G.step(S, G.input); acc -= G.DT; n++; if (S.state !== 'play') break; }
      if (n >= 6) acc = 0;
    } else acc = 0;
    syncOverlay();
    if (G.FX && G.FX.update) safe(() => G.FX.update(G.paused || G.mapOpen ? 0 : dt));
  };
  function frame(now) {
    if (G.frozen) return;
    const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000)); last = now;
    try { pollPad(dt); G.tick(dt); G.renderFrame(); } catch (e) { G.reportError(e); }
    requestAnimationFrame(frame);
  }

  // ---------------- 场景（?scene=）----------------
  function sceneRun(seed, cid, diff) {
    G.startRun(cid || 'ranger', diff || 'normal', seed);
    G.S.god = true; G.S.banner = null;
    return G.S;
  }
  function stepN(S, n, until, inpFn) {
    const inp = G.input;
    for (let i = 0; i < n; i++) {
      inp.mx = 0; inp.my = 0; inp.fire = 0; inp.assist = 0;
      if (inpFn) inpFn(S, inp, i); else { inp.ax = S.p.x + 80; inp.ay = S.p.y; }
      G.step(S, inp);
      if (G.FX && G.FX.update && i % 4 === 0) safe(() => G.FX.update(4 / 60));
      if (until && until(S)) return true;
    }
    return false;
  }
  function roomOf(S, type, near) {
    let best = null;
    for (const r of S.rooms) if (r.type === type) { if (!best || (near && r.dist < best.dist)) best = r; }
    return best;
  }
  function enterTyped(S, type, near) {
    const r = roomOf(S, type, near); if (!r) throw new Error('no room ' + type);
    const st = S.rooms.find(x => x.type === 'start');
    // 让地图看起来“探索过”：从起点到目标的房间都标记访问
    for (const x of S.rooms) if (x.dist <= r.dist && Math.abs(x.gx - r.gx) + Math.abs(x.gy - r.gy) <= r.dist) { x.seen = true; }
    st.visited = true;
    const d = r.doors.indexOf(1);
    G.enterRoom(S, r, d >= 0 ? (d + 2) % 4 : -1);
    return r;
  }
  // 只走位不开火（让敌人保持存活，便于截到弹幕）；最后几步再开火
  const moveInput = (S, inp, i) => {
    const e = S.enemies.find(o => !o.dead && o.spawnT <= 0);
    inp.mx = Math.sin(i / 40) * 0.8; inp.my = Math.cos(i / 55) * 0.5; inp.fire = 0;
    if (e) { inp.ax = e.x; inp.ay = e.y; } else { inp.ax = S.p.x + 80; inp.ay = S.p.y; }
  };
  const fightInput = (S, inp, i) => {
    const e = S.enemies.find(o => !o.dead && o.spawnT <= 0);
    inp.mx = Math.sin(i / 40); inp.my = Math.cos(i / 55) * 0.6;
    if (e) { inp.ax = e.x; inp.ay = e.y; inp.fire = 1; } else { inp.ax = S.p.x + 80; inp.ay = S.p.y; }
  };
  const eb = (S) => S.bullets.filter(b => b.own === 'e').length;
  const activeFoes = (S) => S.enemies.filter(e => !e.dead && e.spawnT <= 0).length;
  // 截图兜底：若构造结束时敌弹太少，让场上活跃敌人朝玩家补射一组（与正常敌弹同一 API，确定性）
  function ensureBullets(S, n) {
    if (eb(S) >= n) return;
    const foes = S.enemies.filter(e => !e.dead && e.spawnT <= 0);
    const shapes = ['eorb', 'ebig', 'eneedle'], cols = ['#ff0044', '#f77622', '#b55088'];
    foes.slice(0, 3).forEach((e, i) => {
      const a = Math.atan2(S.p.y - e.y, S.p.x - e.x);
      G.fan(S, e.x, e.y, a, 3 + i, 0.5, 120, { src: e, shape: shapes[i % 3], color: cols[i % 3], r: i === 1 ? 9 : 6 });
    });
    for (let i = 0; i < 4; i++) G.step(S, G.input);
  }
  function giveRelics(S, ids) { for (const id of ids) if (G.RELICS && G.RELICS[id]) G.gainRelic(S, id); S.banner = null; }
  function nearItemSpot(S, kind, what) {
    const it = S.room.items.find(o => o.kind === kind && (!what || o.what === what)) || S.room.items.find(o => o.kind === kind);
    if (it) { S.p.x = it.x; S.p.y = it.y + 46; const f = G.placeFree(S.room, S.p.x, S.p.y, S.p.r, 'p'); S.p.x = f.x; S.p.y = f.y; S.p.aim = -Math.PI / 2; }
  }
  G.SCENES = {
    title() { G.go('title'); },
    charselect() { G.go('charselect'); },
    meta() {
      if (G.Meta && G.Meta.data) { const d = G.Meta.data; d.crystals = 268; d.crystalsTotal = 540; d.runs = 6; if (d.upg) { d.upg[Object.keys(d.upg)[0] || 'hp'] = 1; } }
      G.go('meta');
    },
    records() {
      if (G.Meta && G.Meta.data) {
        const d = G.Meta.data; d.runs = 7; d.wins = 1; d.best = Object.assign(d.best || {}, { floor: 3, kills: 214, fastestWin: 1534, bestCrystals: 96 });
        const causes = ['哥布林弓手', '史莱姆之王', '熔岩魔像', '持盾卫兵', '深渊之眼', '爆裂蘑菇'];
        d.history = [];
        for (let i = 0; i < 7; i++) d.history.push({ t: 1760000000000 - i * 3600000, cid: G.CHAR_ORDER[i % 4], diff: G.DIFF_ORDER[(i % 3)], win: i === 2, floor: 1 + (i % 3), kills: 40 + i * 23, time: 420 + i * 133, seed: 1000 + i * 77, cause: i === 2 ? '' : causes[i % causes.length], crystals: 20 + i * 9 });
      }
      G.go('records');
    },
    help() { G.go('help'); },
    settings() { G.go('settings'); },
    play(seed) {
      const S = sceneRun(seed, 'ranger');
      enterTyped(S, 'fight', true);
      stepN(S, 1500, s => s.steps > 150 && activeFoes(s) >= 3 && eb(s) >= 5, moveInput);
      ensureBullets(S, 4);
      stepN(S, 10, null, fightInput);
      S.god = false; S.banner = null;
    },
    relicchoice(seed) {
      const S = sceneRun(seed, 'mage');
      enterTyped(S, 'treasure', true); stepN(S, 30);
      G.openChoice(S, '宝箱', 3, { srcKey: 'chest' });
    },
    shop(seed) {
      const S = sceneRun(seed, 'knight');
      S.p.gold = 64;
      enterTyped(S, 'shop', true); stepN(S, 20);
      nearItemSpot(S, 'shop', 'relic'); stepN(S, 2, null, (s, inp) => { inp.ax = s.p.x; inp.ay = s.p.y - 80; });
    },
    pause(seed) {
      const S = sceneRun(seed, 'ranger');
      giveRelics(S, ['ember_core', 'fire_boots', 'lucky_dice', 'split_shot', 'heart_vessel', 'frost_shard']);
      enterTyped(S, 'fight', true);
      stepN(S, 240, s => s.steps > 120 && activeFoes(s) > 0, moveInput);
      S.banner = null; S.god = false;
      G.openPause();
    },
    map(seed) {
      const S = sceneRun(seed, 'ranger');
      for (const r of S.rooms) { r.seen = true; if (r.dist <= 2) { r.visited = true; if (r.type === 'fight') r.cleared = true; } }
      enterTyped(S, 'fight', true); S.room.locked = false; S.room.cleared = true; S.enemies = [];
      G.mapOpen = true;
    },
    boss1(seed) {
      const S = sceneRun(seed, 'ranger');
      enterTyped(S, 'boss');
      stepN(S, 2400, s => !s.bossIntro && s.boss && s.boss.spawnT <= 0 && (s.boss.tele || s.strikes.length) && eb(s) >= 4 && s.steps > 60, moveInput);
      if (!(S.boss && (S.boss.tele || S.strikes.length))) stepN(S, 900, s => s.boss && (s.boss.tele || s.strikes.length), moveInput);
      stepN(S, 8, null, fightInput);
      S.god = false;
    },
    boss3(seed) {
      const S = sceneRun(seed, 'knight');
      G.nextFloor(S); G.nextFloor(S); S.banner = null;
      giveRelics(S, ['power_potion', 'trigger_spring', 'iron_skin', 'guardian_orb', 'thorn_mail', 'sharp_eye']);
      enterTyped(S, 'boss');
      stepN(S, 400, s => !s.bossIntro && s.boss && s.boss.spawnT <= 0, moveInput);
      const b = S.boss;
      if (b && !b.dead) { b.hp = Math.min(b.hp, b.maxHp * 0.48); }
      stepN(S, 2400, s => s.boss && s.boss.phase >= 2 && (s.boss.tele || s.strikes.length) && s.boss.inv <= 0 && eb(s) >= 6, moveInput);
      if (!(S.boss && S.boss.phase >= 2 && (S.boss.tele || S.strikes.length))) stepN(S, 900, s => s.boss && s.boss.phase >= 2 && (s.boss.tele || s.strikes.length), moveInput);
      stepN(S, 6, null, fightInput);
      S.god = false;
    },
    dead(seed) {
      const S = sceneRun(seed, 'alchemist');
      giveRelics(S, ['venom_gland', 'plague_flask', 'coin_magnet']);
      enterTyped(S, 'fight', true); stepN(S, 600, null, fightInput);
      S.god = false; S.time = Math.max(S.time, 431);
      G.finishRun(S, false, '哥布林弓手');
    },
    victory(seed) {
      const S = sceneRun(seed, 'knight');
      G.nextFloor(S); G.nextFloor(S);
      giveRelics(S, ['power_potion', 'trigger_spring', 'split_shot', 'echo_barrel', 'bullet_storm', 'iron_skin', 'thorn_mail', 'lucky_dice', 'sharp_eye']);
      S.stats.kills = 287; S.stats.bossKills = 3; S.stats.elites = 5; S.time = 1612;
      G.finishRun(S, true, '');
    },
    floor2(seed) {
      const S = sceneRun(seed, 'mage');
      G.nextFloor(S); S.banner = null;
      enterTyped(S, 'fight', true);
      stepN(S, 1500, s => s.steps > 150 && activeFoes(s) >= 3 && eb(s) >= 4, moveInput);
      ensureBullets(S, 3);
      stepN(S, 10, null, fightInput);
      S.god = false;
    }
  };
  G.scene = function (id) {
    const out = document.getElementById('autotest-result');
    const write = (s) => { if (out) out.appendChild(document.createTextNode(' ' + s + ' ')); };
    try {
      const b = G.SCENES[id];
      if (!b) { write('SCENE FAIL ' + id + ' 未知场景'); return false; }
      b(G.params.seed !== null ? G.params.seed : 1);
      syncOverlay();
      if (G.UI && G.UI.update) safe(() => G.UI.update(1));
      G.frozen = true;
      G.renderFrame();
      write('SCENE READY ' + id);
      if (G.params.uilint && window.UILint && window.UILint.flush) window.UILint.flush();
      return true;
    } catch (e) {
      G.reportError(e); write('SCENE FAIL ' + id + ' ' + (e && e.message));
      return false;
    }
  };

  // ---------------- 兜底绘制（对应模块缺失时）----------------
  function fallbackScreen(ctx, id) {
    const g = G.gfx;
    ctx.fillStyle = 'rgba(24,20,37,0.85)'; ctx.fillRect(0, 0, G.VW, G.VH);
    g.txt(ctx, G.TITLE, G.VW / 2, 160, 48, G.COL.gold, 'center', true);
    g.txt(ctx, '界面加载中：' + id, G.VW / 2, 260, 18, G.COL.text, 'center');
    g.txt(ctx, '按回车开始 · R 重开 · Esc 返回', G.VW / 2, 320, 16, G.COL.dim, 'center');
  }
  function fallbackKey(k) {
    if (k === 'Enter' || k === 'Space') G.startRun(G.runOpts.cid, G.runOpts.diff);
  }
  function fallbackWorld(ctx, S) {
    const room = S.room, T = G.T;
    for (let y = 0; y < G.ROWS; y++) for (let x = 0; x < G.COLS; x++) {
      const t = room.tiles[y * G.COLS + x];
      ctx.fillStyle = t === 1 ? '#5a6988' : t === 2 ? '#3a4466' : t === 3 ? (room.locked ? '#733e39' : '#262b44') : ((x + y) % 2 ? '#262b44' : '#2b3150');
      ctx.fillRect(x * T, y * T, T, T);
    }
    for (const pr of room.props) { ctx.fillStyle = pr.kind === 'barrel' ? '#be4a2f' : '#b86f50'; ctx.fillRect(pr.x - 15, pr.y - 15, 30, 30); }
    for (const it of room.items) G.gfx.circle(ctx, it.x, it.y, 7, it.kind === 'coin' ? '#feae34' : '#2ce8f5');
    for (const e of S.enemies) G.gfx.circle(ctx, e.x, e.y, e.r, e.flash > 0 ? '#fff' : '#e43b44');
    G.gfx.circle(ctx, S.p.x, S.p.y, S.p.r, G.CHARS[S.p.cid].color, '#fff');
    for (const b of S.bullets) G.gfx.circle(ctx, b.x, b.y, b.r, b.own === 'e' ? '#ff0044' : '#fee761');
  }
  function fallbackHUD(ctx, S) {
    const p = S.p;
    G.gfx.txt(ctx, '生命 ' + p.hp + '/' + p.maxHp + '  护盾 ' + p.shield + '  金币 ' + p.gold + '  第 ' + (S.floor + 1) + ' 层', 16, 24, 16, '#fff');
  }

  // ---------------- 启动 ----------------
  G.on('runend', (d) => { if (G.Meta && G.Meta.recordRun && d && d.summary && !d.summary.reward) d.summary.reward = safe(() => G.Meta.recordRun(d.summary), null); });
  window.addEventListener('load', () => {
    try {
      G.setupCanvas();
      if (G.Meta && G.Meta.load) safe(() => G.Meta.load());
      if (G.Sprites && G.Sprites.init) safe(() => G.Sprites.init());
      if (G.FX && G.FX.init) safe(() => G.FX.init());
      if (G.Audio && G.Audio.init && !G.params.autotest && !G.params.scene) safe(() => G.Audio.init());
      const m = G.Meta && G.Meta.data;
      safe(() => G.refit()); // 存档里的“像素完美”设置读进来后重新适配画布
      if (m) G.runOpts = { cid: G.CHARS[m.lastChar] ? m.lastChar : 'ranger', diff: G.DIFFS[m.lastDiff] ? m.lastDiff : 'normal' };
      if (G.params.scene) { setTimeout(() => G.scene(G.params.scene), 40); return; }
      if (G.params.autotest) {
        if (G.Autotest && G.Autotest.start) setTimeout(() => safe(() => G.Autotest.start()), 0);
        else { const d = document.getElementById('autotest-result'); if (d) d.textContent = 'AUTOTEST FAIL autotest.js 未加载'; document.title = 'AUTOTEST FAIL'; }
        return;
      }
      bindInput();
      G.go('title');
      requestAnimationFrame(frame);
    } catch (e) { G.reportError(e); }
  });
})(window.Game = window.Game || {});
