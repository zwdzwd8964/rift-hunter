// 世界：楼层生成（纯函数）、房间瓦片与道具、碰撞、placeFree、视线、房间切换、刷怪。模拟层。
(function (G) {
  'use strict';
  const T = G.T, C = G.COLS, R = G.ROWS;

  // 障碍模板：[x,y,w,h]（格），不碰十字通道（第 5 行、第 9 列）和门前格 → 保证连通
  const TEMPLATES = [
    [],
    [[3, 2, 2, 2], [14, 2, 2, 2], [3, 7, 2, 2], [14, 7, 2, 2]],
    [[5, 3, 1, 1], [13, 3, 1, 1], [5, 7, 1, 1], [13, 7, 1, 1], [2, 2, 1, 1], [16, 8, 1, 1]],
    [[3, 3, 4, 1], [12, 7, 4, 1]],
    [[6, 2, 2, 2], [11, 7, 2, 2], [3, 8, 1, 1], [15, 2, 1, 1]],
    [[3, 2, 1, 2], [15, 7, 1, 2], [7, 7, 1, 1], [11, 3, 1, 1]],
    [[6, 3, 2, 1], [11, 3, 2, 1], [6, 7, 2, 1], [11, 7, 2, 1]],
    [[2, 2, 3, 1], [14, 2, 3, 1], [2, 8, 3, 1], [14, 8, 3, 1], [7, 3, 1, 1], [11, 7, 1, 1]],
    [[4, 3, 1, 1], [7, 2, 1, 1], [11, 2, 1, 1], [14, 3, 1, 1], [4, 7, 1, 1], [7, 8, 1, 1], [11, 8, 1, 1], [14, 7, 1, 1]],
    [[7, 2, 1, 2], [11, 7, 1, 2], [3, 6, 2, 1], [14, 4, 2, 1]]
  ];
  G.ROOM_TEMPLATES = TEMPLATES;
  const ROOM_COUNT = [[9, 10], [10, 12], [11, 13]];

  // ---------------- 楼层生成（只依赖 seed 与 floor）----------------
  G.genFloor = function (seed, floor) {
    const rng = G.makeRng(G.mix(seed >>> 0, floor + 1));
    const rc = ROOM_COUNT[Math.min(floor, 2)];
    for (let attempt = 0; attempt < 400; attempt++) {
      const n = rng.int(rc[0], rc[1]);
      const occ = new Map(), cells = [];
      const add = (x, y) => { const c = { gx: x, gy: y }; occ.set(G.key(x, y), c); cells.push(c); return c; };
      const nb = (x, y) => { let k = 0; for (let d = 0; d < 4; d++) if (occ.has(G.key(x + G.DX[d], y + G.DY[d]))) k++; return k; };
      add(4, 4);
      let tries = 0;
      while (cells.length < n && tries++ < 4000) {
        const c = rng.pick(cells), d = rng.int(0, 3), x = c.gx + G.DX[d], y = c.gy + G.DY[d];
        if (x < 0 || y < 0 || x > 8 || y > 8 || occ.has(G.key(x, y)) || nb(x, y) > 1) continue;
        add(x, y);
      }
      if (cells.length < n) continue;
      const start = cells[0]; start.dist = 0; const q = [start];
      while (q.length) {
        const c = q.shift();
        for (let d = 0; d < 4; d++) { const o = occ.get(G.key(c.gx + G.DX[d], c.gy + G.DY[d])); if (o && o.dist === undefined) { o.dist = c.dist + 1; q.push(o); } }
      }
      const ends = cells.filter(c => c !== start && nb(c.gx, c.gy) === 1).sort((a, b) => b.dist - a.dist || a.gy - b.gy || a.gx - b.gx);
      if (ends.length < 4 || ends[0].dist < 3) continue;
      cells.forEach(c => { c.type = 'fight'; });
      start.type = 'start';
      ends[0].type = 'boss';
      const rest = rng.shuffle(ends.slice(1));
      rest[0].type = 'treasure'; rest[1].type = 'shop'; rest[2].type = 'altar';
      // 精英房：离起点 ≥2 的普通战斗房，且不与 Boss 房相邻
      const boss = ends[0];
      const cand = cells.filter(c => c.type === 'fight' && c.dist >= 2 && Math.abs(c.gx - boss.gx) + Math.abs(c.gy - boss.gy) > 1);
      if (!cand.length) continue;
      rng.pick(cand).type = 'elite';
      if (!cells.some(c => c.type === 'fight')) continue;
      cells.forEach(c => buildRoom(rng, occ, c, floor));
      return { floor, rooms: cells, roomMap: occ };
    }
    throw new Error('楼层生成失败 seed=' + seed + ' floor=' + floor);
  };

  function buildRoom(rng, occ, room, floor) {
    const tiles = new Uint8Array(C * R);
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) tiles[y * C + x] = (x === 0 || y === 0 || x === C - 1 || y === R - 1) ? 1 : 0;
    room.doors = [0, 0, 0, 0];
    for (let d = 0; d < 4; d++) {
      if (occ.has(G.key(room.gx + G.DX[d], room.gy + G.DY[d]))) { room.doors[d] = 1; const dt = G.DOOR_TILE[d]; tiles[dt[1] * C + dt[0]] = 3; }
    }
    room.tpl = 0; room.props = []; room.propGrid = new Uint8Array(C * R);
    if (room.type === 'fight' || room.type === 'elite') {
      room.tpl = rng.int(1, TEMPLATES.length - 1);
      const flipX = rng.chance(0.5), flipY = rng.chance(0.5);
      for (const b of TEMPLATES[room.tpl]) {
        for (let y = b[1]; y < b[1] + b[3]; y++) for (let x = b[0]; x < b[0] + b[2]; x++) {
          const xx = flipX ? C - 1 - x : x, yy = flipY ? R - 1 - y : y;
          if (xx === 9 || yy === 5) continue;
          tiles[yy * C + xx] = 2;
        }
      }
      const fd = G.FLOORS && G.FLOORS[floor];
      const wv = (fd && fd.waves) || [[1, 2], [2, 3], [2, 3]][Math.min(floor, 2)];
      room.waves = room.type === 'elite' ? 1 : G.clamp(rng.int(wv[0], wv[1]), 1, 4);
      // 道具：木箱与爆炸桶（不放在十字通道和门附近）
      const np = rng.int(1, 4);
      for (let i = 0, k = 0; i < np && k < 60; k++) {
        const tx = rng.int(1, C - 2), ty = rng.int(1, R - 2);
        if (tx === 9 || ty === 5 || tiles[ty * C + tx] !== 0 || room.propGrid[ty * C + tx]) continue;
        if (Math.abs(tx - 9) <= 1 && (ty <= 2 || ty >= R - 3)) continue;
        if (Math.abs(ty - 5) <= 1 && (tx <= 2 || tx >= C - 3)) continue;
        const kind = rng.chance(0.3) ? 'barrel' : 'crate';
        room.props.push({ kind, tx, ty, x: (tx + 0.5) * T, y: (ty + 0.5) * T, hp: kind === 'barrel' ? 5 : 8, maxHp: kind === 'barrel' ? 5 : 8, flash: 0 });
        room.propGrid[ty * C + tx] = 1;
        // 不允许道具围出“口袋”（所有空地都必须从中心可达）
        if (reachMask(tiles, room.propGrid).holes) { room.props.pop(); room.propGrid[ty * C + tx] = 0; continue; }
        i++;
      }
    } else room.waves = 0;
    room.reach = reachMask(tiles, room.propGrid).mask;
    room.tiles = tiles; room.items = []; room.visited = false; room.seen = false;
    room.cleared = !(room.type === 'fight' || room.type === 'elite' || room.type === 'boss');
    room.locked = false; room.waveIdx = 0; room.filled = false;
  }

  // 从房间中心出发的可达空地掩码；holes=有空地不可达
  function reachMask(tiles, propGrid) {
    const mask = new Uint8Array(C * R), st = [5 * C + 9]; mask[5 * C + 9] = 1;
    while (st.length) {
      const c = st.pop(), x = c % C, y = (c / C) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + G.DX[d], ny = y + G.DY[d], ni = ny * C + nx;
        if (nx < 0 || ny < 0 || nx >= C || ny >= R || mask[ni]) continue;
        if (tiles[ni] === 0 && !propGrid[ni]) { mask[ni] = 1; st.push(ni); }
      }
    }
    let holes = false;
    for (let i = 0; i < C * R; i++) if (tiles[i] === 0 && !propGrid[i] && !mask[i]) { holes = true; break; }
    return { mask, holes };
  }
  G.reachMask = reachMask;

  // ---------------- 楼层检查（测试与 autotest 用）----------------
  G.checkFloor = function (fl) {
    const rooms = fl.rooms, map = fl.roomMap;
    if (!rooms || !rooms.length) return 'no-rooms';
    const types = {}; rooms.forEach(r => { types[r.type] = (types[r.type] || 0) + 1; });
    for (const t of ['start', 'boss', 'treasure', 'shop', 'altar', 'elite', 'fight']) if (!types[t]) return 'missing-room-type ' + t;
    if (types.start !== 1 || types.boss !== 1) return 'bad-start-or-boss-count';
    const start = rooms.find(r => r.type === 'start');
    const seen = new Set([G.key(start.gx, start.gy)]), q = [start];
    while (q.length) {
      const c = q.shift();
      for (let d = 0; d < 4; d++) if (c.doors[d]) {
        const k = G.key(c.gx + G.DX[d], c.gy + G.DY[d]); const o = map.get(k);
        if (!o) return 'door-to-nowhere ' + c.gx + ',' + c.gy;
        if (!o.doors[(d + 2) % 4]) return 'one-way-door ' + c.gx + ',' + c.gy;
        if (!seen.has(k)) { seen.add(k); q.push(o); }
      }
    }
    if (seen.size !== rooms.length) return 'unreachable-room';
    for (const r of rooms) {
      // 房间内：中心可达所有门，且进门落点是空地
      const vis = new Uint8Array(C * R), st = [[9, 5]];
      if (blockedTile(r, 9, 5)) return 'center-blocked ' + r.gx + ',' + r.gy;
      vis[5 * C + 9] = 1;
      while (st.length) {
        const [x, y] = st.pop();
        for (let d = 0; d < 4; d++) {
          const nx = x + G.DX[d], ny = y + G.DY[d];
          if (nx < 0 || ny < 0 || nx >= C || ny >= R || vis[ny * C + nx]) continue;
          const t = r.tiles[ny * C + nx];
          if (t === 3) { vis[ny * C + nx] = 1; continue; }
          if (t === 0 && !r.propGrid[ny * C + nx]) { vis[ny * C + nx] = 1; st.push([nx, ny]); }
        }
      }
      for (let d = 0; d < 4; d++) if (r.doors[d]) {
        const dt = G.DOOR_TILE[d];
        if (!vis[dt[1] * C + dt[0]]) return 'unreachable-door ' + r.gx + ',' + r.gy + ' d' + d;
        const ex = dt[0] - G.DX[d], ey = dt[1] - G.DY[d];
        if (blockedTile(r, ex, ey)) return 'door-entry-blocked ' + r.gx + ',' + r.gy;
      }
    }
    // Boss 房是离起点最远的死胡同
    const boss = rooms.find(r => r.type === 'boss');
    if (boss.doors.reduce((a, b) => a + b, 0) !== 1) return 'boss-not-dead-end';
    if (rooms.some(r => r.dist > boss.dist)) return 'boss-not-farthest';
    return null;
  };
  function blockedTile(r, tx, ty) { return tx < 0 || ty < 0 || tx >= C || ty >= R || r.tiles[ty * C + tx] === 1 || r.tiles[ty * C + tx] === 2 || r.propGrid[ty * C + tx]; }

  // ---------------- 碰撞 ----------------
  // who: 'p' 玩家（开着的门可走）、'e'/'f' 敌人、'b' 子弹
  G.solid = function (room, tx, ty, who) {
    if (tx < 0 || ty < 0 || tx >= C || ty >= R) return true;
    const i = ty * C + tx, t = room.tiles[i];
    if (t === 1 || t === 2) return true;
    if (t === 3) return who === 'p' ? room.locked : true;
    return room.propGrid[i] === 1;
  };
  G.hitsSolid = function (room, x, y, r, who) {
    const x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T), y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!G.solid(room, tx, ty, who)) continue;
      const nx = G.clamp(x, tx * T, tx * T + T), ny = G.clamp(y, ty * T, ty * T + T);
      if ((nx - x) * (nx - x) + (ny - y) * (ny - y) < r * r) return true;
    }
    return false;
  };
  G.moveCircle = function (room, e, dx, dy, who) {
    if (!isFinite(dx) || !isFinite(dy)) return true;
    if (G.hitsSolid(room, e.x, e.y, e.r, who)) { const f = G.placeFree(room, e.x, e.y, e.r, who); e.x = f.x; e.y = f.y; }
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
    let blocked = false; dx /= steps; dy /= steps;
    for (let i = 0; i < steps; i++) {
      e.x += dx; if (G.hitsSolid(room, e.x, e.y, e.r, who)) { e.x -= dx; blocked = true; }
      e.y += dy; if (G.hitsSolid(room, e.x, e.y, e.r, who)) { e.y -= dy; blocked = true; }
    }
    return blocked;
  };
  // 从 (x,y) 向外螺旋搜索第一个不与实体重叠的位置
  G.placeFree = function (room, x, y, r, who) {
    who = who || 'e';
    x = G.clamp(x, T + r, G.RW - T - r); y = G.clamp(y, T + r, G.RH - T - r);
    if (!G.hitsSolid(room, x, y, r, who)) return { x, y };
    for (let rad = 6; rad < 520; rad += 6) {
      const n = Math.max(8, Math.floor(rad / 3));
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
        if (px < T + r || py < T + r || px > G.RW - T - r || py > G.RH - T - r) continue;
        if (!G.hitsSolid(room, px, py, r, who)) return { x: px, y: py };
      }
    }
    return { x: G.RW / 2, y: G.RH / 2 };
  };
  G.walkableTile = (room, tx, ty) => tx > 0 && ty > 0 && tx < C - 1 && ty < R - 1 && room.tiles[ty * C + tx] === 0 && !room.propGrid[ty * C + tx];
  G.lineOfSight = function (room, x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 10);
    for (let i = 1; i < n; i++) {
      const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
      if (G.solid(room, Math.floor(x / T), Math.floor(y / T), 'b')) return false;
    }
    return true;
  };
  G.propAt = function (room, tx, ty) {
    if (!room.propGrid[ty * C + tx]) return null;
    for (const p of room.props) if (p.tx === tx && p.ty === ty) return p;
    return null;
  };

  // ---------------- 房间切换 ----------------
  G.checkDoors = function (S) {
    const p = S.p, room = S.room; if (room.locked) return;
    let d = -1;
    if (p.y < T * 0.55) d = 0; else if (p.x > (C - 0.55) * T) d = 1; else if (p.y > (R - 0.55) * T) d = 2; else if (p.x < T * 0.55) d = 3;
    if (d < 0 || !room.doors[d]) return;
    const nb = S.roomMap.get(G.key(room.gx + G.DX[d], room.gy + G.DY[d]));
    if (nb) G.enterRoom(S, nb, d);
  };
  G.enterRoom = function (S, room, fromDir) {
    S.room = room; room.visited = true; room.seen = true;
    for (let d = 0; d < 4; d++) { const nb = S.roomMap.get(G.key(room.gx + G.DX[d], room.gy + G.DY[d])); if (nb && room.doors[d]) nb.seen = true; }
    S.enemies = []; S.bullets = []; S.hazards = []; S.strikes = []; S.waveDelay = 0.6;
    const p = S.p;
    if (fromDir === undefined || fromDir < 0) { p.x = (C / 2) * T; p.y = (R / 2) * T; }
    else { const od = (fromDir + 2) % 4, dt = G.DOOR_TILE[od]; p.x = (dt[0] + 0.5) * T - G.DX[od] * T * 1.25; p.y = (dt[1] + 0.5) * T - G.DY[od] * T * 1.25; }
    p.vx = p.vy = 0; p.rolling = 0; p.beam = null; p.swing = null; p.charge = 0;
    if (!room.filled) { room.filled = true; if (G.fillRoom) G.fillRoom(S, room); }
    G.emit('roomenter', { type: room.type, cleared: room.cleared });
    if (!room.cleared) {
      room.locked = true; G.emit('doors', { locked: true });
      if (room.type === 'boss') G.spawnBoss(S);
      else { room.waveIdx = 0; if (room.type === 'fight') S.fightIdx++; G.spawnWave(S); }
    }
  };

  // ---------------- 刷怪 ----------------
  function spawnSpot(S, minD) {
    const room = S.room, rng = S.rng;
    for (let k = 0; k < 80; k++) {
      const tx = rng.int(2, C - 3), ty = rng.int(2, R - 3);
      if (!G.walkableTile(room, tx, ty) || (room.reach && !room.reach[ty * C + tx])) continue;
      const x = (tx + 0.5) * T, y = (ty + 0.5) * T;
      if (Math.hypot(x - S.p.x, y - S.p.y) > minD) return { x, y };
    }
    return { x: G.RW / 2, y: G.RH / 2 };
  }
  G.spawnSpot = spawnSpot;
  G.spawnWave = function (S) {
    const rng = S.rng, room = S.room, f = S.floor, fd = S.fdef;
    const pool = (fd.pool || []).filter(e => (e.from || 0) <= Math.max(0, S.fightIdx - 1) && G.ENEMIES[e.type]);
    if (!pool.length) { room.waveIdx = room.waves; return; }
    const wave = fd.wave || [2, 4];
    let n = rng.int(wave[0], wave[1]) + (room.waveIdx > 0 ? 1 : 0);
    if (f === 0 && S.fightIdx <= 2) n = Math.min(n, 3);
    n = Math.max(1, Math.round(n * (S.dm.count || 1)));
    if (room.type === 'elite') {
      // 精英小队：1 只精英 + 若干随从
      const affs = (fd.affixes && fd.affixes.length) ? fd.affixes : Object.keys(G.AFFIXES || {});
      const strong = pool.filter(e => (G.ENEMIES[e.type].hp || 0) >= 12);
      const lead = rng.weighted(strong.length ? strong : pool, e => e.w || 1).type;
      const s0 = spawnSpot(S, 220);
      G.spawnEnemy(S, lead, s0.x, s0.y, { elite: affs.length ? rng.pick(affs) : null });
      n = Math.max(2, Math.round((wave[0] + 1) * (S.dm.count || 1)));
    }
    for (let i = 0; i < n; i++) {
      const s = spawnSpot(S, 200);
      const type = rng.weighted(pool, e => e.w || 1).type;
      const elite = room.type !== 'elite' && fd.elite && rng.chance(fd.elite) && fd.affixes && fd.affixes.length ? rng.pick(fd.affixes) : null;
      G.spawnEnemy(S, type, s.x, s.y, { elite });
    }
    room.waveIdx++;
  };
  G.spawnBoss = function (S) {
    const bid = S.fdef.boss, d = G.ENEMIES[bid];
    if (!d) { S.room.locked = false; S.room.cleared = true; return; }
    const b = G.spawnEnemy(S, bid, (C / 2) * T, (R / 2 - 1.5) * T, { spawnT: 2.4, force: true });
    S.boss = b;
    S.bossIntro = { t: 2.4, max: 2.4, name: d.name, title: d.title || (S.floor === 2 ? '最终首领' : '第 ' + (S.floor + 1) + ' 层守护者') };
    G.emit('bossintro', { id: bid, name: d.name, title: S.bossIntro.title });
  };
})(window.Game = window.Game || {});
