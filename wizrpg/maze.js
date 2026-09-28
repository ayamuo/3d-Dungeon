/* 星灯の迷宮 — 迷宮生成
   各階はデータ(FLOORS)の区画・接続・イベント定義と固定シードから、毎回まったく同じ形に生成される。
   壁は「マスの辺」ごとに持つ（Wizardry式の薄い壁）。辺の値は同じ壁でも表と裏で違ってよい（一方通行扉のため）。 */
"use strict";
(function (G) {
const WD = (typeof module !== "undefined" && module.exports) ? require("./data.js") : G.WD;

const DX = [0, 1, 0, -1], DY = [1, 0, -1, 0]; // 0:北 1:東 2:南 3:西
const DIRC = { N: 0, E: 1, S: 2, W: 3 };
const E_OPEN = 0, E_WALL = 1, E_DOOR = 2, E_SECRET = 3, E_LOCK = 4, E_RIDDLE = 5;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function genFloor(n) {
  const cfg = WD.FLOORS[n];
  const W = 20, H = 20;
  const rng = mulberry32(cfg.seed);
  const ri = k => Math.floor(rng() * k);
  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const walls = new Uint8Array(W * H * 4).fill(E_WALL);
  const sec = new Int8Array(W * H).fill(-1);
  const secNames = Object.keys(cfg.sections);
  secNames.forEach((name, si) => {
    const [x0, y0, x1, y1] = cfg.sections[name];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sec[idx(x, y)] = si;
  });
  const setE = (x, y, d, v, vBack) => {
    walls[idx(x, y) * 4 + d] = v;
    const nx = x + DX[d], ny = y + DY[d];
    if (inb(nx, ny)) walls[idx(nx, ny) * 4 + ((d + 2) & 3)] = vBack === undefined ? v : vBack;
  };
  const getE = (x, y, d) => walls[idx(x, y) * 4 + d];
  // その壁を抜くと、仕切りのない2×2の広場ができてしまうか（通路は幅1マスに保ちたい）
  const makesSquare = (x, y, d) => {
    if (d >= 2) { x += DX[d]; y += DY[d]; d -= 2; }
    const open = (cx, cy, cd) => (cx === x && cy === y && cd === d) || getE(cx, cy, cd) === E_OPEN;
    const corners = d === 0 ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]];
    return corners.some(([a, b]) => a >= 0 && b >= 0 && a < W - 1 && b < H - 1 &&
      open(a, b, 1) && open(a, b, 0) && open(a + 1, b, 0) && open(a, b + 1, 1));
  };

  // 1) 区画ごとに穴掘り法で迷路を作る（区画内はすべてつながる）
  secNames.forEach((name, si) => {
    const [x0, y0, x1, y1] = cfg.sections[name];
    const seen = new Uint8Array(W * H);
    const sx = x0 + ri(x1 - x0 + 1), sy = y0 + ri(y1 - y0 + 1);
    const stack = [[sx, sy]]; seen[idx(sx, sy)] = 1;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = [];
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (inb(nx, ny) && sec[idx(nx, ny)] === si && !seen[idx(nx, ny)]) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      const d = opts[ri(opts.length)];
      const nx = cx + DX[d], ny = cy + DY[d];
      setE(cx, cy, d, E_OPEN);
      seen[idx(nx, ny)] = 1;
      stack.push([nx, ny]);
    }
  });

  // 2) 部屋：内側の壁を取り払い、外周はいったんすべて壁で囲む
  const roomOf = new Int16Array(W * H).fill(-1);
  (cfg.rooms || []).forEach((rm, ri2) => {
    const [x0, y0, x1, y1] = rm.r;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) roomOf[idx(x, y)] = ri2;
  });
  const boundary = []; // 部屋の外周の辺 [x, y, d]（部屋の内側から見た向き）
  (cfg.rooms || []).forEach((rm, ri2) => {
    const [x0, y0, x1, y1] = rm.r;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!inb(nx, ny)) continue;
        if (roomOf[idx(nx, ny)] === ri2) { setE(x, y, d, E_OPEN); continue; }
        setE(x, y, d, E_WALL);
        if (sec[idx(nx, ny)] === sec[idx(x, y)]) boundary.push([x, y, d]);
      }
    }
  });

  // 3) 回り道：部屋に接していない通路どうしの壁だけを、ときどき取り払う（扉にはしない）
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    for (const d of [0, 1]) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!inb(nx, ny) || sec[idx(x, y)] !== sec[idx(nx, ny)] || sec[idx(x, y)] < 0) continue;
      if (roomOf[idx(x, y)] >= 0 || roomOf[idx(nx, ny)] >= 0) continue;
      if (getE(x, y, d) !== E_WALL) continue;
      if (rng() < (cfg.loops || 0.1) && !makesSquare(x, y, d)) setE(x, y, d, E_OPEN);
    }
  }

  // 4) 部屋の扉：区画内がすべてつながるのに必要な場所にだけ扉を付ける。
  //    （扉の向こうへ別の道から回り込める、という無意味な扉を作らないため）
  const par = Array.from({ length: W * H }, (_, i) => i);
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a === b) return false; par[a] = b; return true; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const d of [0, 1]) {
    const nx = x + DX[d], ny = y + DY[d];
    if (inb(nx, ny) && getE(x, y, d) !== E_WALL) unite(idx(x, y), idx(nx, ny));
  }
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = ri(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  // 部屋で分断された通路どうしは、まず通路の壁を1枚抜いてつなぎ直す（部屋の扉を増やしすぎないため）
  const corridorWalls = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const d of [0, 1]) {
    const nx = x + DX[d], ny = y + DY[d];
    if (!inb(nx, ny) || sec[idx(x, y)] !== sec[idx(nx, ny)] || sec[idx(x, y)] < 0) continue;
    if (roomOf[idx(x, y)] >= 0 || roomOf[idx(nx, ny)] >= 0 || getE(x, y, d) !== E_WALL) continue;
    corridorWalls.push([x, y, d]);
  }
  // 広場を作らない壁を先に試し、それでもつながらないときだけ広場になる壁を使う
  for (const pass of [false, true]) for (const [x, y, d] of shuffle(corridorWalls.slice())) {
    if (getE(x, y, d) !== E_WALL || makesSquare(x, y, d) !== pass) continue;
    if (unite(idx(x, y), idx(x + DX[d], y + DY[d]))) setE(x, y, d, E_OPEN);
  }
  shuffle(boundary);
  const doorCount = {};
  for (const [x, y, d] of boundary) {
    const nx = x + DX[d], ny = y + DY[d];
    if (unite(idx(x, y), idx(nx, ny))) { setE(x, y, d, E_DOOR); const r = roomOf[idx(x, y)]; doorCount[r] = (doorCount[r] || 0) + 1; }
  }
  // 出入口が1つだけの部屋には、ときどき2つ目の扉を別の面に付ける（行き止まりの部屋ばかりにしない）
  const want2 = {};
  (cfg.rooms || []).forEach((rm, i) => want2[i] = rng() < 0.35);
  for (const [x, y, d] of boundary) {
    const r = roomOf[idx(x, y)];
    if (doorCount[r] !== 1 || !want2[r] || getE(x, y, d) !== E_WALL) continue;
    const nr = roomOf[idx(x + DX[d], y + DY[d])];
    if (nr >= 0) continue;
    setE(x, y, d, E_DOOR); doorCount[r] = 2;
  }

  // 5) 区画どうしの接続
  const lockReq = {};
  (cfg.links || []).forEach(l => {
    const [x, y, dc] = l.at, d = DIRC[dc];
    const nx = x + DX[d], ny = y + DY[d];
    const keyA = idx(x, y) * 4 + d, keyB = idx(nx, ny) * 4 + ((d + 2) & 3);
    if (l.type === "door") setE(x, y, d, E_DOOR);
    else if (l.type === "open") setE(x, y, d, E_OPEN);
    else if (l.type === "secret") setE(x, y, d, E_SECRET);
    else if (l.type === "oneway") setE(x, y, d, E_DOOR, E_WALL);
    else if (l.type === "lock") { setE(x, y, d, E_LOCK); lockReq[keyA] = l.req; lockReq[keyB] = l.req; }
    else if (l.type === "riddle") { setE(x, y, d, E_RIDDLE); lockReq[keyA] = "riddle"; lockReq[keyB] = "riddle"; }
  });

  // 6) 床の仕掛け
  const tile = {}; // idx -> {t:'up'|'down'|'elev'|'spin'|'pit'|'chute'|'tele', to}
  if (cfg.up) tile[idx(...cfg.up)] = { t: "up" };
  if (cfg.down) tile[idx(...cfg.down)] = { t: "down" };
  if (cfg.elev) tile[idx(...cfg.elev)] = { t: "elev" };
  (cfg.spin || []).forEach(p => tile[idx(...p)] = { t: "spin" });
  (cfg.pits || []).forEach(p => tile[idx(...p)] = { t: "pit" });
  (cfg.chutes || []).forEach(p => tile[idx(...p)] = { t: "chute" });
  (cfg.tele || []).forEach(p => tile[idx(...p.at)] = { t: "tele", to: p.to });
  const dark = new Uint8Array(W * H), anti = new Uint8Array(W * H), swamp = new Uint8Array(W * H);
  (cfg.zones || []).forEach(z => {
    const arr = z.t === "dark" ? dark : z.t === "anti" ? anti : swamp;
    const [x0, y0, x1, y1] = z.r;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) arr[idx(x, y)] = 1;
  });
  // 6.5) 転移床・落とし戸が通路をふさがないようにする。
  //      踏むと別の場所へ飛ばされるので、1本道の途中にあるとその先へ歩いて行けなくなる。
  //      脇の壁を抜いて、必ず迂回路を作る。
  {
    const blocker = k => tile[k] && (tile[k].t === "tele" || tile[k].t === "chute");
    const components = () => {
      const p = Array.from({ length: W * H }, (_, i) => i);
      const fd = i => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const d of [0, 1]) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!inb(nx, ny) || blocker(idx(x, y)) || blocker(idx(nx, ny))) continue;
        if (getE(x, y, d) !== E_WALL && getE(nx, ny, (d + 2) & 3) !== E_WALL) { const a = fd(idx(x, y)), b = fd(idx(nx, ny)); if (a !== b) p[a] = b; }
      }
      return fd;
    };
    for (let k = 0; k < W * H; k++) {
      if (!blocker(k)) continue;
      const cx = k % W, cy = (k / W) | 0;
      for (let guard = 0; guard < 8; guard++) {
        const fd = components();
        const nb = [];
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX[d], ny = cy + DY[d];
          if (inb(nx, ny) && getE(cx, cy, d) !== E_WALL && !blocker(idx(nx, ny))) nb.push(idx(nx, ny));
        }
        const roots = [...new Set(nb.map(fd))];
        if (roots.length <= 1) break;
        // 分断された2つの側を、転移床の近くで1枚の壁を抜いてつなぐ
        let best = null, bestD = 1e9;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (!inb(nx, ny) || getE(x, y, d) !== E_WALL) continue;
          const a = idx(x, y), b = idx(nx, ny);
          if (blocker(a) || blocker(b) || sec[a] !== sec[b] || roomOf[a] >= 0 || roomOf[b] >= 0) continue;
          if (fd(a) !== roots[0] || fd(b) === roots[0] || !roots.includes(fd(b))) continue;
          const dist = Math.abs(x - cx) + Math.abs(y - cy) + (makesSquare(x, y, d) ? 100 : 0);
          if (dist < bestD) { bestD = dist; best = [x, y, d]; }
        }
        if (!best) break;
        setE(best[0], best[1], best[2], E_OPEN);
      }
    }
  }

  // 6.8) 岩：行き止まりの先から少しずつ埋めて、歩けない岩のマスを作る（各階の約5%）。
  //      テレポーターや瞬間移動で岩の中に出ると事故になる。行き止まりを削るだけなので、ほかのマスへの道は切れない。
  //      部屋・床の仕掛け・イベント・隠しアイテム・区画の接続・転移床の飛び先・上の階の落とし戸の真下は岩にしない。
  //      瞬間移動が効かない階（noTele）には作らない。ほかの手順と乱数を分けているので、迷路の形は変わらない。
  const rock = new Uint8Array(W * H);
  if (!cfg.noTele) {
    const rrng = mulberry32(cfg.seed * 31 + 7);
    const protect = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) if (roomOf[k] >= 0 || tile[k]) protect[k] = 1;
    for (const k in tile) if (tile[k].t === "tele") protect[idx(...tile[k].to)] = 1;
    const above = WD.FLOORS[n - 1];
    ((above && above.chutes) || []).forEach(p => protect[idx(...p)] = 1);
    (cfg.ev || []).forEach(e => protect[idx(...e.at)] = 1);
    (cfg.hidden || []).forEach(h => protect[idx(...h.at)] = 1);
    (cfg.links || []).forEach(l => { const [x, y, dc] = l.at, d = DIRC[dc]; protect[idx(x, y)] = 1; if (inb(x + DX[d], y + DY[d])) protect[idx(x + DX[d], y + DY[d])] = 1; });
    const target = Math.round(W * H * 0.05);
    const nearRock = k => { const x = k % W, y = (k / W) | 0; for (let d = 0; d < 4; d++) { const nx = x + DX[d], ny = y + DY[d]; if (inb(nx, ny) && rock[idx(nx, ny)]) return true; } return false; };
    for (let count = 0; count < target; count++) {
      const leaves = [];
      for (let k = 0; k < W * H; k++) {
        if (rock[k] || protect[k]) continue;
        let open = 0, od = -1;
        for (let d = 0; d < 4; d++) if (walls[k * 4 + d] !== E_WALL) { open++; od = d; }
        if (open === 1 && walls[k * 4 + od] === E_OPEN) leaves.push(k);
      }
      if (!leaves.length) break;
      // 岩のとなりを優先して、かたまりにする
      let pool = leaves.filter(nearRock);
      if (!pool.length || rrng() < 0.35) pool = leaves;
      const k = pool[Math.floor(rrng() * pool.length)], x = k % W, y = (k / W) | 0;
      rock[k] = 1;
      for (let d = 0; d < 4; d++) setE(x, y, d, E_WALL);
    }
  }

  // 7) イベント。部屋の中の戦闘イベントは、部屋のどのマスに入っても起きる
  const ev = {};
  (cfg.ev || []).forEach(e => {
    const k = idx(...e.at);
    (ev[k] = ev[k] || []).push(e);
    if ((e.t === "fight" || e.t === "boss" || e.t === "gift") && roomOf[k] >= 0) {
      const [x0, y0, x1, y1] = cfg.rooms[roomOf[k]].r;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const k2 = idx(x, y);
        if (k2 !== k) (ev[k2] = ev[k2] || []).push(e);
      }
    }
  });
  return { n, cfg, W, H, walls, lockReq, tile, dark, anti, swamp, ev, sec, roomOf, rock };
}

const MAZE = { DX, DY, DIRC, E_OPEN, E_WALL, E_DOOR, E_SECRET, E_LOCK, E_RIDDLE, genFloor, mulberry32 };
if (typeof module !== "undefined" && module.exports) module.exports = MAZE; else G.MAZE = MAZE;
})(typeof window !== "undefined" ? window : globalThis);
