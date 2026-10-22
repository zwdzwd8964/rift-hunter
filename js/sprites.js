/* sprites.js — 《裂隙猎人》像素美术：ENDESGA-32 调色板、像素串精灵、程序化派生、预渲染缓存、绘制 API。所有者：art(a05)
 *
 * ===================== 美术规范（DESIGN.md 美术部分以此为准） =====================
 * 1. 调色板：ENDESGA-32，G.PAL[0..31]，像素串字符 '0'-'9','a'-'v' 对应索引，'.' 透明。全游戏只用这 32 色。
 * 2. 尺度：1 美术像素 = G.PX(2) 逻辑像素。地砖 20x20 = 1 格(40 逻辑)。角色/普通敌人 12–18 见方（小怪可更小），
 *    Boss 36–44，武器 10–24 宽，遗物/UI 图标 12x12。绘制位置吸附到 2 逻辑像素网格，imageSmoothingEnabled=false。
 * 3. 自动描边：除地砖/门外，所有精灵在预渲染时由引擎根据剪影自动加 1px #181425('p') 外描边（4 邻域），
 *    像素串里不手写外轮廓，全体描边粗细一致。因此 canvas 尺寸 = 美术尺寸 + 2。
 * 4. 光源：左上方。每种材质 3–4 阶明暗（亮面在左上，暗面在右下），高光 1px。
 * 5. 剪影优先：角色/敌人只看剪影也能认出；角色朝右绘制（朝左用 flip）。
 * 6. 敌人配色：每个敌人一个主色系；三层色系区分 ——
 *    第1层(苔藓)：绿/棕/土色；第2层(熔岩)：红/橙/钢灰；第3层(深渊)：紫/深蓝/青色辉光。
 *    每个敌人都有醒目的眼睛或特征（亮色眼、獠牙、盾、准星…）。
 * 7. 动画派生（减少手写量，但基础帧全部手绘）：
 *    idle1 = 上半身下沉 1px；walk0-3 = 腿部行左右位移/抬脚；hurt = 按亮度映射到红色阶；roll = 旋转 90°；
 *    atk = 前倾 1px + 整体提亮（蓄力感）或手绘；Boss 二阶段 = 调色板替换 + 叠加装饰（裂纹/火焰/血丝）。
 *    地砖变体 = 同一基底 + 哈希噪声点缀；遗物图标 = 底座形状模板 × 主色阶 + 符号。
 * 8. 精英：draw(..., {outline:'#hex'}) 在自动描边外再加 1px 词缀色外圈；受击 {flash:true} 白剪影；
 *    状态色调 {tint:'#rrggbb'}（冻结 #c0cbdc / 燃烧 #f77622 / 中毒 #63c74d）。
 * ====================================================================================
 * 加载时只构造字符串数组（纯函数，不碰 DOM）；首次 get/draw 时才 document.createElement('canvas') 预渲染并缓存。
 */
