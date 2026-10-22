// audio.js — WebAudio 合成音效 + 程序化 BGM（render 助手 a06）
// 加载时不碰 DOM / AudioContext；首个用户手势后 unlock() 才创建/恢复 AudioContext。
// autotest / scene 模式下完全不创建 AudioContext。任何异常都吞掉。
(function (G) {
  'use strict';
  let actx = null, master = null, sfxBus = null, musBus = null, noiseBuf = null;
  let inited = false, dead = false, voices = 0;
  const last = {};
  const MAX_VOICES = 28;

  function disabled() {
    const p = G.params || {};
    return !!(p.autotest || p.scene || dead);
  }
  function S_() { return G.settings || { master: 0.8, sfx: 0.8, music: 0.5, mute: false }; }
  function num(v, d) { v = +v; return isFinite(v) ? Math.max(0, Math.min(1, v)) : d; }

  function create() {
    if (actx || disabled()) return;
    try {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) { dead = true; return; }
      actx = new AC();
      master = actx.createGain(); master.connect(actx.destination);
      // 轻度压缩，防止爆音
      try {
        const comp = actx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
        master.disconnect(); master.connect(comp); comp.connect(actx.destination);
      } catch (e) { /* 无压缩器也能用 */ }
      sfxBus = actx.createGain(); sfxBus.connect(master);
      musBus = actx.createGain(); musBus.connect(master);
      const n = Math.floor(actx.sampleRate * 1.0);
      noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      A.applySettings();
      if (wantMusic) startMusic(wantMusic);
    } catch (e) { actx = null; dead = true; }
  }

  // ---------- 基础合成 ----------
  // 振荡器音：type, f0 -> f1, dur, vol, opts {delay, attack, bus}
  function tone(type, f0, f1, dur, vol, o) {
    o = o || {};
    const t = actx.currentTime + (o.delay || 0);
    const osc = actx.createOscillator(), g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    const at = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.03);
    voices++; osc.onended = function () { voices--; try { g.disconnect(); } catch (e) { /* */ } };
  }
  // 噪声：带通/低通滤波，freq0 -> freq1
  function noise(dur, vol, o) {
    o = o || {};
    const t = actx.currentTime + (o.delay || 0);
    const src = actx.createBufferSource(); src.buffer = noiseBuf;
    src.loop = dur > 0.9;
    const f = actx.createBiquadFilter(); f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 3000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + dur);
    f.Q.value = o.q || 0.8;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (o.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.03);
    voices++; src.onended = function () { voices--; try { g.disconnect(); } catch (e) { /* */ } };
  }
  function arp(notes, step, type, vol, dur) {
    for (let i = 0; i < notes.length; i++) tone(type || 'square', notes[i], notes[i], dur || step * 1.6, vol, { delay: i * step });
  }
  const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- 音效配方 ----------
  // gap = 同名节流间隔（秒）
  const R = {
    shoot_gun: { gap: 0.045, f() { tone('square', 820 + Math.random() * 120, 220, 0.07, 0.07); noise(0.05, 0.08, { f0: 5000, f1: 1500, type: 'bandpass', q: 0.7 }); } },
    shoot_shotgun: { gap: 0.08, f() { noise(0.22, 0.22, { f0: 2400, f1: 200 }); tone('sawtooth', 160, 50, 0.16, 0.12); } },
    shoot_charge: { gap: 0.06, f() { tone('triangle', 300, 1400, 0.09, 0.08); noise(0.08, 0.06, { f0: 6000, f1: 2000, type: 'highpass' }); } },
    shoot_magic: { gap: 0.05, f() { tone('sine', 1300, 600, 0.12, 0.08); tone('triangle', 1950, 900, 0.08, 0.04, { delay: 0.01 }); } },
    shoot_lob: { gap: 0.08, f() { tone('triangle', 260, 520, 0.12, 0.09); noise(0.07, 0.05, { f0: 1500, type: 'bandpass' }); } },
    shoot_chain: { gap: 0.06, f() { noise(0.14, 0.12, { f0: 7000, f1: 2500, type: 'bandpass', q: 3 }); tone('sawtooth', 1800, 400, 0.08, 0.05); } },
    shoot_flame: { gap: 0.09, f() { noise(0.13, 0.08, { f0: 900, f1: 500, type: 'bandpass', q: 0.6 }); } },
    shoot_beam: { gap: 0.12, f() { tone('sawtooth', 220, 230, 0.13, 0.035, { detune: 8 }); tone('sine', 880, 870, 0.13, 0.03); } },
    shoot_heavy: { gap: 0.1, f() { tone('sawtooth', 200, 40, 0.3, 0.16); noise(0.3, 0.2, { f0: 1800, f1: 120 }); } },
    shoot_rail: { gap: 0.1, f() { tone('square', 2400, 120, 0.3, 0.08); noise(0.25, 0.14, { f0: 9000, f1: 800, type: 'bandpass', q: 1.5 }); } },
    melee: { gap: 0.06, f() { noise(0.12, 0.13, { f0: 1200, f1: 6000, type: 'bandpass', q: 1.2 }); } },
    hit: { gap: 0.03, f() { tone('square', 260 + Math.random() * 60, 90, 0.05, 0.06); } },
    crit: { gap: 0.05, f() { tone('square', 1200, 600, 0.06, 0.06); tone('square', 300, 80, 0.06, 0.07); } },
    kill: { gap: 0.04, f() { noise(0.16, 0.12, { f0: 2500, f1: 300 }); tone('square', 420, 70, 0.14, 0.08); } },
    elitekill: { gap: 0.1, f() { noise(0.4, 0.2, { f0: 3000, f1: 100 }); tone('sawtooth', 300, 40, 0.4, 0.12); } },
    hurt: { gap: 0.1, f() { tone('sawtooth', 240, 60, 0.28, 0.16); noise(0.18, 0.14, { f0: 1600, f1: 200 }); } },
    shieldhit: { gap: 0.1, f() { tone('triangle', 1500, 700, 0.18, 0.1); tone('sine', 2200, 1800, 0.15, 0.05); } },
    dodge: { gap: 0.08, f() { noise(0.16, 0.1, { f0: 400, f1: 1800, type: 'bandpass', q: 0.9 }); } },
    pickup: { gap: 0.05, f() { arp([NOTE(76), NOTE(83)], 0.05, 'triangle', 0.07); } },
    coin: { gap: 0.035, f() { tone('square', 1320, 1320, 0.05, 0.035); tone('square', 1760, 1760, 0.12, 0.035, { delay: 0.045 }); } },
    heal: { gap: 0.1, f() { arp([NOTE(72), NOTE(76), NOTE(79), NOTE(84)], 0.05, 'triangle', 0.06); } },
    armor: { gap: 0.1, f() { tone('triangle', 600, 1200, 0.15, 0.08); } },
    energy: { gap: 0.05, f() { tone('sine', 900, 1800, 0.08, 0.06); } },
    weapon: { gap: 0.1, f() { tone('square', 200, 200, 0.05, 0.08); noise(0.06, 0.1, { f0: 3000, type: 'highpass', delay: 0.05 }); tone('square', 300, 300, 0.06, 0.06, { delay: 0.06 }); } },
    explode: { gap: 0.06, f() { noise(0.7, 0.32, { f0: 2200, f1: 60 }); tone('sine', 120, 30, 0.5, 0.25); } },
    propbreak: { gap: 0.05, f() { noise(0.15, 0.13, { f0: 1800, f1: 400, type: 'bandpass', q: 1 }); } },
    tele: { gap: 0.18, f() { tone('square', 1000, 1000, 0.05, 0.03); tone('square', 1000, 1000, 0.05, 0.03, { delay: 0.08 }); } },
    eshoot: { gap: 0.07, f() { tone('sine', 520, 260, 0.08, 0.03); } },
    strike: { gap: 0.08, f() { noise(0.35, 0.22, { f0: 900, f1: 60 }); tone('sine', 90, 35, 0.3, 0.2); } },
    door_close: { gap: 0.2, f() { noise(0.25, 0.15, { f0: 500, f1: 120 }); tone('square', 110, 70, 0.2, 0.08); } },
    door_open: { gap: 0.2, f() { tone('square', 140, 220, 0.18, 0.06); noise(0.2, 0.08, { f0: 800, f1: 300, delay: 0.05 }); } },
    roomclear: { gap: 0.3, f() { arp([NOTE(67), NOTE(71), NOTE(74), NOTE(79)], 0.07, 'square', 0.05, 0.2); } },
    bossintro: { gap: 1, f() { tone('sawtooth', 70, 40, 1.4, 0.18); tone('sawtooth', 105, 60, 1.4, 0.1, { detune: 12 }); noise(1.2, 0.1, { f0: 300, f1: 60 }); } },
    bossphase: { gap: 0.6, f() { tone('sawtooth', 50, 200, 0.6, 0.15); noise(0.8, 0.25, { f0: 3000, f1: 80 }); } },
    bosskill: { gap: 1, f() { noise(1.6, 0.3, { f0: 2500, f1: 40 }); tone('sine', 140, 25, 1.4, 0.3); arp([NOTE(60), NOTE(64), NOTE(67), NOTE(72), NOTE(76)], 0.12, 'square', 0.05, 0.4); } },
    relic: { gap: 0.2, f() { arp([NOTE(72), NOTE(79), NOTE(84), NOTE(88)], 0.06, 'triangle', 0.07, 0.25); } },
    synergy: { gap: 0.3, f() { arp([NOTE(67), NOTE(72), NOTE(76), NOTE(79), NOTE(84), NOTE(91)], 0.05, 'square', 0.045, 0.3); } },
    levelup: { gap: 0.3, f() { arp([NOTE(60), NOTE(67), NOTE(72)], 0.08, 'triangle', 0.07, 0.3); } },
    buy: { gap: 0.15, f() { tone('square', 1500, 1500, 0.05, 0.04); tone('square', 2000, 2000, 0.15, 0.04, { delay: 0.06 }); noise(0.08, 0.05, { f0: 6000, type: 'highpass' }); } },
    deny: { gap: 0.2, f() { tone('square', 180, 180, 0.08, 0.06); tone('square', 140, 140, 0.12, 0.06, { delay: 0.1 }); } },
    skill: { gap: 0.2, f() { tone('sine', 300, 1200, 0.3, 0.1); noise(0.3, 0.08, { f0: 600, f1: 4000, type: 'bandpass' }); } },
    chest: { gap: 0.2, f() { tone('square', 200, 160, 0.1, 0.06); arp([NOTE(76), NOTE(81), NOTE(88)], 0.06, 'triangle', 0.06); } },
    portal: { gap: 0.5, f() { tone('sine', 200, 1600, 0.9, 0.1); tone('triangle', 300, 2400, 0.9, 0.05, { detune: 10 }); } },
    bhit: { gap: 0.06, f() { tone('square', 1800 + Math.random() * 400, 900, 0.025, 0.018); } },
    shieldup: { gap: 0.2, f() { tone('triangle', 900, 1350, 0.12, 0.05); tone('sine', 1800, 1800, 0.1, 0.025, { delay: 0.05 }); } },
    ui: { gap: 0.04, f() { tone('square', 660, 660, 0.04, 0.03); } },
    uiok: { gap: 0.06, f() { tone('square', 880, 1320, 0.07, 0.04); } },
    win: { gap: 2, f() { arp([NOTE(60), NOTE(64), NOTE(67), NOTE(72), NOTE(67), NOTE(72), NOTE(76), NOTE(84)], 0.11, 'square', 0.06, 0.35); } },
    lose: { gap: 2, f() { arp([NOTE(67), NOTE(63), NOTE(60), NOTE(55)], 0.2, 'triangle', 0.08, 0.5); } }
  };
  const KIND_SND = { gun: 'shoot_gun', charge: 'shoot_charge', melee: 'melee', beam: 'shoot_beam', lob: 'shoot_lob', chain: 'shoot_chain', flame: 'shoot_flame' };
  const WID_SND = { shotgun: 'shoot_shotgun', frost_wand: 'shoot_magic', star_scatter: 'shoot_magic', rocket: 'shoot_heavy', void_cannon: 'shoot_heavy', railgun: 'shoot_rail', thunder_staff: 'shoot_chain', bouncer: 'shoot_magic' };

  function play(name, o) {
    try {
      if (!actx || !inited) return;
      const st = S_();
      if (st.mute) return;
      const r = R[name]; if (!r) return;
      const now = actx.currentTime;
      if (last[name] !== undefined && now - last[name] < r.gap) return;
      if (voices > MAX_VOICES && !(o && o.force)) return;
      last[name] = now;
      r.f(o || {});
    } catch (e) { /* 吞掉 */ }
  }

  // ---------- 程序化 BGM ----------
  // 每首：bpm、根音、音阶、和弦进行（音阶级数）、波形、氛围
  const SONGS = {
    title: { bpm: 84, root: 50, scale: [0, 3, 5, 7, 10], prog: [0, 3, 2, 4], lead: 'triangle', bass: 'triangle', drum: 0 },
    moss: { bpm: 100, root: 45, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 3, 4], lead: 'triangle', bass: 'triangle', drum: 1 },
    lava: { bpm: 118, root: 40, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 0, 5, 6], lead: 'square', bass: 'sawtooth', drum: 2 },
    abyss: { bpm: 92, root: 43, scale: [0, 2, 3, 6, 7, 8, 11], prog: [0, 5, 1, 4], lead: 'sine', bass: 'triangle', drum: 1 },
    boss: { bpm: 140, root: 41, scale: [0, 1, 3, 5, 6, 8, 10], prog: [0, 0, 6, 5], lead: 'square', bass: 'sawtooth', drum: 3 }
  };
  let wantMusic = null, curSong = null, timer = null, nextT = 0, stepN = 0, songGain = null;
  function deg(song, d, oct) {
    const sc = song.scale, n = sc.length;
    const o = Math.floor(d / n), i = ((d % n) + n) % n;
    return NOTE(song.root + sc[i] + 12 * (o + (oct || 0)));
  }
  function mtone(type, f, t, dur, vol) {
    const osc = actx.createOscillator(), g = actx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(songGain); osc.start(t); osc.stop(t + dur + 0.02);
    osc.onended = function () { try { g.disconnect(); } catch (e) { /* */ } };
  }
  function mnoise(t, dur, vol, f0, type) {
    const src = actx.createBufferSource(); src.buffer = noiseBuf;
    const f = actx.createBiquadFilter(); f.type = type || 'highpass'; f.frequency.value = f0;
    const g = actx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(songGain); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    src.onended = function () { try { g.disconnect(); } catch (e) { /* */ } };
  }
  function schedStep(song, t, n) {
    const bar = Math.floor(n / 16) % song.prog.length, s = n % 16, ch = song.prog[bar];
    const sp = 60 / song.bpm / 4;
    // 低音：每拍
    if (s % 4 === 0) mtone(song.bass, deg(song, ch, -1), t, sp * 3.5, 0.11);
    if (song.drum >= 2 && s % 4 === 2) mtone(song.bass, deg(song, ch, -1), t, sp * 1.5, 0.07);
    // 琶音：和弦音 1-3-5-8
    const pat = [0, 2, 4, 7, 4, 2, 0, 2];
    if (s % 2 === 0 || song.drum >= 3) {
      const d = ch + pat[(s >> (song.drum >= 3 ? 0 : 1)) % pat.length];
      mtone(song.lead, deg(song, d, 1), t, sp * 1.8, song.lead === 'square' ? 0.022 : 0.035);
    }
    // 简单旋律点缀（每两小节）
    if ((Math.floor(n / 16) % 2 === 1) && (s === 6 || s === 14)) mtone('triangle', deg(song, ch + 4, 2), t, sp * 3, 0.025);
    // 鼓
    if (song.drum >= 1) {
      if (s % 8 === 0) mtone('sine', 110, t, 0.12, 0.12);
      if (song.drum >= 2 && s % 8 === 4) mnoise(t, 0.09, 0.05, 1500, 'bandpass');
      if (s % 2 === 1 && song.drum >= 1) mnoise(t, 0.03, 0.02, 7000);
      if (song.drum >= 3 && s % 4 === 0) mtone('sine', 90, t, 0.1, 0.1);
    }
  }
  function tick() {
    try {
      if (!actx || !curSong) return;
      if (actx.state !== 'running') { nextT = actx.currentTime + 0.1; return; }
      const sp = 60 / curSong.bpm / 4;
      if (nextT < actx.currentTime) nextT = actx.currentTime + 0.05;
      while (nextT < actx.currentTime + 0.25) { schedStep(curSong, nextT, stepN++); nextT += sp; }
    } catch (e) { /* */ }
  }
  function stopMusic() {
    curSong = null;
    if (timer) { clearInterval(timer); timer = null; }
    if (songGain) {
      try { const g = songGain; g.gain.setTargetAtTime(0.0001, actx.currentTime, 0.15); setTimeout(function () { try { g.disconnect(); } catch (e) { /* */ } }, 800); } catch (e) { /* */ }
      songGain = null;
    }
  }
  function startMusic(id) {
    stopMusic();
    const song = SONGS[id]; if (!song || !actx) return;
    songGain = actx.createGain(); songGain.gain.setValueAtTime(0.0001, actx.currentTime);
    songGain.gain.linearRampToValueAtTime(1, actx.currentTime + 0.8);
    songGain.connect(musBus);
    curSong = song; stepN = 0; nextT = actx.currentTime + 0.1;
    timer = setInterval(tick, 50); tick();
  }

  // ---------- 事件订阅 ----------
  function themeOf(f) { const fl = G.FLOORS && G.FLOORS[f]; return (fl && fl.theme) || 'moss'; }
  let floorTheme = 'moss';
  function subscribe() {
    if (!G.on) return;
    const on = function (t, fn) { G.on(t, function (d) { try { fn(d || {}); } catch (e) { /* */ } }); };
    on('shoot', function (d) {
      const w = G.WEAPONS && G.WEAPONS[d.wid];
      const k = d.kind || (w && w.kind) || 'gun';
      play(WID_SND[d.wid] || KIND_SND[k] || 'shoot_gun');
    });
    on('melee', function () { play('melee'); });
    on('ehit', function (d) { play(d.crit ? 'crit' : 'hit'); });
    on('ekill', function (d) {
      if (d.boss) { play('bosskill'); if (wantMusic === 'boss') A.music(null); setTimeout(function () { if (!wantMusic) A.music(floorTheme); }, 2500); }
      else if (d.elite) play('elitekill'); else play('kill');
    });
    on('eshoot', function () { play('eshoot'); });
    on('tele', function () { play('tele'); });
    on('phurt', function (d) { play(d.shield ? 'shieldhit' : 'hurt'); });
    on('pdodge', function () { play('dodge'); });
    on('pickup', function (d) {
      const k = d.kind;
      if (k === 'coin') play('coin'); else if (k === 'heart') play('heal'); else if (k === 'armor') play('armor');
      else if (k === 'energy') play('energy'); else if (k === 'chest') play('chest'); else play('pickup');
    });
    on('heal', function () { play('heal'); });
    on('bhit', function (d) { if (d.own !== 'e') play('bhit'); });
    on('shieldup', function () { play('shieldup'); });
    on('explode', function () { play('explode'); });
    on('propbreak', function () { play('propbreak'); });
    on('strike', function () { play('strike'); });
    on('doors', function (d) { play(d.locked ? 'door_close' : 'door_open'); });
    on('roomclear', function () { play('roomclear'); });
    on('relic', function () { play('relic'); });
    on('synergy', function () { play('synergy'); });
    on('weapon', function () { play('weapon'); });
    on('skill', function () { play('skill'); });
    on('buy', function () { play('buy'); });
    on('deny', function () { play('deny'); });
    on('bossintro', function () { play('bossintro'); A.music('boss'); });
    on('bossphase', function () { play('bossphase'); });
    on('floor', function (d) { floorTheme = themeOf(d.floor); play('portal'); A.music(floorTheme); });
    on('roomenter', function (d) { if (d.type !== 'boss' && wantMusic === 'boss') A.music(floorTheme); });
    on('runend', function (d) { play(d.win ? 'win' : 'lose'); A.music(null); });
  }

  const A = {
    init: function () {
      if (inited) return;
      inited = true;
      try { subscribe(); } catch (e) { /* */ }
    },
    // 每次用户手势调用：首次创建，之后若被挂起则 resume
    unlock: function () {
      try {
        if (disabled()) return;
        if (!inited) A.init();
        if (!actx) create();
        if (actx && actx.state !== 'running' && actx.resume) { const pr = actx.resume(); if (pr && pr.catch) pr.catch(function () { /* */ }); }
      } catch (e) { /* */ }
    },
    play: play,
    // id: 'title'|'moss'|'lava'|'abyss'|'boss'|null；也接受楼层序号
    music: function (id) {
      try {
        if (typeof id === 'number') id = themeOf(id);
        if (id && SONGS[id] && id !== 'boss' && id !== 'title') floorTheme = id;
        if (id === wantMusic && (curSong || !actx)) return;
        wantMusic = id || null;
        if (!actx) return;
        if (!wantMusic) stopMusic(); else startMusic(wantMusic);
      } catch (e) { /* */ }
    },
    setMute: function (b) {
      try { if (G.settings) G.settings.mute = !!b; A.applySettings(); } catch (e) { /* */ }
    },
    applySettings: function () {
      try {
        if (!actx) return;
        const s = S_(), t = actx.currentTime;
        master.gain.setTargetAtTime(s.mute ? 0 : num(s.master, 0.8), t, 0.02);
        sfxBus.gain.setTargetAtTime(num(s.sfx, 0.8), t, 0.02);
        musBus.gain.setTargetAtTime(num(s.music, 0.5) * 0.55, t, 0.05);
      } catch (e) { /* */ }
    },
    state: function () { return actx ? actx.state : 'none'; },
    names: Object.keys(R)
  };
  G.Audio = A;
})(window.Game = window.Game || {});
