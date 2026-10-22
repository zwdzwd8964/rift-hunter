// 触屏层（iPhone / iPad）：把触摸变成一个虚拟手柄。游戏本身原生支持 Gamepad API（main.js 的 pollPad/padInput），
// 所以这里只需要让 navigator.getGamepads() 多返回一个“触屏手柄”，游戏逻辑一行都不用改。
// 菜单和弹窗不需要任何处理：iOS 会把点按转换成鼠标点击，游戏的每个界面本来就支持鼠标。
(function () {
  'use strict';
  const touchDevice = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  if (!touchDevice) return;   // 电脑上什么都不变

  // 手机的 3 倍屏渲染开销大，像素风画面 2 倍已经足够清晰
  try {
    const real = window.devicePixelRatio || 1;
    Object.defineProperty(window, 'devicePixelRatio', { get: () => Math.min(2, real), configurable: true });
  } catch (e) { /* 改不了就保持原样 */ }

  // ---------- 虚拟手柄（标准布局）----------
  // 轴：0/1 左摇杆（移动），2/3 右摇杆（瞄准并射击）。按钮：0 A 翻滚，1 B 技能/返回，2 X 交互，3 Y 换枪，
  // 4 LB 主动道具，7 RT 射击，8 Back 地图，9 Start 暂停。
  const pad = {
    id: 'touch-controls', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  const holdUntil = new Array(17).fill(0);   // 很快的点按也至少保持 3 帧，保证游戏的逐帧检测能看到
  const fingers = new Map();                 // 每根手指 → 它按住的按钮编号
  function press(i, down) {
    const b = pad.buttons[i];
    if (down) { b.pressed = true; b.value = 1; holdUntil[i] = performance.now() + 60; }
    else if (performance.now() >= holdUntil[i]) { b.pressed = false; b.value = 0; }
    else setTimeout(() => press(i, false), holdUntil[i] - performance.now() + 1);
  }
  const realGetPads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
  try {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        let real = [];
        try { real = Array.from(realGetPads() || []).filter(Boolean); } catch (e) { /* 忽略 */ }
        pad.timestamp = performance.now();
        return [pad].concat(real);
      },
    });
  } catch (e) { /* 无法注入时触屏控制不可用，菜单仍可点按 */ }

  // ---------- 界面 ----------
  const css = `
    #tc { position: fixed; inset: 0; z-index: 10; pointer-events: none; font: 600 13px/1 "PingFang SC", "Microsoft YaHei", sans-serif;
          -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: none; }
    #tc .zone { position: absolute; pointer-events: none; }
    #tc.play .zone, #tc.play .btn.game, #tc.menu .btn.menu { pointer-events: auto; }
    #tc .btn { position: absolute; display: none; align-items: center; justify-content: center; border-radius: 50%;
               color: #f4f4f4; background: rgba(38, 43, 68, 0.55); border: 2px solid rgba(255, 255, 255, 0.28);
               box-sizing: border-box; text-shadow: 0 1px 2px #000; }
    #tc.play .btn.game, #tc.menu .btn.menu { display: flex; }
    #tc.title .btn.menu { display: none; }
    #tc .btn.on { background: rgba(181, 80, 136, 0.75); border-color: #fee761; }
    #tc .btn.small { border-radius: 10px; width: 54px; height: 34px; font-size: 12px; }
    #tc .stick { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
                 border: 2px solid rgba(255, 255, 255, 0.22); background: rgba(24, 20, 37, 0.25); display: none; }
    #tc .knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%;
                background: rgba(244, 244, 244, 0.35); border: 2px solid rgba(255, 255, 255, 0.5); }
    #tc.play .stick { display: block; }
    #tc .stick.idle { opacity: 0.45; }
    #tc .hint { position: absolute; display: none; font-size: 11px; line-height: 1.4; color: rgba(255, 255, 255, 0.55);
                text-align: center; width: 120px; margin-left: -60px; }
    #tc.play .hint:not(.used) { display: block; }
    #tc-rotate { position: fixed; inset: 0; z-index: 20; display: none; flex-direction: column; gap: 14px; align-items: center;
                 justify-content: center; background: #0b0912; color: #f4f4f4; font: 600 18px/1.5 "PingFang SC", sans-serif; text-align: center; }
    #tc-rotate .phone { width: 46px; height: 78px; border: 3px solid #f4f4f4; border-radius: 9px; animation: tcturn 2s ease-in-out infinite; }
    @keyframes tcturn { 0%, 30% { transform: rotate(0); } 60%, 100% { transform: rotate(-90deg); } }
    @media (orientation: portrait) { #tc-rotate { display: flex; } }
    #tc-install { position: fixed; z-index: 15; left: 50%; transform: translateX(-50%); top: calc(8px + env(safe-area-inset-top, 0px));
                  display: none; gap: 10px; align-items: center; padding: 8px 12px; border-radius: 10px; max-width: 90vw;
                  background: rgba(24, 20, 37, 0.92); border: 1px solid #b55088; color: #f4f4f4; font: 13px/1.4 "PingFang SC", sans-serif; }
    #tc-install button { all: unset; padding: 4px 8px; border: 1px solid rgba(255,255,255,.4); border-radius: 6px; font-size: 12px; }
  `;
  const L = 'calc(14px + env(safe-area-inset-left, 0px))', R = 'env(safe-area-inset-right, 0px)';
  const B = 'env(safe-area-inset-bottom, 0px)', T = 'calc(8px + env(safe-area-inset-top, 0px))';
  // 尽量放在 16:9 画面两侧的黑边里，避开左上角的血量和右上角的武器栏、小地图
  const BUTTONS = [
    // [按钮编号, 文字, 显示场合, 样式]
    [0, '翻滚', 'game', `width:70px;height:70px;right:calc(206px + ${R});bottom:calc(22px + ${B});font-size:15px`],
    [1, '技能', 'game', `width:60px;height:60px;right:calc(196px + ${R});bottom:calc(112px + ${B})`],
    [2, '交互', 'game', `width:52px;height:52px;right:calc(10px + ${R});top:calc(126px + ${T})`],
    [4, '道具', 'game', `width:52px;height:52px;right:calc(10px + ${R});top:${T}`],
    [3, '换枪', 'game', `width:52px;height:52px;right:calc(10px + ${R});top:calc(64px + ${T})`],
    [9, '暂停', 'game small', `left:${L};top:${T}`],
    [8, '地图', 'game small', `left:${L};top:calc(46px + ${T})`],
    [1, '返回', 'menu small', `left:${L};top:${T}`],
  ];
  const root = document.createElement('div');
  root.id = 'tc';
  root.innerHTML =
    `<div class="zone" id="tc-left" style="left:0;top:96px;bottom:0;width:42%"></div>` +
    `<div class="zone" id="tc-right" style="right:0;bottom:0;width:240px;height:200px"></div>` +
    `<div class="stick idle" id="tc-ls"><div class="knob"></div></div>` +
    `<div class="stick idle" id="tc-rs"><div class="knob"></div></div>` +
    `<div class="hint" id="tc-rhint">按住自动瞄准<br>拖动手动瞄准</div>` +
    BUTTONS.map(([i, label, kind, style]) => `<div class="btn ${kind}" data-b="${i}" style="${style}">${label}</div>`).join('');
  const rotate = document.createElement('div');
  rotate.id = 'tc-rotate';
  rotate.innerHTML = '<div class="phone"></div><div>请把手机横过来玩</div>';
  const install = document.createElement('div');
  install.id = 'tc-install';
  install.innerHTML = '<span>想离线玩：点 Safari 的「分享」→「添加到主屏幕」</span><button type="button">知道了</button>';

  const RS_HOME = { right: 110, bottom: 104 };   // 右摇杆的固定位置（相对右下角，单位 CSS 像素）
  const R_MAX = 52;                               // 摇杆最大位移

  function start() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.append(root, rotate, install);
    const $ = (id) => document.getElementById(id);
    const ls = $('tc-ls'), rs = $('tc-rs'), rhint = $('tc-rhint');
    const left = { id: null, ox: 0, oy: 0, el: ls };
    const right = { id: null, ox: 0, oy: 0, el: rs, dragged: false };

    // 刘海和底部横条的安全区：env() 只能在 CSS 里解析，所以用一个隐藏元素量出像素值
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) ' +
      'env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
    const inset = (side) => parseFloat(getComputedStyle(probe)['padding' + side]) || 0;
    function homeLeft() {
      ls.style.left = (110 + inset('Left')) + 'px';
      ls.style.top = (window.innerHeight - 104 - inset('Bottom')) + 'px';
    }
    function homeRight() {
      right.ox = window.innerWidth - RS_HOME.right - inset('Right');
      right.oy = window.innerHeight - RS_HOME.bottom - inset('Bottom');
      rs.style.left = right.ox + 'px'; rs.style.top = right.oy + 'px';
      rhint.style.left = right.ox + 'px'; rhint.style.top = (right.oy - 92) + 'px';
    }
    homeLeft(); homeRight();
    window.addEventListener('resize', () => { homeLeft(); homeRight(); });

    function knob(st, dx, dy) {
      const l = Math.hypot(dx, dy), k = l > R_MAX ? R_MAX / l : 1;
      st.el.firstChild.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      return { x: (dx * k) / R_MAX, y: (dy * k) / R_MAX, len: Math.min(1, l / R_MAX) };
    }
    function release(st, ax) {
      st.id = null; st.el.classList.add('idle'); st.el.firstChild.style.transform = '';
      pad.axes[ax] = 0; pad.axes[ax + 1] = 0;
    }
    const unlockAudio = () => { const G = window.Game; try { if (G && G.Audio && G.Audio.unlock) G.Audio.unlock(); } catch (e) { /* 忽略 */ } };
    document.addEventListener('touchend', unlockAudio, { passive: true });

    // 左摇杆：在左侧区域任意位置按下，摇杆出现在手指下方
    $('tc-left').addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (left.id !== null) break;
        left.id = t.identifier; left.ox = t.clientX; left.oy = t.clientY; left.t0 = performance.now(); left.moved = false;
        ls.style.left = t.clientX + 'px'; ls.style.top = t.clientY + 'px'; ls.classList.remove('idle');
      }
    }, { passive: false });
    // 右摇杆：按住不动 = 自动瞄准最近的敌人并射击；拖动 = 手动瞄准（推出去就会射击）
    $('tc-right').addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (right.id !== null) break;
        right.id = t.identifier; right.dragged = false; rs.classList.remove('idle'); rhint.classList.add('used');
        const v = knob(right, t.clientX - right.ox, t.clientY - right.oy);
        if (v.len > 0.5) { right.dragged = true; pad.axes[2] = v.x; pad.axes[3] = v.y; }
      }
    }, { passive: false });
    root.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === left.id) {
          const v = knob(left, t.clientX - left.ox, t.clientY - left.oy);
          pad.axes[0] = v.x; pad.axes[1] = v.y;
          if (v.len > 0.2) left.moved = true;
        } else if (t.identifier === right.id) {
          const v = knob(right, t.clientX - right.ox, t.clientY - right.oy);
          if (v.len > 0.45) right.dragged = true;
          if (right.dragged) { pad.axes[2] = v.x; pad.axes[3] = v.y; }
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === left.id) {
          // 左侧轻点（没拖动）交给游戏的提示框：首次游玩的操作提示要点一下才关
          const G = window.Game;
          if (!left.moved && performance.now() - left.t0 < 300 && G && G.HUD && G.HUD.click && G.toLogical) {
            try { const m = G.toLogical(t.clientX, t.clientY); G.HUD.click(m.x, m.y); } catch (err) { /* 忽略 */ }
          }
          release(left, 0);
        }
        if (t.identifier === right.id) { release(right, 2); press(7, false); }
        if (fingers.has(t.identifier)) {
          const i = fingers.get(t.identifier); fingers.delete(t.identifier);
          press(i, false); root.querySelectorAll(`.btn[data-b="${i}"]`).forEach((el) => el.classList.remove('on'));
        }
      }
    };
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
    for (const el of root.querySelectorAll('.btn')) {
      el.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        const i = +el.dataset.b;
        for (const t of e.changedTouches) fingers.set(t.identifier, i);
        press(i, true); el.classList.add('on'); unlockAudio();
      }, { passive: false });
    }

    // 自动瞄准：右手按住但没拖动时，把右摇杆指向最近的活着的敌人；附近没有敌人就朝当前方向开火
    function autoAim() {
      const G = window.Game, S = G && G.S;
      if (right.id === null || right.dragged || !S || !S.p) return;
      let best = null, bd = Infinity;
      for (const en of S.enemies || []) {
        if (en.dead || en.spawnT > 0) continue;
        const d = Math.hypot(en.x - S.p.x, en.y - S.p.y);
        if (d < bd) { bd = d; best = en; }
      }
      if (best) {
        const dx = best.x - S.p.x, dy = best.y - S.p.y, l = Math.hypot(dx, dy) || 1;
        pad.axes[2] = dx / l; pad.axes[3] = dy / l; press(7, false);
      } else { pad.axes[2] = 0; pad.axes[3] = 0; press(7, true); }
    }

    // 只在真正操作角色时显示摇杆；暂停、地图、选遗物、结算和所有菜单里显示“返回”键，其余点按直接交给游戏
    let mode = '', showInstall = false;
    function loop() {
      const G = window.Game;
      const playing = !!(G && G.mode === 'game' && G.S && G.S.state === 'play' && !(G.overlayId && G.overlayId()));
      const onTitle = !!(G && G.mode === 'title');
      const next = playing ? 'play' : onTitle ? 'menu title' : 'menu';
      if (next !== mode) {
        mode = next; root.className = next;
        if (!playing) { release(left, 0); release(right, 2); press(7, false); }
        install.style.display = showInstall && onTitle ? 'flex' : 'none';
      }
      if (playing) autoAim();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // 竖屏时暂停游戏
    const portrait = window.matchMedia('(orientation: portrait)');
    const onOrient = () => { const G = window.Game; if (portrait.matches && G && G.openPause) try { G.openPause(); } catch (e) { /* 忽略 */ } };
    if (portrait.addEventListener) portrait.addEventListener('change', onOrient); else if (portrait.addListener) portrait.addListener(onOrient);

    // iOS Safari 里还没装到主屏幕时，提示一次怎么离线玩
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let dismissed = false;
    try { dismissed = localStorage.getItem('rh.installHint') === '1'; } catch (e) { /* 忽略 */ }
    showInstall = ios && !navigator.standalone && !dismissed;   // 只在标题画面显示（见 loop）
    install.querySelector('button').addEventListener('click', () => {
      showInstall = false; install.style.display = 'none';
      try { localStorage.setItem('rh.installHint', '1'); } catch (e) { /* 忽略 */ }
    });

    // 防止双指缩放、双击放大和页面回弹
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