(function (G) {
  'use strict';

  // ---------- 调色板 ----------
  const PAL = ['#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
    '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
    '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
    '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569'];
  const CH = '0123456789abcdefghijklmnopqrstuv';
  G.PAL = PAL;
  G.PALCH = CH;

  // ---------- 色阶映射（派生用） ----------
  const LIGHTER = {
    '0': '1', '1': '3', '2': 'j', '3': 'u', '4': '3', '5': '4', '6': '5', '7': '8', '8': 't', '9': 'a', 'a': 'b', 'b': 'j',
    'c': 'b', 'd': 'c', 'e': 'd', 'f': 'e', 'g': 'h', 'h': 'i', 'i': 'j', 'j': 'j', 'k': 'j', 'l': 'k', 'm': 'l', 'n': 'm',
    'o': 'n', 'p': 'p', 'q': 't', 'r': 's', 's': 't', 't': 'u', 'u': '2', 'v': '3'
  };
  const DARKER = {
    '0': '7', '1': '0', '2': 'u', '3': 'v', '4': '5', '5': '6', '6': 'p', '7': '6', '8': '7', '9': '0', 'a': '9', 'b': 'a',
    'c': 'd', 'd': 'e', 'e': 'f', 'f': 'p', 'g': 'o', 'h': 'g', 'i': 'h', 'j': 'k', 'k': 'l', 'l': 'm', 'm': 'n', 'n': 'o',
    'o': 'p', 'p': 'p', 'q': '7', 'r': '6', 's': 'r', 't': '8', 'u': 'v', 'v': '4'
  };
  function lum(ch) {
    const h = PAL[CH.indexOf(ch)];
    const r = parseInt(h.substr(1, 2), 16), g = parseInt(h.substr(3, 2), 16), b = parseInt(h.substr(5, 2), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  // 按亮度映射到某个 5 阶色阶（受击红、冰冻蓝、二阶段换色…）
  function rampMap(ramp) {
    const m = {};
    for (const c of CH) {
      if (c === 'p') { m[c] = 'p'; continue; }
      const L = lum(c);
      const i = L < 50 ? 0 : L < 95 ? 1 : L < 140 ? 2 : L < 195 ? 3 : 4;
      m[c] = ramp[Math.min(i, ramp.length - 1)];
    }
    return m;
  }
  const HURT = rampMap('678tu');

  // ---------- 网格工具（行字符串数组，纯函数） ----------
  function W(rows) { return rows.length ? rows[0].length : 0; }
  function blank(w, h) { const r = []; for (let y = 0; y < h; y++) r.push('.'.repeat(w)); return r; }
  function setPx(rows, x, y, c) {
    if (y < 0 || y >= rows.length || x < 0 || x >= rows[y].length) return;
    rows[y] = rows[y].substr(0, x) + c + rows[y].substr(x + 1);
  }
  function getPx(rows, x, y) {
    if (y < 0 || y >= rows.length || x < 0 || x >= rows[y].length) return '.';
    return rows[y][x];
  }
  function remap(rows, map) {
    return rows.map(r => r.replace(/[^.]/g, c => (map[c] !== undefined ? map[c] : c)));
  }
  function parseMap(s) { // 'a>b,c>d'
    const m = {};
    s.split(',').forEach(p => { if (p.length >= 3) m[p[0]] = p[2]; });
    return m;
  }
  function stamp(rows, over, ox, oy) {
    const out = rows.slice();
    for (let y = 0; y < over.length; y++) for (let x = 0; x < over[y].length; x++) {
      const c = over[y][x];
      if (c !== '.') setPx(out, ox + x, oy + y, c === '_' ? '.' : c);
    }
    return out;
  }
  function pad(rows, l, t, r, b) {
    const w = W(rows) + l + r;
    const out = [];
    for (let i = 0; i < t; i++) out.push('.'.repeat(w));
    rows.forEach(row => out.push('.'.repeat(l) + row + '.'.repeat(r)));
    for (let i = 0; i < b; i++) out.push('.'.repeat(w));
    return out;
  }
  function flipH(rows) { return rows.map(r => r.split('').reverse().join('')); }
  function rot90(rows) { // 顺时针
    const h = rows.length, w = W(rows), out = [];
    for (let x = 0; x < w; x++) { let s = ''; for (let y = h - 1; y >= 0; y--) s += rows[y][x]; out.push(s); }
    return out;
  }
  // 区域平移（只移动 y0..y1-1 行内满足 pred(x) 的像素）
  function shiftRegion(rows, y0, y1, dx, dy, pred) {
    const out = rows.slice();
    const w = W(rows);
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (!pred || pred(x)) setPx(out, x, y, '.');
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
      if (pred && !pred(x)) continue;
      const c = rows[y][x];
      if (c !== '.') setPx(out, x + dx, y + dy, c);
    }
    return out;
  }
  // 上半身下沉 1px（呼吸/行走起伏）：删掉 legY-1 行，顶部补空行
  function bob(rows, legY) {
    return ['.'.repeat(W(rows))].concat(rows.slice(0, legY - 1), rows.slice(legY));
  }
  // 上半身前倾/位移
  function lean(rows, legY, dx) { return shiftRegion(rows, 0, legY, dx, 0); }
  // 行走：腿部行左半/右半水平位移，lift 抬脚
  function walkLegs(rows, legY, cx, dl, dr, liftL, liftR) {
    let out = shiftRegion(rows, legY, rows.length, dl, -(liftL || 0), x => x < cx);
    const src = out;
    out = shiftRegion(src, legY, rows.length, dr, -(liftR || 0), x => x >= cx);
    return out;
  }
  // 垂直挤压/拉伸（史莱姆等无腿生物）
  function squash(rows) { // 删除中间一行，顶部补空，底部最宽行向两侧扩 1
    const h = rows.length, mid = h >> 1;
    let out = ['.'.repeat(W(rows))].concat(rows.slice(0, mid), rows.slice(mid + 1));
    const last = out.length - 1;
    let r = out[last];
    for (let y = last; y >= 0; y--) { if (/[^.]/.test(out[y])) { r = out[y]; const a = r.search(/[^.]/), b = r.length - 1 - r.split('').reverse().join('').search(/[^.]/); setPx(out, a - 1, y, r[a]); setPx(out, b + 1, y, r[b]); break; } }
    return out;
  }
  function stretch(rows) { // 顶部删一行（应为空），中间复制一行
    const h = rows.length, mid = h >> 1;
    return rows.slice(1, mid + 1).concat([rows[mid]], rows.slice(mid + 1));
  }
  // 1px 自动外描边（4 邻域）
  function outline(rows, col) {
    col = col || 'p';
    const src = pad(rows, 1, 1, 1, 1), out = src.slice();
    const h = src.length, w = W(src);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (src[y][x] !== '.') continue;
      if (getPx(src, x - 1, y) !== '.' || getPx(src, x + 1, y) !== '.' || getPx(src, x, y - 1) !== '.' || getPx(src, x, y + 1) !== '.') setPx(out, x, y, col);
    }
    return out;
  }
  // 确定性哈希噪声（地砖点缀；不用 Math.random，保证每次加载一致）
  function hash(a, b, c) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---------- 形状绘制（程序化部件：球体、矩形、线） ----------
  // 左上光源的球体着色：ramp 从暗到亮（3-4 阶）
  function ball(rows, cx, cy, rx, ry, ramp) {
    const out = rows;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, d = nx * nx + ny * ny;
      if (d > 1) continue;
      // 光照：法线与左上光向点积
      const nz = Math.sqrt(Math.max(0, 1 - d));
      let l = (-nx * 0.55 - ny * 0.65 + nz * 0.55);
      let i = l > 0.97 ? 3 : l > 0.72 ? 2 : l > 0.25 ? 1 : 0;
      if (i >= ramp.length) i = ramp.length - 1;
      setPx(out, x, y, ramp[i]);
    }
    return out;
  }
  function rect(rows, x0, y0, w, h, c) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(rows, x, y, c); return rows; }
  function line(rows, x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) setPx(rows, Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c);
    return rows;
  }

  // ---------- 定义表 ----------
  const DEFS = {};      // name -> { frames:{fname:rows}, order:[fname], ol:bool, anchor }
  function def(name, frames, opt) {
    opt = opt || {};
    if (Array.isArray(frames)) { const f = {}; frames.forEach((r, i) => { f[String(i)] = r; }); frames = f; }
    DEFS[name] = { frames: frames, order: Object.keys(frames), ol: opt.ol !== false, anchor: opt.anchor || 'center' };
  }
  const grip = {};
  const ERRORS = [];    // 定义期问题（行过长/非法字符），测试读取
  // 手绘像素块：多行文本 → 行数组；行尾透明可省略（自动补 '.' 到宽度 w），超宽记错误
  function A(w, txt, tag) {
    const lines = txt.split('\n').map(s => s.replace(/\s+$/, '')).filter((s, i, arr) => !(s === '' && (i === 0 || i === arr.length - 1)));
    return lines.map((s, i) => {
      s = s.trim();
      if (s.length > w) ERRORS.push((tag || '?') + ' 第' + i + '行超宽 ' + s.length + '>' + w);
      if (/[^.0-9a-v_XYZ]/.test(s)) ERRORS.push((tag || '?') + ' 第' + i + '行非法字符: ' + s);
      return (s + '.'.repeat(w)).substr(0, w);
    });
  }

  // ---------- 派生帧集合 ----------
  // 有腿角色：legY=腿部起始行，cx=左右腿分界列
  function charSet(base, legY, cx) {
    return {
      idle0: base, idle1: bob(base, legY),
      walk0: walkLegs(base, legY, cx, -1, 1, 0, 0),
      walk1: walkLegs(bob(base, legY), legY, cx, 0, 0, 0, 1),
      walk2: walkLegs(base, legY, cx, 1, -1, 0, 0),
      walk3: walkLegs(bob(base, legY), legY, cx, 0, 0, 1, 0),
      hurt: remap(lean(base, legY, -1), HURT),
      roll: rot90(base)
    };
  }
  // 敌人：kind = 'legs' | 'blob' | 'fly' | 'robe' | 'fixed'
  function enemySet(base, kind, legY, cx, atk) {
    if (kind === 'blob' || kind === 'fly') base = pad(base, 0, 1, 0, 0);   // 为上下起伏留 1 行
    const h = base.length;
    let idle1, w0, w1;
    if (kind === 'legs') { idle1 = bob(base, legY); w0 = walkLegs(base, legY, cx, -1, 1, 0, 0); w1 = walkLegs(bob(base, legY), legY, cx, 1, -1, 0, 0); }
    else if (kind === 'blob') { idle1 = squash(base); w0 = stretch(base); w1 = squash(base); }
    else if (kind === 'fly') { idle1 = shiftRegion(base, 0, h, 0, -1); w0 = shiftRegion(base, 0, h, 0, -1); w1 = shiftRegion(base, 0, h, 0, 1); }
    else if (kind === 'robe') { idle1 = bob(base, legY); w0 = shiftRegion(base, legY, h, -1, 0); w1 = shiftRegion(base, legY, h, 1, 0); }
    else { idle1 = remap(base, LIGHTER_GLOW); w0 = base; w1 = idle1; }
    let a;
    if (typeof atk === 'function') a = atk(base);
    else if (typeof atk === 'string') a = remap(base, parseMap(atk));
    else a = remap(kind === 'legs' || kind === 'robe' ? lean(base, legY, 1) : base, LIGHTER);
    return { idle0: base, idle1: idle1, walk0: w0, walk1: w1, hurt: remap(base, HURT), atk: a };
  }
  // 只提亮发光色（熔岩/眼睛），用于固定炮台脉动
  const LIGHTER_GLOW = parseMap('9>a,a>b,b>j,i>j,h>i,s>t,8>t');

  // ====================== 角色（16x16，朝右） ======================
  const CHAR_ART = {
    ranger: [A(16, `
................
....eeeee
...edddddee
..edcccccdde
..edcdd3uuu3e
..eddd3uupup3
..eddd3uuuu3
...edd43333
...5eddd44de
..54dcccccd45
..u4dddddddu
...55a555a5
....ddd.ddd
....55...55
....55...55
...655..655`, 'ranger'), 13, 7],
    mage: [A(16, `
................
...gg
....ghg
.....ghhg
....ghhihg
..ggghhhhhggg
....n3uuuu3
....n3upuup
.....33uu3
....ghkkkkhg
...uhhgiihhgu
....ghhhhhhg
...ghhhhhhhhg
...gggggggggg
.....55..55
.....66..66`, 'mage'), 14, 8],
    knight: [A(16, `
....88
...8778
....7lkkl
...lkjjkkl
..lkjkkkkkl
..lkkmppipm
..lkkkkkkkl
...mlllllm
..mlkkkkklm
.lkmlkkklmkl
.lkmll77lmkl
..m.mmaamm.m
...lkkm.kkl
...lkl...lkl
...mlm...mlm
..nmmm..nmmm`, 'knight'), 13, 7],
    alchemist: [A(16, `
................
.....555
....54445
....59995
..5555555555
....6uuuuu
....6uaiai
....6uuuu3
.....u33u
....rsssssr
...urssassru
....rsrcrsr
....rrrcrrr
....55...55
....55...55
...655..655`, 'alchemist'), 13, 7]
  };
  for (const cid in CHAR_ART) { const c = CHAR_ART[cid]; def('char_' + cid, charSet(c[0], c[1], c[2]), { anchor: 'center' }); }

  // ====================== 普通敌人（朝右） ======================
  // [像素块, 类型, legY, cx, atk(可选)]
  const EN = {};
  // —— 第1层 苔藓：绿/棕/土色 ——
  EN.slime = [A(16, `
......dddd
....ddccccdd
...dcbbccccdd
..dcbccccccccd
..dcccjjcccjjd
.dccccjpcccjpcd
.dcccccc66cccdd
dccccccccccccdde
ddcccccccccddde
.eeddddddddddee
..eeeeeeeeeeee`, 'slime'), 'blob'];
  EN.slimelet = [A(10, `
...dddd
..dcccccd
.dcbcjcjd
.dcccpcpd
dcccccccdd
dddccccdde
.eeddddee`, 'slimelet'), 'blob'];
  EN.boar = [A(18, `
...6.6.6.6
..656565656..5
.6544444444455454
65444444444444445
654444444444448445
6544444444444444tt
6544444444444445tp
.65544444444555552
..6555555555556.2
...55.55...55.55
...66.66...66.66`, 'boar'), 'legs', 9, 9];
  EN.archer = [A(16, `
.....5555
....544445...4
cc.54444445..k4
.ccd5cccbcc..k.4
..dddcccpcc..k.4
...dccccc6...k.4
....ddcc.....k.4
...5d555d5ccck.4
..5d5d55d5...k.4
..cd55555....k.4
....5aa55....k4
....55555....4
....d...d
....d...d
...ed..ed`, 'archer'), 'legs', 12, 6, b => stamp(b, A(5, `
4
.4
.k4
.k.4
.k.4
cck.4
.k.4
.k4
4`), 11, 1)];
  EN.shroom = [A(16, `
.....777777
...7788tt8877
..78t228888227
.78t822888882287
.78888888228887
7888228888888877
.77777777777777
....22u22u22
....2jp2jp22
....222222222
....u22662u2
.....u22222
.....55..55
....655.655`, 'shroom'), 'legs', 12, 8, b => remap(b, parseMap('7>8,8>t,t>j,2>b,u>a'))];
  EN.bat = [A(16, `
.....5....5
6....554455....6
65..55855855..56
6555555555555556
.66555522555566
..665.5225.566
...6...55...6`, 'bat'), 'bat'];
  // —— 第2层 熔岩：红/橙/钢灰 ——
  EN.guard = [A(16, `
....nmmmn
...mlkkklm
..mlkjkkklm
..mmmmmmmmm
..mpp8pp8pmnnnnn
..nmmmmmmnmlkkkn
...n7777nmlk7kln
..mn78877mlk787n
..lmn7777mlk7kln
..lm.nmmmmlkkkln
..kl.n55nmlkkkln
.....n55nmllllmn
.....m..m.nnnnn
....nm..nm
....nn..nn`, 'guard'), 'legs', 12, 7];
  EN.imp = [A(14, `
..6........6
..76......67
...78888887
..78tt888887
..78bb88bb87
..78pb88pb87
..7888888887
...78j77j87
.9..788887..9
a99.788887.99a
.a97788887799a
...77888877
....7.77.7
...7..77..7`, 'imp'), 'fly'];
  EN.mole = [A(16, `
.....aaaa
....aabbaa
...aaaaaaab
..54444444455
.54vv4444p4445
.5vvvvv44444tt
54vvv224444457
54v2.22.444455
.5422.2.44445
..55..555555
..22.22..22.22`, 'mole'), 'legs', 9, 8, b => remap(lean(b, 9, 1), parseMap('b>j,a>b'))];
  EN.turret = [A(17, `
................
.....555555
....54444445
...5449aa9445
...549abba945mmm
...59abjjba95lkkm
...59abjjba95mllm
...549abba945mmm
...5449aa9445
..665444444566
.65555555555556
.6555566655556
655555555555556
666666666666666`, 'turret'), 'fixed', 0, 0, b => stamp(remap(b, LIGHTER_GLOW), A(3, `
bbb
jjb
jjb
bbb`), 13, 4)];
  EN.toad = [A(16, `
......000...000
.....0bjb0.0bjb0
.....0pb90009pb0
....099999999990
...0991199999990
..09911999999977
..0999999777777
.099999aaaaaa0
.0999aaaaaaa90
0099aaaaaaa990
09900099900990
.00..0000.000`, 'toad'), 'legs', 10, 8];
  EN.shaman = [A(16, `
...8.a.8...222
...8a8a8..2j222
..55555555.2p2p
..5222222..2222
..52b22b2...25
..522222255..5
...2p22p2....5
..00999990...5
.0919999990..5
.u99a99a990uu5
.009999999905
..0999999990
..0000000000.5
....5...5....5
...65..65....6`, 'shaman'), 'legs', 13, 7, b => remap(b, parseMap('b>j,2>b,j>b,p>9'))];
  // —— 第3层 深渊：紫/深蓝/青色辉光 ——
  EN.wraith = [A(16, `
.....rrrrr
....rssssssr
...rsstsssssr
...rsppppppsr
..rsppippippr
..rspppppppsr
..rssppppppsr
.krrsssssssr.k
.lkrsssssssrkl
..lrrssssssr.l
...rrsssssrr
....rrssssrr
.....rrsrr.r
......r.r..r
.....r...r`, 'wraith'), 'robe', 11, 8, b => remap(b, parseMap('i>j,p>r,s>t'))];
  EN.priest = [A(16, `
......n......st
.....nmn....stjs
....nmmmn...sstr
....nmpppn...rr
...nmppipi...5
...nmppppn...5
..nmmnnnnmn..5
..nmsnnnnsn..5
.nmmsonnnsnll5
.nmmsoonnsnn.5
.nmmssssssnn.5
nmmmoooooonn.5
nmmooooooonnn5
nnnnnnnnnnnn.6`, 'priest'), 'robe', 12, 7, b => remap(b, parseMap('s>t,t>j,r>s,i>j'))];
  EN.sniper = [A(18, `
....oooo
...onnnno
..onnnnnno
..onnpppnn
..onnpiipn
..onnpppnn
...onnnnn..mii
..oggggguummmmmmmm
.oghggggunnmnn
.oghhggggo...n
.ogghgggggo
..oggggggo
...ogo.ogo
...on..on
..ooo.ooo`, 'sniper'), 'legs', 12, 6, b => stamp(remap(b, parseMap('i>j')), A(2, `
iq`), 16, 7)];
  EN.abyss_knight = [A(18, `
..s......s
..ns....sn
...nmmmmn
..nmlklmmn......k
..nmpppppn.....kl
..nmpsspsn....kl
..rnmmmmmn...kl
.rrnmlklmnn.kl
.rnmllkllmnmao
rrnmmllmmnnlo
rrnnsssssnn.l
rr.nmmmmmn
r..nmm.mmn
...nm...mn
..nnm..nnm`, 'abyss_knight'), 'legs', 12, 7, b => remap(lean(b, 12, 1), parseMap('s>t,k>j,l>k'))];

  // 蝙蝠：翅膀上下扇动（外侧列整体位移）
  function batSet(base) {
    base = pad(base, 0, 2, 0, 1);
    const h = base.length, outer = x => x < 4 || x > 11;
    const up = shiftRegion(base, 0, h, 0, -2, outer), down = shiftRegion(base, 0, h, 0, 1, outer);
    return { idle0: base, idle1: up, walk0: up, walk1: down, hurt: remap(base, HURT), atk: remap(down, parseMap('8>q,2>j,5>4')) };
  }
  for (const t in EN) {
    const e = EN[t];
    const fr = e[1] === 'bat' ? batSet(e[0]) : enemySet(e[0], e[1], e[2], e[3], e[4]);
    def('enemy_' + t, fr, { anchor: 'center' });
  }

  // ====================== Boss（36–44 见方，正面） ======================
  // 身体用左上光源球体着色程序化生成，五官/王冠/裂纹/触手手绘叠加
  function bossSet(base, idle1, atk, p2, p2idle1, p2atk) {
    return { idle0: base, idle1: idle1, atk: atk, hurt: remap(base, HURT), p2_idle0: p2, p2_idle1: p2idle1, p2_atk: p2atk, p2_hurt: remap(p2, HURT) };
  }
  // —— 史莱姆之王：绿色巨史莱姆 + 金冠；二阶段变紫（毒化）、王冠开裂、怒眉、滴落 ——
  (function () {
    let b = blank(40, 34);
    ball(b, 20, 19.5, 19, 13.5, 'edcc');
    for (let y = 31; y < 34; y++) b[y] = '.'.repeat(40);
    rect(b, 2, 30, 36, 1, 'e'); rect(b, 4, 31, 32, 1, 'f');
    b = stamp(b, A(4, `
jj
jjj
.j`), 7, 9);
    b = stamp(b, A(3, `
.d
dcd
.d`), 30, 22);
    b = stamp(b, A(5, `
.22
2222
.2.22`), 25, 26);
    const crown = A(15, `
a......a......a
ba....aba....ab
bba..abbba..abb
bbaaabb8bbaaabb
a9aa9aa9aa9aa9a
999999999999999`, 'crown');
    b = stamp(b, crown, 12, 1);
    const eyes = A(16, `
.jjj.......jjj
jjjjj.....jjjjj
jjjpp.....jjjpp
jjjpp.....jjjpp
.jjj.......jjj`, 'skeyes');
    b = stamp(b, eyes, 12, 14);
    const mouth = A(11, `
f.........f
.fffffffff`, 'skmouth');
    const base = stamp(b, mouth, 14, 22);
    const angry = A(16, `
pp..........pp
.ppp......ppp`, 'skbrow');
    const openMouth = A(11, `
.fffffffff
f777777777f
f77ttttt77f
.fffffffff`, 'skopen');
    const atk = stamp(stamp(b, angry, 12, 12), openMouth, 14, 21);
    // 二阶段：紫化 + 裂冠 + 红瞳 + 滴落
    let p2 = remap(stamp(stamp(b, angry, 12, 12), openMouth, 14, 21), parseMap('e>r,d>s,c>t,f>6'));
    p2 = stamp(p2, A(16, `
.jjj.......jjj
jjjjj.....jjjjj
jjjqq.....jjjqq
jjjq7.....jjjq7
.jjj.......jjj`), 12, 14);
    p2 = stamp(p2, A(15, `
_.............a
.p............b
..p...........b
...p.....p....b
....p...p......`), 12, 1);
    p2 = stamp(p2, A(36, `
.s..........s.............s........s
.s...........................s.....s
.............s...........s
.s`), 2, 31);
    const p2atk = remap(p2, parseMap('q>j,t>2,s>t'));
    def('boss_slime_king', bossSet(base, squash(base), atk, p2, squash(p2), p2atk));
  })();
  // —— 熔岩魔像：暗岩石块 + 熔岩裂纹；二阶段过热（裂纹白热、岩石发红、肩头燃火） ——
  (function () {
    let b = blank(40, 40);
    const rock = '654v';
    ball(b, 14, 34, 4.5, 5.5, '654v'); ball(b, 26, 34, 4.5, 5.5, '654v');
    ball(b, 5, 27, 5, 6, '654v'); ball(b, 35, 27, 5, 6, '654v');
    ball(b, 20, 21, 12, 10.5, rock);
    ball(b, 8, 14, 6.5, 6, '654v'); ball(b, 32, 14, 6.5, 6, '654v');
    ball(b, 20, 9, 6.5, 5.5, '654v');
    // 熔岩核心与裂纹
    ball(b, 20, 21, 3.5, 3.5, '9abj');
    [[17, 19, 11, 15], [23, 19, 29, 15], [18, 24, 14, 30], [22, 24, 26, 30], [20, 17, 20, 13], [6, 24, 4, 30], [34, 24, 36, 30], [9, 11, 6, 16], [31, 11, 34, 16]].forEach(l => line(b, l[0], l[1], l[2], l[3], '9'));
    b = stamp(b, A(10, `
pp....pp
bba..abb`), 16, 8);
    const base = b;
    // 攻击：拳头抬起 + 熔岩变亮
    let atk = shiftRegion(b, 18, 34, 0, -4, x => x < 10 || x > 30);
    atk = remap(atk, LIGHTER_GLOW);
    // 二阶段：岩石加热、裂纹白热、火焰
    let p2 = remap(b, parseMap('6>5,5>0,4>1,v>3,9>a,a>b,b>j'));
    [[11, 21, 6, 22], [29, 21, 34, 22], [14, 6, 26, 6], [20, 31, 20, 37]].forEach(l => line(p2, l[0], l[1], l[2], l[3], 'a'));
    const flame = A(7, `
...9
..9a.9
.9ab9a
9abba9
9abjba9
.9aba9`, 'flame');
    p2 = stamp(p2, flame, 4, 3); p2 = stamp(p2, flame, 29, 3); p2 = stamp(p2, flame, 17, -2);
    p2 = stamp(p2, A(10, `
qq....qq
jjb..bjj`), 16, 8);
    const p2atk = remap(shiftRegion(p2, 18, 34, 0, -4, x => x < 10 || x > 30), parseMap('1>3,0>1,a>b'));
    def('boss_lava_golem', bossSet(base, bob(base, 30), atk, p2, bob(p2, 30), p2atk));
  })();
  // —— 深渊之眼：紫色肉质巨眼 + 触手；二阶段血红虹膜、血丝、尖刺 ——
  (function () {
    function body(p2) {
      let b = blank(40, 40);
      const tent = p2 ? '7' : 'r', tent2 = p2 ? '8' : 's';
      [[10, 30, 6, 39], [15, 32, 13, 39], [20, 33, 20, 39], [25, 32, 27, 39], [30, 30, 34, 39]].forEach((l, i) => {
        line(b, l[0], l[1], l[2], l[3], tent); line(b, l[0] + 1, l[1], l[2] + 1, l[3] - 1, tent2);
      });
      ball(b, 20, 18, 17.5, 16, p2 ? '678t' : 'orst');
      // 顶部尖刺
      const spikes = p2 ? [[6, 6], [12, 1], [20, -1], [28, 1], [34, 6], [2, 14], [38, 14]] : [[8, 4], [20, 0], [32, 4]];
      spikes.forEach(s => { line(b, s[0], s[1] + 3, s[0], s[1], p2 ? 's' : 'r'); setPx(b, s[0] - 1, s[1] + 3, p2 ? 'r' : 'o'); setPx(b, s[0] + 1, s[1] + 3, p2 ? 'r' : 'o'); });
      ball(b, 20, 18, 12.5, 11, 'lkjj');
      return b;
    }
    function eye(b, p2, wide) {
      ball(b, 20, 18, 6.5, 6.5, p2 ? '78qt' : 'ghii');
      ball(b, 20, 18, wide ? 1.6 : 2.2, wide ? 5 : 4.5, 'pppp');
      return stamp(b, A(3, `
jj
j`), 16, 13);
    }
    const base = eye(body(false), false, false);
    const atk = remap(eye(body(false), false, true), parseMap('h>i,g>h,s>t'));
    let p2 = body(true);
    // 血丝
    [[8, 18, 13, 17], [9, 22, 14, 21], [31, 15, 27, 16], [32, 21, 27, 20], [16, 8, 18, 12], [24, 28, 22, 24]].forEach(l => line(p2, l[0], l[1], l[2], l[3], '8'));
    p2 = eye(p2, true, false);
    const p2atk = remap(eye(body(true), true, true), parseMap('q>j,8>q,t>j'));
    const lift = r => shiftRegion(shiftRegion(r, 0, 30, 0, -1), 30, 40, 1, 0);
    def('boss_abyss_eye', bossSet(base, lift(base), atk, p2, lift(p2), p2atk));
  })();

  // ====================== 武器（朝右；grip = 握点，canvas 像素，含 1px 描边偏移） ======================
  const WPN = {
    pistol: [A(12, `
.lkkkkkkkkk
.mlllllllllm
.mmmmnmmmmm
..55n.n
..445n
..445
..55`, 'pistol'), 3, 4],
    frost_wand: [A(16, `
.............ij
...........hiji
55444444444hiijh
.655555555ghih
............hg`, 'frost_wand'), 4, 2],
    shotgun: [A(18, `
......kkkkkkkkkkkk
.4....llllllllllll
433444mmmmmmmmmmmm
455555mnn5
.555..m.55
.......55`, 'shotgun'), 7, 4],
    flask_sling: [A(12, `
........ll
........kl
.......dccd
......dcbccd
4.....dccccd
34444455dde5
455555.5555
.4`, 'flask_sling'), 2, 5],
    smg: [A(14, `
...kkkkkkkk
.klllllllllllk
mmmmmmmmmmmmm
m.nnnnmn
....5..nn
...55..nn
...5...n`, 'smg'), 4, 4],
    hunter_bow: [A(11, `
..44
..k.44
..k...4
..k...v4
..k....4
..k....v4
..k....54
2222222255l
..k....54
..k....v4
..k....4
..k...v4
..k...4
..k.44
..44`, 'hunter_bow'), 7, 7],
    katana: [A(20, `
.........jjjjjjjjjj
......a.kkkkkkkkkkkj
5p5p5pallllllllllll
......a`, 'katana'), 2, 2],
    bouncer: [A(14, `
..........tt
..cccccccctjts
.cbbbbbbbcttts
.cdddddddc.ss
.cddd5ddd
...55
...5`, 'bouncer'), 3, 4],
    crossbow: [A(16, `
...........l
...........kl
..........k.l
..........k..l
44444455jjjjjjk2
4555555555k..l
.55.......k.l
..........kl
...........l`, 'crossbow'), 3, 5],
    laser: [A(18, `
....kkkkkkkk
..kjjjjjjjjjkkk
.kkllllllliiilllhi
mmmmmmmmmmmmmmmm
m..nmnn
...nm
...n`, 'laser'), 4, 4],
    rocket: [A(20, `
....dddddddddddd
..ddccccccccccccd8t
nnddeeeeeeeeeeeed878
nnde5eeeeeeeeeeed8t
..dddd5dddddd5ddd
.....55.....55
.....5`, 'rocket'), 5, 5],
    thunder_staff: [A(18, `
..............a.a
.............abba
655555555555aabjba
.66666666666aabba
..............a.a`, 'thunder_staff'), 4, 2],
    minigun: [A(20, `
.....kkkkkkkkkkkkkk
...llmmmmmmmmmmmmmml
.llkkkkkkkkkkkkkkkkk
nmmmmmmmmmmmmmmmmmm
nmlllllllllllllllll
.nmmmnnnnnnnnnnnnn
..aaa55
..aaa.5
...a`, 'minigun'), 5, 6],
    star_scatter: [A(16, `
............b
...........bjb
..rrrrrrr.bbjbb
.rssssssssbjjjb
rrrrrrrrrr.bbb
.r5.r.....b.b
.55
.5`, 'star_scatter'), 2, 6],
    dragon_breath: [A(18, `
..777
.78887
.78887mmmmmmmmm
.788875lllllllll99
.78887mmmmmmmmmm9a
.788875mm
..777.55
......5`, 'dragon_breath'), 7, 6],
    railgun: [A(23, `
.....lllllllllllllllll
...gghhhhhhhhhhhhhhhhh
nnggiiiiiiiiiiiiijjj
nnggghhhhhhhhhhhhhhhhh
..ng5ggglllllllllllllll
....55
....5`, 'railgun'), 5, 5],
    void_cannon: [A(18, `
.....oooooooo
...oonnnnnnnno.rr
..onmmmmmmmmnorssr
nnonnnnnnnnnnorpps
nnonnnnnnnnnnorpps
..onnnnnnnnnoorssr
...oo5oooooo..rr
.....55
.....5`, 'void_cannon'), 6, 7]
  };
  for (const wid in WPN) {
    def('weapon_' + wid, [WPN[wid][0]]);
    grip[wid] = [WPN[wid][1] + 1, WPN[wid][2] + 1];
  }

  // ====================== 图标（≤12x12；模板 X/Y/Z = 主色阶 暗/中/亮） ======================
  const T = {
    potion: A(12, `
.....55
.....vv
.....kl
....kjkl
...kZYYXl
..kZYYYYXl
..lYYYYYXl
..lYYYYXXl
..lXYYXXXl
...lXXXXl
....llll`, 'potion'),
    feather: A(12, `
..........Z
.........ZY
........ZYY
.......ZYYX
......ZYYX
.....ZYYX
....ZYYX
...ZYYX
..ZYXX
..YXX
.5X
5`, 'feather'),
    heart: A(11, `
.XXX...XXX
XZZYX.XYYYX
XZjYYXYYYYX
XZYYYYYYYYX
XYYYYYYYYYX
.XYYYYYYYX
..XYYYYYX
...XYYYX
....XYX
.....X`, 'heart'),
    shield: A(10, `
XXXXXXXXXX
XZZZZYYYYX
XZYYYYYYYX
XZYYYaYYYX
XZYYaaaYYX
XYYYYaYYXX
.XYYYYYYX
.XYYYYYXX
..XYYYXX
...XXX`, 'shield'),
    magnet: A(10, `
.kkk..kkk
.klk..klk
.XZX..XZX
.XYX..XYX
.XYX..XYX
.XYXXXXYX
.XYYYYYYX
..XYYYYX
...XXXX`, 'magnet'),
    bullet: A(8, `
....ZZ
...ZZYX
...ZYYX
..ZYYYYX
..baaaa9
..baaa99
..baaa99
..baaa99
..b99999
..999999`, 'bullet'),
    dice: A(10, `
.kkkkkkkk
kjjjjjjjjl
kjXXjjjjjl
kjXXjjjjjl
kjjjjXXjjl
kjjjjXXjjl
kjjjjjjXXl
kjjjjjjXXl
klllllllll
.mmmmmmmm`, 'dice'),
    orb: A(10, `
...XXXX
..XYYYYX
.XZjYYYYX
.XZYYYYYX
.XYYYYYYX
.XYYYYYXX
..XXYXXX
...XXXX`, 'orb'),
    shard: A(10, `
......Z
.....ZYX
.....ZYX
....ZYYXX
....ZjYX
...ZZYYXX
...ZYYYX
..ZZYYXX
..ZYYYX
...ZYXX
....ZX`, 'shard'),
    drop: A(10, `
.....Z
....ZY
....ZYX
...ZYYX
..ZYYYYX
.ZjYYYYYX
.ZYYYYYYX
.ZYYYYYXX
..XYYYXX
...XXXX`, 'drop'),
    split: A(11, `
........ZZ
.......ZYX
......ZYX
.ZZYYYYX
.ZYYYYYX
......ZYX
.......ZYX
........ZX`, 'split'),
    tip: A(11, `
......Z
......ZZ
......ZYZ
5555555YYYZ
4444444YYYX
......XYX
......XX
......X`, 'tip'),
    ball: A(10, `
...XXXX
..XZZYYX
.XZjYYYYX
.XYYYYYYX
.kkkkkkkk
.XYYYYYYX
..XYYYYX
...XXXX`, 'ball'),
    chip: A(11, `
..l.l.l.l
.XXXXXXXXX
lXZZZYYYYXl
.XZiiiiiYX
lXZippipYXl
.XYiiiiiYX
lXYYYYYYXXl
.XXXXXXXXX
..l.l.l.l`, 'chip'),
    fang: A(10, `
2222222
u22222u
.u222u
.u22u..Z
..u2u.ZY
..u2..XY
...u...X`, 'fang'),
    mail: A(11, `
.k.XXXXX.k
XZXZZYYYXYX
XZZYYYYYYYX
.XZYYkYYYX
.XZYkkkYYX
.XYYYkYYYX
.XYYYYYYXX
..XXXXXXX`, 'mail'),
    boots: A(11, `
..XXXX
..XZYX
..XZYX
..XZYX
..XZYYXX
..XZYYYYXX
..XYYYYYYYX
..XXXXXXXXX`, 'boots'),
    hourglass: A(10, `
5555555555
.kjjjjjjl
.kbbbbbbl
..kbbbbl
...kbl
...kbl
..kjbbbl
.kjbbbbbl
.kbbbbbbl
5555555555`, 'hourglass'),
    eye: A(12, `
...XXXXXX
.XXjjjjjjXX
XjjjYYYjjjjX
XjjYYppYjjjX
XjjjYYYjjjX
.XXjjjjjjXX
...XXXXXX`, 'eye'),
    crown: A(10, `
Z...Z...Z
ZY.ZYZ.ZY
ZYYZY8YZYY
ZYYYYYYYYX
XY8YY8YY8X
XXXXXXXXXX`, 'crown'),
    barrel: A(11, `
.......X.X
mmmmmm..X.X
ZZZZZY.X.X
YYYYYX.X.X
mmmmmm..X.X
.......X.X`, 'barrel'),
    mark: A(10, `
....XX
..XX..XX
.X..XX..X
.X..XX..X
X.XXYYXX.X
X.XXYYXX.X
.X..XX..X
.X..XX..X
..XX..XX
....XX`, 'mark'),
    battery: A(8, `
...kk
.XXXXXX
.XZYbYX
.XZbYYX
.XbbbbX
.XZYbYX
.XZbYYX
.XZYYYX
.XXXXXX`, 'battery'),
    idol: A(10, `
...XXXX
..XZZYYX
..XZpYpX
..XZYYYX
..XZY8YX
...XYYX
..XXZYXX
.XZZYYYYX
.XXXXXXXX`, 'idol'),
    scroll: A(10, `
.2222222u
2uuuuuuu2v
.2rrrr.2
.2.rr..2
.2rrrrr2
.2..8..2
.2.888.2
v2222222u`, 'scroll'),
    spring: A(10, `
.lkkkkkkl
..m....m
.lkkkkkkl
..m....m
.lkkkkkkl
..m....m
.lkkkkkkl
..9999`, 'spring'),
    storm: A(11, `
ZY....ZY
..........
...ZY....ZY
.......
ZY...ZY
.........
...ZY...ZY
ZY`, 'storm'),
    flame: A(8, `
....Z
...ZY
..ZYY.Z
.ZYYYZY
.ZYbbYY
ZYbbjbYX
ZYbjjbYX
.XYbbYX
..XXXX`, 'flame'),
    snow: A(11, `
.....i
..i..i..i
...i.i.i
....iji
iiiijjjiiii
....iji
...i.i.i
..i..i..i
.....i`, 'snow'),
    skull: A(10, `
..XXXXXX
.XZZYYYYX
XZYYYYYYYX
XZppYYppYX
XZppYYppYX
XYYYYpYYYX
.XYYYYYYX
..XYXYXYX
..XXXXXX`, 'skull')
  };
  const RAMP = { red: '78t', orange: '09a', gold: '9ab', green: 'edc', toxic: 'dcb', blue: 'ghi', ice: 'hij', purple: 'rst', grey: 'mlk', silver: 'lkj', brown: '54v', dark: 'nml', pink: '8tu', void: 'prs', empty: 'pon' };
  function tint(tpl, ramp) { const r = RAMP[ramp] || ramp; return remap(tpl, { X: r[0], Y: r[1], Z: r[2] }); }
  function icon(name, tpl, ramp, extras) {
    let r = tint(tpl, ramp);
    (extras || []).forEach(e => { r = stamp(r, e[0], e[1], e[2]); });
    def(name, [r]);
    return r;
  }
  const spark = A(3, `
.b
bjb
.b`), tinyFlame = A(4, `
.9
.a9
9ab9
.99`), ring = A(12, `
.kk......kk
k..........k
.kk......kk`);
  // 遗物
  icon('icon_power_potion', T.potion, 'red');
  icon('icon_trigger_spring', T.spring, 'grey');
  icon('icon_swift_feather', T.feather, 'ice');
  icon('icon_heart_vessel', T.heart, 'red', [[A(3, `
kk
k`), 1, 1]]);
  icon('icon_iron_skin', T.shield, 'grey');
  icon('icon_coin_magnet', T.magnet, 'red', [[A(3, `
.a
aba
.a`), 4, 8]]);
  icon('icon_big_bullets', T.bullet, 'grey');
  icon('icon_lucky_dice', T.dice, 'red');
  icon('icon_ember_core', T.orb, 'orange', [[tinyFlame, 3, 0]]);
  icon('icon_frost_shard', T.shard, 'ice');
  icon('icon_venom_gland', T.drop, 'green');
  icon('icon_split_shot', T.split, 'gold');
  icon('icon_pierce_tip', T.tip, 'silver');
  icon('icon_rubber_rounds', T.ball, 'pink');
  icon('icon_homing_chip', T.chip, 'green');
  icon('icon_vampire_fang', T.fang, 'red');
  icon('icon_thorn_mail', T.mail, 'brown');
  icon('icon_fire_boots', T.boots, 'red', [[tinyFlame, 7, 0]]);
  icon('icon_hourglass', T.hourglass, 'gold');
  icon('icon_sharp_eye', T.eye, 'gold');
  icon('icon_ice_heart', T.heart, 'ice');
  icon('icon_explosive_rounds', T.bullet, 'red', [[spark, 0, 0]]);
  icon('icon_echo_barrel', T.barrel, 'silver');
  icon('icon_guardian_orb', T.orb, 'blue', [[ring, -1, 3]]);
  icon('icon_plague_flask', T.potion, 'toxic', [[A(3, `
p.p
.p`), 4, 6]]);
  icon('icon_assassin_mark', T.mark, 'red');
  icon('icon_energy_battery', T.battery, 'blue');
  icon('icon_phoenix_feather', T.feather, 'orange', [[tinyFlame, 0, 0]]);
  icon('icon_glacier_crown', T.crown, 'ice', [[A(10, `
.....
....h....h
..h....h`), 0, 3]]);
  icon('icon_inferno_heart', T.heart, 'orange', [[tinyFlame, 7, -1]]);
  icon('icon_bullet_storm', T.storm, 'gold', [[spark, 7, 3]]);
  icon('icon_golden_idol', T.idol, 'gold');
  icon('icon_abyss_contract', T.scroll, 'purple');
  icon('icon_toxic_crown', T.crown, 'toxic', [[A(3, `
p.p`), 3, 3]]);
  // 协同系
  icon('icon_family_fire', T.flame, 'orange');
  icon('icon_family_frost', T.snow, 'ice');
  icon('icon_family_barrage', T.storm, 'gold', [[A(5, `
.....
bbaa9`), 3, 7]]);
  icon('icon_family_crit', T.mark, 'gold');
  icon('icon_family_aegis', T.shield, 'blue');
  icon('icon_family_toxic', T.skull, 'toxic');
  // 主动道具
  icon('icon_active_bomb', A(10, `
.......a
......b
.....5
...XXXX
..XZYYXX
.XZjYYYXX
.XZYYYYXX
.XYYYYYXX
.XXYYYXXX
..XXXXXX`, 'bomb'), 'dark');
  icon('icon_active_stopwatch', A(11, `
.....aa
......a
...aaaaaa
..akjjjjka
.akjjpjjjka
.akjjpjjjka
.akjjjppjka
.akjjjjjjka
..akjjjjka
...aaaaaa`, 'stopwatch'), 'gold');
  icon('icon_active_medkit', A(11, `
....llll
...l....l
.jjjjjjjjjj
.jjjj88jjjk
.jjj8888jjk
.jjj8888jjk
.jjjj88jjjk
.kkkkkkkkkk`, 'medkit'), 'red');
  icon('icon_active_barrier', A(11, `
...hhhhhh
..hiiiiiih
.hiijjiiiih
.hijiiiiigh
.hiiiiiiigh
.hiiiiiiggh
..hiiiiggh
...hhhhhh`, 'barrier'), 'blue');
  const droneArt = icon('icon_active_drone', A(12, `
lllll.lllll
..k.....k
..mmmmmmm
.mlkkkkklm
.mlpiiippm
.mlllllllm
..m.m.m.m`, 'drone'), 'grey');
  def('drone', { 0: droneArt, 1: ['..lll...lll.'].concat(droneArt.slice(1)) });

  // ====================== 地砖（20x20，无描边，可无缝平铺） ======================
  const THEME = {
    // lead 调整：地面整体提亮一阶（提高实体与弹幕对比），墙改为与地面不同的色相/更暗的立面
    moss: { b: 'm', l: 'l', d: 'n', acc: ['e', 'd', 'c'], peb: 'k', wt: 'd', wtl: 'c', wtd: 'e', wf: 'e', wfl: 'd', wfd: 'f', wfs: 'p', drip: 'c', bt: 'n', btl: 'm', btd: 'o', bf: 'o', bfd: 'p', mark: 'c' },
    lava: { b: '5', l: '4', d: '6', acc: ['7', '0', '9'], peb: 'v', wt: '6', wtl: '5', wtd: 'p', wf: 'o', wfl: 'n', wfd: 'p', wfs: 'p', drip: '9', bt: '6', btl: '5', btd: 'p', bf: 'o', bfd: 'p', mark: '9' },
    abyss: { b: 'n', l: 'm', d: 'o', acc: ['r', 's', 'i'], peb: 'l', wt: 'r', wtl: 's', wtd: '6', wf: 'o', wfl: 'n', wfd: 'p', wfs: 'p', drip: 's', bt: 'o', btl: 'n', btd: 'p', bf: 'p', bfd: 'p', mark: 'i' }
  };
  function floorTile(th, v, seed) {
    const P = THEME[th], r = blank(20, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      // 2x2 石板，变体 1/3 上排为一整块长石板
      const big = (v === 1 || v === 3) && y < 10;
      const mort = (y % 10 === 0) || (!big && x % 10 === 0) || (big && x === 0);
      let c = P.b;
      if (mort) c = P.d;
      else if (y % 10 === 1 || (!big && x % 10 === 1) || (big && x === 1)) c = P.l;
      // 每块石板轻微明暗差异
      const slab = (big ? 0 : (x / 10 | 0)) + (y / 10 | 0) * 2;
      if (!mort && c === P.b && hash(seed, slab, v) < 0.3 && (x + y) % 2 === 0) c = P.l;
      setPx(r, x, y, c);
    }
    // 点缀：裂纹 / 苔藓或熔岩或符文 / 碎石
    const n = [0, 3, 6, 4][v];
    for (let i = 0; i < n; i++) {
      const x = 2 + Math.floor(hash(seed, i, v * 7 + 1) * 16), y = 2 + Math.floor(hash(seed, i, v * 7 + 2) * 16);
      if (getPx(r, x, y) === P.d) continue;
      const k = hash(seed, i, v * 7 + 3);
      if (v === 1) { setPx(r, x, y, P.d); setPx(r, x + 1, y + 1, P.d); setPx(r, x + 1, y + 2, P.d); }
      else if (k < 0.6) { setPx(r, x, y, P.acc[0]); setPx(r, x + 1, y, P.acc[1]); setPx(r, x, y - 1, P.acc[i % 2 ? 1 : 2]); }
      else { setPx(r, x, y, P.peb); setPx(r, x + 1, y + 1, P.d); }
    }
    return r;
  }
  function brickRows(r, P, y0, y1, base, light, mort) {
    for (let y = y0; y < y1; y++) for (let x = 0; x < 20; x++) {
      const row = Math.floor((y - y0) / 5), off = row % 2 ? 5 : 0;
      const yy = (y - y0) % 5, xx = (x + off) % 10;
      let c = base;
      if (yy === 4 || xx === 0) c = mort; else if (yy === 0 || xx === 1) c = light;
      setPx(r, x, y, c);
    }
  }
  for (const th in THEME) {
    const P = THEME[th], seed = th.length * 31 + th.charCodeAt(0);
    def('tile_' + th + '_floor', { 0: floorTile(th, 0, seed), 1: floorTile(th, 1, seed), 2: floorTile(th, 2, seed), 3: floorTile(th, 3, seed) }, { ol: false, anchor: 'topleft' });
    // 墙顶面
    const wt = blank(20, 20);
    brickRows(wt, { }, 0, 20, P.wt, P.wtl, P.wtd);
    for (let i = 0; i < 5; i++) setPx(wt, Math.floor(hash(seed, i, 50) * 20), Math.floor(hash(seed, i, 51) * 20), P.wtl);
    def('tile_' + th + '_wall', [wt], { ol: false, anchor: 'topleft' });
    // 墙立面：上沿 5px 顶面 + 1px 阴影 + 砖立面
    const wf = blank(20, 20);
    brickRows(wf, {}, 0, 5, P.wt, P.wtl, P.wtd);
    rect(wf, 0, 4, 20, 1, P.wtd); rect(wf, 0, 5, 20, 1, P.wfs);
    brickRows(wf, {}, 6, 20, P.wf, P.wfl, P.wfd);
    rect(wf, 0, 19, 20, 1, P.wfs);
    for (let i = 0; i < 3; i++) { const x = 2 + Math.floor(hash(seed, i, 60) * 16), len = 1 + Math.floor(hash(seed, i, 61) * 4); for (let k = 0; k < len; k++) setPx(wf, x, 6 + k, P.drip); }
    def('tile_' + th + '_wallface', [wf], { ol: false, anchor: 'topleft' });
    // 障碍块：顶面 + 正面 + 暗边
    const bk = blank(20, 20);
    rect(bk, 1, 1, 18, 12, P.bt); rect(bk, 1, 1, 18, 1, P.btl); rect(bk, 1, 1, 1, 12, P.btl);
    rect(bk, 18, 2, 1, 11, P.btd); rect(bk, 3, 3, 14, 8, P.bt);
    line(bk, 4, 4, 15, 4, P.btl); line(bk, 4, 4, 4, 9, P.btl); line(bk, 5, 10, 16, 10, P.btd); line(bk, 16, 5, 16, 10, P.btd);
    rect(bk, 1, 13, 18, 6, P.bf); rect(bk, 1, 13, 18, 1, P.btd); rect(bk, 1, 18, 18, 1, P.bfd);
    for (let x = 4; x < 18; x += 5) rect(bk, x, 14, 1, 4, P.bfd);
    setPx(bk, 9, 7, P.mark); setPx(bk, 10, 7, P.mark); setPx(bk, 9, 6, P.mark);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (x === 0 || x === 19 || y === 0 || y === 19) setPx(bk, x, y, 'p');
    def('tile_' + th + '_block', [bk], { ol: false, anchor: 'topleft' });
  }
  // 门（上门方向；其他方向由 render 旋转）
  (function () {
    const frame = blank(20, 20);
    brickRows(frame, {}, 0, 20, 'm', 'l', 'n');
    rect(frame, 4, 3, 12, 17, 'p');
    rect(frame, 3, 2, 14, 1, 'k'); rect(frame, 3, 2, 1, 18, 'l'); rect(frame, 16, 2, 1, 18, 'n');
    const open = frame.slice();
    for (let y = 3; y < 20; y++) rect(open, 4, y, 12, 1, y < 9 ? 'p' : y < 15 ? 'o' : 'n');
    def('door_open', [open], { ol: false, anchor: 'topleft' });
    const lock = frame.slice();
    rect(lock, 4, 3, 12, 17, 'o');
    for (let x = 5; x < 16; x += 3) { rect(lock, x, 3, 2, 17, 'm'); rect(lock, x, 3, 1, 17, 'l'); }
    rect(lock, 4, 7, 12, 2, 'n'); rect(lock, 4, 15, 12, 2, 'n');
    rect(lock, 4, 7, 12, 1, 'l'); rect(lock, 4, 15, 12, 1, 'l');
    const seal = A(6, `
.q88q
q8tt8q
8tjjt8
q8tt8q
.q88q`);
    def('door_locked', [stamp(lock, seal, 7, 9)], { ol: false, anchor: 'topleft' });
  })();

  // ====================== 道具 / 拾取物 / 交互物 ======================
  // 圆柱着色（左亮右暗）
  function cyl(w, h, ramp) {
    const r = blank(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = (x + 0.5) / w;
      setPx(r, x, y, ramp[t < 0.25 ? 2 : t < 0.7 ? 1 : 0]);
    }
    return r;
  }
  (function () {
    // 木箱
    const cr = blank(16, 16);
    rect(cr, 0, 0, 16, 16, '4');
    for (let y = 0; y < 16; y += 5) rect(cr, 0, y, 16, 1, '5');
    rect(cr, 0, 0, 16, 1, 'v'); rect(cr, 0, 0, 1, 16, 'v');
    line(cr, 2, 13, 13, 2, 'v'); line(cr, 3, 13, 13, 3, '5');
    rect(cr, 0, 15, 16, 1, '6'); rect(cr, 15, 0, 1, 16, '6');
    [[1, 1], [14, 1], [1, 14], [14, 14]].forEach(p => setPx(cr, p[0], p[1], 'l'));
    const crBroken = remap(stamp(cr, A(16, `
.......____
......__.___
..........__
_
__
`), 0, 0), parseMap('v>4'));
    def('prop_crate', { 0: cr, broken: crBroken });
    // 爆炸桶
    let br = cyl(14, 16, '78t');
    rect(br, 0, 0, 14, 2, '7'); rect(br, 2, 0, 10, 1, '6'); setPx(br, 9, 0, 'p'); setPx(br, 10, 0, 'p');
    br = stamp(br, cyl(14, 1, 'mlk'), 0, 3); br = stamp(br, cyl(14, 1, 'mlk'), 0, 13);
    br = stamp(br, A(7, `
...b
..bpb
.bbpbb
bbbbbbb
...p`), 4, 6);
    const brB = stamp(br, A(14, `
______
____......___
__
_
`), 0, 0);
    def('prop_barrel', { 0: br, broken: brB });
    // 金币（4 帧旋转）
    const coin0 = A(8, `
..9999
.9baaa9
9bjaaaa9
9baa9aa9
9baa9aa9
9baaaaa9
.9aaaa9
..9999`, 'coin');
    const coin1 = A(8, `
...99
..9ba9
..bja9
..ba99
..ba99
..baa9
..9aa9
...99`), coin2 = A(8, `
...9
...a
...b
...a
...a
...a
...9
...9`);
    def('item_coin', [coin0, coin1, coin2, flipH(coin1)]);
    def('ui_coin', [coin0]);
    def('item_heart', [tint(T.heart, 'red')]);
    def('item_armor', [tint(T.mail, 'grey')]);
    const orb = tint(T.orb, 'blue');
    def('item_energy', [orb, remap(orb, LIGHTER)]);
    // 宝箱
    const chest = A(16, `
..666666666666
.6vvvvvvvvvvvv6
6vv4a444444a4446
644aa444444aa446
6aaaaaab9aaaaaa6
65555aabja555556
645555a99a555546
6455555555555546
64a5555555555a46
64a5555555555a46
6555555555555556
.66666666666666`, 'chest');
    def('item_chest', [chest]);
    const chestOpen = A(16, `
...b.....b
.b...j.....b
..6666666666666
.6pppppppppppp6
6paaabbbbaaaaap6
6aaaaaaaaaaaaaa6
65555aa99a555556
645555a99a555546
6455555555555546
64a5555555555a46
64a5555555555a46
6555555555555556
.66666666666666`, 'chest_open');
    def('item_chest_open', [chestOpen]);
    // 传送门：椭圆螺旋（4 帧）
    const pf = [];
    for (let f = 0; f < 4; f++) {
      const r = blank(24, 28);
      for (let y = 0; y < 28; y++) for (let x = 0; x < 24; x++) {
        const nx = (x + 0.5 - 12) / 11, ny = (y + 0.5 - 14) / 13.5, d = Math.sqrt(nx * nx + ny * ny);
        if (d > 1) continue;
        if (d > 0.86) { setPx(r, x, y, (Math.atan2(ny, nx) * 4 / Math.PI + f) % 2 < 1 ? 's' : 'r'); continue; }
        const s = Math.sin(Math.atan2(ny, nx) * 2 + d * 9 - f * Math.PI / 2);
        setPx(r, x, y, d < 0.18 ? 'j' : s > 0.55 ? 'i' : s > 0 ? 's' : d < 0.5 ? 'r' : 'o');
      }
      pf.push(r);
    }
    def('item_portal', pf);
    // 商店货架（条纹遮阳篷 + 木台）
    const st = blank(20, 16);
    for (let x = 0; x < 20; x++) for (let y = 0; y < 4; y++) setPx(st, x, y, (x >> 2) % 2 ? '2' : '8');
    for (let x = 0; x < 20; x += 4) { setPx(st, x + 1, 4, '8'); setPx(st, x + 2, 4, '8'); }
    for (let x = 0; x < 20; x++) setPx(st, x, 0, (x >> 2) % 2 ? 'u' : '7');
    rect(st, 1, 4, 1, 12, '5'); rect(st, 18, 4, 1, 12, '5');
    rect(st, 0, 10, 20, 2, 'v'); rect(st, 0, 12, 20, 1, '5'); rect(st, 0, 13, 20, 1, '6');
    rect(st, 2, 14, 2, 2, '5'); rect(st, 16, 14, 2, 2, '5');
    def('shop_stand', [st]);
    // 商人
    def('shopkeeper', charSetLite(A(14, `
.....5555
....544445
...5444v445
...54uuuu45
..54upuupu45
..54uu33uu45
...4kkkkkk4
..5kkjkkjkk5
.54kkkkkkkk45
.544aakkaa445
.5444a44a4445
.544444444445
..5555555555
...6.....6`, 'shopkeeper')));
    // 祭坛
    const altarBase = A(18, `
..kkkkkkkkkkkkkk
.lkkkkkkkkkkkkkkm
.mlllllllllllllmn
..mmmmmmmmmmmmnn
..mlmmmmmmmmmmnn
..mlmmmssmmmmmnn
..mlmmsmmsmmmmnn
..mlmmmssmmmmmnn
..mlmmmmmmmmmmnn
.nnnnnnnnnnnnnnnn`, 'altar');
    const blood = A(18, `
.......8
......8t8
.....878.8
....7888887
...l7777777l
...kllllllll
....k888.8l
.......8
.......8`, 'blood');
    const gold = A(18, `
........b
.......bjb
.....9aab9
....9abaaab9
...9aaab9aa9a
..9abaa9aab9a9
...9999999999`, 'gold');
    def('altar_blood', [blood.concat(altarBase)]);
    def('altar_gold', [gold.concat(altarBase)]);
    // UI 图标
    const heartR = tint(T.heart, 'red'), heartE = remap(tint(T.heart, 'empty'), { j: 'n' });
    def('ui_heart_full', [heartR]);
    def('ui_heart_half', [heartR.map((row, y) => row.substr(0, 6) + heartE[y].substr(6))]);
    def('ui_heart_empty', [heartE]);
    def('ui_shield', [remap(tint(T.shield, 'silver'), { a: 'l' })]);
    def('ui_shield_empty', [remap(tint(T.shield, 'empty'), { a: 'n' })]);
    def('ui_armor', [remap(tint(T.mail, 'grey'), { k: 'h' })]);
    def('ui_energy', [tint(T.shard, 'blue')]);
    def('ui_crystal', [A(10, `
..rrrrrr
.rtjtssrr
rtjttssssr
.rttsssrr
..rtssrr
...rssr
....rr`, 'crystal')]);
    def('ui_skull', [tint(T.skull, 'silver')]);
    def('ui_chest', [A(13, `
.6666666666
6vv4a44a4v46
644aa44aa446
6aaaabjaaaa6
6555aa9a5556
64a555555a46
6555555555556`, 'uichest')]);
    def('ui_shop', [A(10, `
...5..5
....55
...4444
..4vvvv4
.4vvaav44
.4vabbv44
4vvaavv444
4vvvvvv444
.44444444`, 'bag')]);
    def('ui_altar', [A(12, `
.....9
....9a9
....abb
...9abja
..kkkkkkkk
.lkkkkkkkkm
..mmmssmmn
..mmsmmsmn
..mmmssmmn
.nnnnnnnnnn`, 'uialtar')]);
    def('ui_star', [A(11, `
.....a
....aba
....aba
aaaabbbaaaa
.abbbjbbba
..abbbbba
..abbbbba
.abba.abba
.aa.....aa`, 'star')]);
  })();
  // 商人/NPC：只需待机两帧
  function charSetLite(base) { return { idle0: base, idle1: bob(base, base.length - 1) }; }

  // @@CONTENT_END@@ —— 以上为内容定义；以下为运行时 API

  // ---------- REQUIRED 清单（ARCH §11/§12） ----------
  const CHARS = ['ranger', 'mage', 'knight', 'alchemist'];
  const ENEMIES = ['slime', 'slimelet', 'boar', 'archer', 'shroom', 'bat', 'guard', 'imp', 'mole', 'turret', 'toad', 'shaman', 'wraith', 'priest', 'sniper', 'abyss_knight'];
  const BOSSES = ['slime_king', 'lava_golem', 'abyss_eye'];
  const WEAPONS = ['pistol', 'frost_wand', 'shotgun', 'flask_sling', 'smg', 'hunter_bow', 'katana', 'bouncer', 'crossbow', 'laser', 'rocket', 'thunder_staff', 'minigun', 'star_scatter', 'dragon_breath', 'railgun', 'void_cannon'];
  const RELICS = ['power_potion', 'trigger_spring', 'swift_feather', 'heart_vessel', 'iron_skin', 'coin_magnet', 'big_bullets', 'lucky_dice', 'ember_core', 'frost_shard', 'venom_gland', 'split_shot',
    'pierce_tip', 'rubber_rounds', 'homing_chip', 'vampire_fang', 'thorn_mail', 'fire_boots', 'hourglass', 'sharp_eye', 'ice_heart',
    'explosive_rounds', 'echo_barrel', 'guardian_orb', 'plague_flask', 'assassin_mark', 'energy_battery',
    'phoenix_feather', 'glacier_crown', 'inferno_heart', 'bullet_storm', 'golden_idol', 'abyss_contract', 'toxic_crown'];
  const FAMILIES = ['fire', 'frost', 'barrage', 'crit', 'aegis', 'toxic'];
  const ACTIVES = ['bomb', 'stopwatch', 'medkit', 'barrier', 'drone'];
  const THEMES = ['moss', 'lava', 'abyss'];
  const FR_CHAR = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'hurt', 'roll'];
  const FR_EN = ['idle0', 'idle1', 'walk0', 'walk1', 'hurt', 'atk'];
  const FR_BOSS = ['idle0', 'idle1', 'atk', 'hurt', 'p2_idle0', 'p2_idle1'];
  const REQUIRED = [];   // [name, [frames...]|null]
  CHARS.forEach(c => REQUIRED.push(['char_' + c, FR_CHAR]));
  ENEMIES.forEach(e => REQUIRED.push(['enemy_' + e, FR_EN]));
  BOSSES.forEach(b => REQUIRED.push(['boss_' + b, FR_BOSS]));
  WEAPONS.forEach(w => REQUIRED.push(['weapon_' + w, null]));
  RELICS.forEach(r => REQUIRED.push(['icon_' + r, null]));
  FAMILIES.forEach(f => REQUIRED.push(['icon_family_' + f, null]));
  ACTIVES.forEach(a => REQUIRED.push(['icon_active_' + a, null]));
  THEMES.forEach(t => {
    REQUIRED.push(['tile_' + t + '_floor', ['0', '1', '2', '3']]);
    ['wall', 'wallface', 'block'].forEach(k => REQUIRED.push(['tile_' + t + '_' + k, null]));
  });
  ['door_open', 'door_locked', 'prop_crate', 'prop_barrel', 'item_coin', 'item_heart', 'item_armor', 'item_energy', 'item_chest', 'item_chest_open', 'item_portal',
    'shop_stand', 'shopkeeper', 'altar_blood', 'altar_gold',
    'ui_heart_full', 'ui_heart_half', 'ui_heart_empty', 'ui_shield', 'ui_shield_empty', 'ui_armor', 'ui_energy', 'ui_coin', 'ui_crystal', 'ui_skull', 'ui_chest', 'ui_shop', 'ui_altar', 'ui_star'
  ].forEach(n => REQUIRED.push([n, null]));

  // ---------- 运行时：预渲染与缓存 ----------
  const cache = {};          // key -> canvas
  let missing = null;
  function hasDoc() { return typeof document !== 'undefined' && document && typeof document.createElement === 'function'; }
  function resolveFrame(d, frame, strict) {
    if (frame === undefined || frame === null) return d.order[0];
    if (typeof frame === 'number') { const n = d.order.length; return d.order[(((frame | 0) % n) + n) % n]; }
    frame = String(frame);
    if (d.frames[frame]) return frame;
    if (strict) return null;
    // 回退：walk3 → 同前缀帧取模；p2_xxx → xxx；否则第 0 帧
    const m = /^(.*?)(\d+)$/.exec(frame);
    if (m) {
      const same = d.order.filter(f => f.replace(/\d+$/, '') === m[1] && /\d$/.test(f));
      if (same.length) return same[(+m[2]) % same.length];
    }
    if (frame.indexOf('p2_') === 0) return resolveFrame(d, frame.substr(3), false);
    return d.order[0];
  }
  function finalRows(name, fname) {
    const d = DEFS[name];
    const rows = d.frames[fname];
    return d.ol ? outline(rows) : rows;
  }
  function toCanvas(rows, color) {
    const h = rows.length, w = W(rows);
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    const x = c.getContext('2d');
    const img = x.createImageData(c.width, c.height);
    const rgb = PAL.map(hx => [parseInt(hx.substr(1, 2), 16), parseInt(hx.substr(3, 2), 16), parseInt(hx.substr(5, 2), 16)]);
    let solid = null;
    if (color) solid = [parseInt(color.substr(1, 2), 16), parseInt(color.substr(3, 2), 16), parseInt(color.substr(5, 2), 16)];
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
      const ch = rows[y][i];
      if (ch === '.') continue;
      const k = CH.indexOf(ch);
      if (k < 0) continue;
      const p = (y * w + i) * 4, c3 = solid || rgb[k];
      img.data[p] = c3[0]; img.data[p + 1] = c3[1]; img.data[p + 2] = c3[2]; img.data[p + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  function normHex(c) {
    if (typeof c !== 'string') return '#ffffff';
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
    return '#ffffff';
  }
  function getC(name, frame, color, strict) {
    const d = DEFS[name];
    if (!d || !hasDoc()) return null;
    const fname = resolveFrame(d, frame, strict);
    if (fname === null) return null;
    const key = name + '|' + fname + (color ? '|' + color : '');
    let c = cache[key];
    if (!c) {
      c = toCanvas(finalRows(name, fname), color);
      cache[key] = c;
    }
    return c;
  }
  function missingCanvas() {
    if (!missing && hasDoc()) {
      missing = document.createElement('canvas'); missing.width = 10; missing.height = 10;
      const x = missing.getContext('2d');
      x.fillStyle = '#181425'; x.fillRect(0, 0, 10, 10);
      x.fillStyle = '#ff00ff'; x.fillRect(1, 1, 8, 8);
      x.fillStyle = '#181425'; x.fillRect(4, 4, 2, 2);
    }
    return missing;
  }
  function anchorOf(name, c, anchor) {
    const d = DEFS[name];
    const a = anchor !== undefined ? anchor : (d ? d.anchor : 'center');
    if (Array.isArray(a)) return a;
    if (a === 'feet' && d) {
      // 底部不透明行的下沿中点
      return [c.width / 2, feetRow(name) + 1];
    }
    if (a === 'topleft') return [0, 0];
    return [c.width / 2, c.height / 2];
  }
  const feetCache = {};
  function feetRow(name) {
    if (feetCache[name] !== undefined) return feetCache[name];
    const d = DEFS[name];
    const rows = finalRows(name, d.order[0]);
    let y = rows.length - 1;
    while (y > 0 && !/[^.]/.test(rows[y])) y--;
    feetCache[name] = y;
    return y;
  }

  G.Sprites = {
    REQUIRED: REQUIRED,
    LISTS: { CHARS, ENEMIES, BOSSES, WEAPONS, RELICS, FAMILIES, ACTIVES, THEMES },
    grip: grip,
    ERRORS: ERRORS,
    _defs: DEFS,
    _util: { outline, remap, A, HURT },
    init() {
      if (!hasDoc()) return;
      try {
        for (const n in DEFS) DEFS[n].order.forEach(f => getC(n, f));
        missingCanvas();
      } catch (e) { if (G.reportError) G.reportError(e); }
    },
    has(name, frame) {
      const d = DEFS[name];
      if (!d) return false;
      if (frame === undefined || frame === null || typeof frame === 'number') return true;
      return !!d.frames[String(frame)];
    },
    frames(name) { const d = DEFS[name]; return d ? d.order.slice() : []; },
    size(name) { const d = DEFS[name]; if (!d) return [0, 0]; const r = d.frames[d.order[0]]; return [W(r), r.length]; },
    list() { return Object.keys(DEFS); },
    // 精灵不存在或命名帧不存在 → null（数字帧取模，总存在）
    get(name, frame) { try { return getC(name, frame, null, true); } catch (e) { return null; } },
    // 白剪影/纯色剪影
    silhouette(name, frame, color) { try { return getC(name, frame, normHex(color || '#ffffff'), false); } catch (e) { return null; } },
    // o={scale, flip, flipY, rot, alpha, flash, outline:'#hex', anchor:'center'|'feet'|'topleft'|[ax,ay](canvas 像素), tint:'#hex', tintA}
    draw(ctx, name, frame, x, y, o) {
      if (!ctx) return;
      o = o || {};
      try {
        let c = getC(name, frame, null, false);
        const known = !!c;
        if (!c) c = missingCanvas();
        if (!c) return;
        const s = o.scale || G.PX || 2;
        const an = known ? anchorOf(name, c, o.anchor) : [c.width / 2, c.height / 2];
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(Math.round(x / 2) * 2, Math.round(y / 2) * 2);
        if (o.rot) ctx.rotate(o.rot);
        ctx.scale(o.flip ? -s : s, o.flipY ? -s : s);
        if (o.alpha !== undefined && o.alpha !== null) ctx.globalAlpha *= Math.max(0, Math.min(1, o.alpha));
        const ax = -an[0], ay = -an[1];
        if (known && o.outline) {
          const sil = getC(name, frame, normHex(o.outline), false);
          if (sil) { ctx.drawImage(sil, ax - 1, ay); ctx.drawImage(sil, ax + 1, ay); ctx.drawImage(sil, ax, ay - 1); ctx.drawImage(sil, ax, ay + 1); }
        }
        if (known && o.flash) {
          ctx.drawImage(getC(name, frame, '#ffffff', false), ax, ay);
        } else {
          ctx.drawImage(c, ax, ay);
          if (known && o.tint) {
            const t = getC(name, frame, normHex(o.tint), false);
            if (t) { ctx.globalAlpha *= (o.tintA !== undefined ? o.tintA : 0.5); ctx.drawImage(t, ax, ay); }
          }
        }
        ctx.restore();
      } catch (e) {
        try { ctx.restore(); } catch (e2) { /* ignore */ }
        if (G.reportError) G.reportError(e);
      }
    }
  };
})(window.Game = window.Game || {});

