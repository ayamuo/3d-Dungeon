/* 星灯の迷宮 — 迷宮探索（3D表示・移動・仕掛け・イベント・キャンプ・昇降機） */
"use strict";

const FLOOR_CACHE = {};
const FL = n => FLOOR_CACHE[n] || (FLOOR_CACHE[n] = MAZE.genFloor(n));
const cidx = (x, y) => y * 20 + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < 20 && y < 20;
const DIR_NAME = ["北", "東", "南", "西"];
const ENC_STEP = 0.01, ENC_MAX = 25, ENC_GRACE = 3; // エンカウント率の1歩ごとの上昇量、必ず戦闘になる歩数、戦闘のあと敵が出ない歩数
let prevCell = -1;

/* ────────── 迷宮の出入り ────────── */
async function startExpedition() {
  // 行動不能な者は連れて行けない（死者も一緒に入ることはできるが、前列の邪魔になる）
  S.inMaze = true; S.identAll = false; S.light = 0; S.ward = 0;
  S.pos = { f: 1, x: 0, y: 0, d: 0 };
  partyChars().forEach(c => c.where = "maze");
  S.deepest = Math.max(S.deepest, 1);
  markExplored();
  saveGame(true);
  Snd.play("stairs");
  clearMsg();
  logMsg("坑道の昇降口から、迷宮へと下りていった……");
  return enterMaze(false);
}
async function enterMaze(resume) {
  if (resume) { clearMsg(); logMsg(`地下${S.pos.f}階「${FLOORS[S.pos.f].name}」から冒険を再開した。`); }
  preloadMonImgs(S.pos.f);
  wanderMet = false;
  Bgm.play(floorBgm(S.pos.f));
  $("scene").className = "";
  $("scene").innerHTML = "";
  await texWait(S.pos.f);
  document.body.dataset.mode = "maze";
  prevCell = cidx(S.pos.x, S.pos.y);
  partyTapHandler = c => { if (inputResolver) inputResolver({ sheet: c.id }); };
  renderParty();
  return exploreLoop();
}
async function exitMaze(msg) {
  Bgm.stop(1.0);
  S.inMaze = false; S.light = 0; S.ward = 0; S.identAll = false;
  for (const c of partyChars()) { c.where = "town"; c.poison = 0; c.bac = 0; }
  saveGame(true);
  $("hud").textContent = "";
  if (msg) { showScene("town"); await tell(msg); }
  throw new ToTown();
}
class ToTown { }

/* ────────── 探索ループ ────────── */
let mazeBusy = false;
let inputResolver = null;
async function exploreLoop() {
  try {
    while (S.inMaze) {
      drawView();
      mazeBusy = false;
      const a = await waitMazeInput();
      mazeBusy = true;
      try {
      if (a === "fwd") await tryMove();
      else if (a === "left") { Snd.play("move"); await animTurn(-1); }
      else if (a === "right") { Snd.play("move"); await animTurn(1); }
      else if (a === "back") { Snd.play("move"); await animTurn(2); }
      else if (a === "search") await searchHere();
      else if (a === "camp") await campMenu();
      else if (a === "map") await showAutomap();
      else if (a && a.sheet) await charSheet(charById(a.sheet), "camp");
      else if (a === "tile") await useTile();
      } catch (err) {
        // 想定外のエラーでも町へ放り出さず、その場で探索を続けられるようにする
        if (err instanceof ToTown) throw err;
        console.error(err);
        logMsg("（不具合が発生しました。探索を続けられます）");
      }
      // テレポーターや瞬間移動で岩の中に出てしまった
      if (S.inMaze && inRock(S.pos.f, S.pos.x, S.pos.y)) await buriedInRock();
      saveGame();
    }
  } catch (e) {
    if (!(e instanceof ToTown)) { console.error(e); }
  }
  mazeBusy = false;
  return townMain();
}
/* 迷宮のボタンの絵（16×16のドット絵。白＝currentColor、金＝強調）。絵文字は端末ごとに見た目が変わるので、専用の絵にしている */
const PIX = {
  fwd: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M7 1h2v1h-2zM6 2h4v1h-4zM5 3h6v1h-6zM4 4h8v1h-8zM3 5h10v1h-10zM2 6h12v1h-12zM1 7h14v1h-14zM6 8h4v1h-4zM6 9h4v1h-4zM6 10h4v1h-4zM6 11h4v1h-4zM6 12h4v1h-4zM6 13h4v1h-4zM6 14h4v1h-4z"/></svg>',
  left: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M4 2h2v1h-2zM3 3h3v1h-3zM2 4h11v1h-11zM1 5h13v1h-13zM2 6h11v1h-11zM3 7h3v1h-3zM10 7h4v1h-4zM4 8h2v1h-2zM11 8h3v1h-3zM11 9h3v1h-3zM11 10h3v1h-3zM11 11h3v1h-3zM11 12h3v1h-3zM11 13h3v1h-3zM11 14h3v1h-3z"/></svg>',
  back: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 1h9v1h-9zM2 2h11v1h-11zM1 3h4v1h-4zM10 3h4v1h-4zM1 4h3v1h-3zM11 4h3v1h-3zM1 5h3v1h-3zM11 5h3v1h-3zM1 6h3v1h-3zM11 6h3v1h-3zM1 7h3v1h-3zM11 7h3v1h-3zM1 8h3v1h-3zM11 8h3v1h-3zM1 9h3v1h-3zM8 9h7v1h-7zM1 10h3v1h-3zM9 10h5v1h-5zM1 11h3v1h-3zM10 11h3v1h-3zM1 12h3v1h-3zM11 12h1v1h-1zM1 13h3v1h-3zM1 14h3v1h-3z"/></svg>',
  map: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M1 1h14v1h-14zM1 2h1v1h-1zM14 2h1v1h-1zM1 3h1v1h-1zM14 3h1v1h-1zM1 4h1v1h-1zM3 4h1v1h-1zM14 4h1v1h-1zM1 5h1v1h-1zM4 5h1v1h-1zM14 5h1v1h-1zM1 6h1v1h-1zM5 6h1v1h-1zM14 6h1v1h-1zM1 7h1v1h-1zM6 7h1v1h-1zM14 7h1v1h-1zM1 8h1v1h-1zM7 8h1v1h-1zM14 8h1v1h-1zM1 9h1v1h-1zM8 9h1v1h-1zM14 9h1v1h-1zM1 10h1v1h-1zM9 10h1v1h-1zM14 10h1v1h-1zM1 11h1v1h-1zM14 11h1v1h-1zM1 12h1v1h-1zM14 12h1v1h-1zM1 13h14v1h-14z"/><path fill="#fde68a" d="M8 5h1v1h-1zM10 5h1v1h-1zM9 6h1v1h-1zM8 7h1v1h-1zM10 7h1v1h-1z"/><path fill="#7c859c" d="M6 2h1v1h-1zM11 2h1v1h-1zM6 3h1v1h-1zM11 3h1v1h-1zM6 4h1v1h-1zM11 4h1v1h-1zM6 5h1v1h-1zM6 6h1v1h-1zM11 6h1v1h-1zM6 8h1v1h-1zM11 8h1v1h-1zM6 9h1v1h-1zM11 9h1v1h-1zM6 10h1v1h-1zM11 10h1v1h-1zM6 11h1v1h-1zM11 11h1v1h-1zM6 12h1v1h-1zM11 12h1v1h-1z"/></svg>',
  search: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M4 1h6v1h-6zM3 2h2v1h-2zM9 2h2v1h-2zM2 3h2v1h-2zM10 3h2v1h-2zM1 4h2v1h-2zM11 4h2v1h-2zM1 5h2v1h-2zM11 5h2v1h-2zM1 6h2v1h-2zM11 6h2v1h-2zM1 7h2v1h-2zM11 7h2v1h-2zM2 8h2v1h-2zM10 8h2v1h-2zM3 9h2v1h-2zM9 9h3v1h-3zM4 10h9v1h-9zM10 11h4v1h-4zM11 12h4v1h-4zM12 13h3v1h-3zM13 14h1v1h-1z"/><path fill="#fde68a" d="M5 4h1v1h-1zM4 5h1v1h-1z"/></svg>',
  camp: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M7 1h2v1h-2zM6 2h4v1h-4zM5 3h6v1h-6zM4 4h3v1h-3zM9 4h3v1h-3zM3 5h3v1h-3zM10 5h3v1h-3zM2 6h3v1h-3zM11 6h3v1h-3zM1 7h3v1h-3zM12 7h3v1h-3zM0 8h3v1h-3zM13 8h3v1h-3zM0 9h2v1h-2zM14 9h2v1h-2zM0 10h2v1h-2zM14 10h2v1h-2zM0 11h16v1h-16zM0 12h16v1h-16z"/><path fill="#fde68a" d="M7 6h2v1h-2zM7 7h2v1h-2zM6 8h4v1h-4zM6 9h4v1h-4zM5 10h6v1h-6z"/></svg>',
  up: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M12 2h4v1h-4zM12 3h1v1h-1zM12 4h1v1h-1zM8 5h5v1h-5zM8 6h1v1h-1zM4 7h5v1h-5zM4 8h1v1h-1zM0 9h5v1h-5zM0 10h1v1h-1zM0 11h1v1h-1zM0 12h16v1h-16z"/><path fill="#fde68a" d="M3 1h1v1h-1zM2 2h3v1h-3zM1 3h5v1h-5zM3 4h1v1h-1zM3 5h1v1h-1zM3 6h1v1h-1z"/></svg>',
  down: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M0 2h4v1h-4zM3 3h1v1h-1zM3 4h1v1h-1zM3 5h5v1h-5zM7 6h1v1h-1zM7 7h5v1h-5zM11 8h1v1h-1zM11 9h5v1h-5zM15 10h1v1h-1zM15 11h1v1h-1zM0 12h16v1h-16z"/><path fill="#fde68a" d="M12 1h1v1h-1zM12 2h1v1h-1zM12 3h1v1h-1zM10 4h5v1h-5zM11 5h3v1h-3zM12 6h1v1h-1z"/></svg>',
  elev: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M7 0h2v1h-2zM7 1h2v1h-2zM1 2h14v1h-14zM1 3h1v1h-1zM14 3h1v1h-1zM1 4h1v1h-1zM14 4h1v1h-1zM1 5h1v1h-1zM14 5h1v1h-1zM1 6h1v1h-1zM14 6h1v1h-1zM1 7h1v1h-1zM14 7h1v1h-1zM1 8h1v1h-1zM14 8h1v1h-1zM1 9h1v1h-1zM14 9h1v1h-1zM1 10h1v1h-1zM14 10h1v1h-1zM1 11h1v1h-1zM14 11h1v1h-1zM1 12h14v1h-14z"/><path fill="#fde68a" d="M5 4h1v1h-1zM4 5h3v1h-3zM10 5h1v1h-1zM3 6h5v1h-5zM10 6h1v1h-1zM5 7h1v1h-1zM10 7h1v1h-1zM5 8h1v1h-1zM8 8h5v1h-5zM5 9h1v1h-1zM9 9h3v1h-3zM10 10h1v1h-1z"/></svg>',
  right: '<svg class="pix" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M10 2h2v1h-2zM10 3h3v1h-3zM3 4h11v1h-11zM2 5h13v1h-13zM3 6h11v1h-11zM2 7h4v1h-4zM10 7h3v1h-3zM2 8h3v1h-3zM10 8h2v1h-2zM2 9h3v1h-3zM2 10h3v1h-3zM2 11h3v1h-3zM2 12h3v1h-3zM2 13h3v1h-3zM2 14h3v1h-3z"/></svg>',
};
function waitMazeInput() {
  const cmd = $("cmd");
  const t = FL(S.pos.f).tile[cidx(S.pos.x, S.pos.y)];
  const tl = t && { up: `${PIX.up}階段をのぼる`, down: `${PIX.down}階段をおりる`, elev: `${PIX.elev}昇降機を使う` }[t.t];
  cmd.innerHTML = `<div class="pad">
    <button data-a="map" class="sm" aria-label="地図">${PIX.map}<small>地図</small></button><button data-a="fwd" class="arr" aria-label="前進">${PIX.fwd}<small>前進</small></button><button data-a="search" class="sm" aria-label="調べる">${PIX.search}<small>調べる</small></button>
    <button data-a="left" class="arr" aria-label="左を向く">${PIX.left}<small>左を向く</small></button><button data-a="back" class="arr" aria-label="振り返る">${PIX.back}<small>振り返る</small></button><button data-a="right" class="arr" aria-label="右を向く">${PIX.right}<small>右を向く</small></button>
    <button data-a="camp" class="camp${tl ? " half" : ""}">${PIX.camp}キャンプ</button>${tl ? `<button data-a="tile" class="camp half pri">${tl}</button>` : ""}</div>`;
  return new Promise(res => {
    inputResolver = a => { inputResolver = null; res(a); };
    cmd.querySelectorAll("button").forEach(b => b.onclick = () => inputResolver && inputResolver(b.dataset.a));
  });
}
document.addEventListener("keydown", e => {
  if (!inputResolver || $("ov").classList.contains("on") || $("helpOv").classList.contains("on")) return;
  const m = { ArrowUp: "fwd", KeyW: "fwd", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowDown: "back", KeyS: "back", KeyC: "camp", KeyM: "map", KeyF: "search" }[e.code];
  if (m) { e.preventDefault(); inputResolver(m); }
});
(function setupSwipe() {
  let sx = 0, sy = 0, st = 0;
  document.addEventListener("DOMContentLoaded", () => {
    const el = $("stage");
    el.addEventListener("pointerdown", e => { sx = e.clientX; sy = e.clientY; st = Date.now(); });
    el.addEventListener("pointerup", e => {
      if (!inputResolver) return;
      const dx = e.clientX - sx, dy = e.clientY - sy, ad = Math.max(Math.abs(dx), Math.abs(dy));
      if (Date.now() - st > 600) return;
      if (ad < 25) { inputResolver("fwd"); return; } // 画面タップで前進
      if (Math.abs(dx) > Math.abs(dy)) inputResolver(dx < 0 ? "right" : "left");
      else inputResolver(dy < 0 ? "fwd" : "back");
    });
  });
})();

/* ────────── 移動 ────────── */
function edgeAt(f, x, y, d) { return f.walls[cidx(x, y) * 4 + d]; }
function secretKey(fn, x, y, d) { return `${fn}:${cidx(x, y)}:${d}`; }
function isSecretFound(fn, x, y, d) { return !!S.secretsFound[secretKey(fn, x, y, d)]; }
function markSecret(fn, x, y, d) {
  S.secretsFound[secretKey(fn, x, y, d)] = 1;
  const nx = x + DX[d], ny = y + DY[d];
  if (inb(nx, ny)) S.secretsFound[secretKey(fn, nx, ny, (d + 2) & 3)] = 1;
}
function isUnlocked(fn, x, y, d) { return !!S.unlocked[secretKey(fn, x, y, d)]; }
function markUnlocked(fn, x, y, d) {
  S.unlocked[secretKey(fn, x, y, d)] = 1;
  const nx = x + DX[d], ny = y + DY[d];
  if (inb(nx, ny)) S.unlocked[secretKey(fn, nx, ny, (d + 2) & 3)] = 1;
}
/* 見つけた罠を覚えておき、地図に表示する（落とし穴・落とし戸・転移床は、かかった時に自動で記録） */
function noteTrap(fn, x, y) {
  const t = FL(fn).tile[cidx(x, y)];
  if (!t || !["pit", "chute", "tele", "spin"].includes(t.t)) return false;
  S.knownTraps = S.knownTraps || {};
  const m = S.knownTraps[fn] = S.knownTraps[fn] || {};
  const k = cidx(x, y), isNew = !m[k];
  m[k] = t.t;
  return isNew;
}
/* 隠しアイテム：各階の決まったマスで「調べる」と見つかる。見つけたものは S.hiddenFound["階:番号"] に記録 */
function hiddenAt(fn, x, y) {
  const list = FLOORS[fn].hidden || [];
  S.hiddenFound = S.hiddenFound || {};
  return list.findIndex((h, i) => h.at[0] === x && h.at[1] === y && !S.hiddenFound[fn + ":" + i]);
}
async function findHidden(fn, i) {
  const h = FLOORS[fn].hidden[i];
  if (h.item) {
    const c = giveItemToParty(h.item, false);
    if (!c) { Snd.play("move"); await tell("岩の隙間に何かが押し込まれている……\nだが、持ち物がいっぱいで持てない。"); return; }
    S.hiddenFound[fn + ":" + i] = 1;
    Snd.play("sparkle");
    await tell(`岩の隙間に何かが押し込まれていた！\n${c.name}は${ITEM[h.item].unk}を手に入れた。`);
  } else {
    S.hiddenFound[fn + ":" + i] = 1;
    S.gold += h.gold;
    Snd.play("sparkle");
    await tell(`足元の石をどけると、革袋が隠されていた！\n${h.gold.toLocaleString()}ゴールドを手に入れた。`);
  }
  renderParty(); saveGame();
}
/* 透視：周囲 r マスの地形（暗闇も含む）と罠を地図に書き込む。見つけた罠の数を返す。
   まだ見つけていない隠しアイテムも、地図に「✦」で印を付ける（数は revealAround.hidden） */
function revealAround(r) {
  const fn = S.pos.f;
  let s = S.explored[fn] || "0".repeat(400);
  const arr = s.split("");
  let traps = 0, hidden = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = S.pos.x + dx, y = S.pos.y + dy;
    if (!inb(x, y)) continue;
    arr[cidx(x, y)] = "1";
    if (FL(fn).tile[cidx(x, y)]) { const had = S.knownTraps && S.knownTraps[fn] && S.knownTraps[fn][cidx(x, y)]; if (noteTrap(fn, x, y) || had) traps += (["pit", "chute", "tele", "spin"].includes(FL(fn).tile[cidx(x, y)].t) ? 1 : 0); }
    const hi = hiddenAt(fn, x, y);
    if (hi >= 0) { S.hiddenSeen = S.hiddenSeen || {}; S.hiddenSeen[fn + ":" + hi] = 1; hidden++; }
  }
  revealAround.hidden = hidden;
  S.explored[fn] = arr.join("");
  saveGame();
  return traps;
}
/* 罠や呪文でランダムに飛ばされる先。鍵の扉の奥にも飛ばされることがある（床の仕掛けやイベントのマスは除く）。
   鍵の奥に閉じ込められないよう、鍵・謎の扉は「内側」からなら開けられる（behindLock） */
function randomTeleportCell() {
  const f = FL(S.pos.f), cand = [];
  for (let k = 0; k < 400; k++) if (!f.tile[k] && !f.ev[k]) cand.push([k % 20, (k / 20) | 0]);
  return cand[rand(cand.length)];
}
/* (x, y) が鍵・謎の扉の「内側」か。階の入口（上り階段）から、閉じたままの鍵・謎の扉を通らずに来られない場所なら内側 */
function behindLock(f, x, y) {
  const seen = new Uint8Array(400), [ux, uy] = f.cfg.up, start = cidx(ux, uy), q = [start]; seen[start] = 1;
  const passable = (cx, cy, d) => {
    const e = edgeAt(f, cx, cy, d);
    if (e === E_LOCK) return isUnlocked(f.n, cx, cy, d);
    if (e === E_RIDDLE) return !!S.flags["riddle" + f.n];
    return e !== E_WALL;
  };
  while (q.length) {
    const k = q.pop(), cx = k % 20, cy = (k / 20) | 0, t = f.tile[k];
    if (t && t.t === "chute") continue;
    const next = [];
    if (t && t.t === "tele") next.push(cidx(t.to[0], t.to[1]));
    else for (let d = 0; d < 4; d++) { const nx = cx + DX[d], ny = cy + DY[d]; if (inb(nx, ny) && passable(cx, cy, d)) next.push(cidx(nx, ny)); }
    for (const nk of next) if (!seen[nk]) { seen[nk] = 1; q.push(nk); }
  }
  return !seen[cidx(x, y)];
}
function markExplored() {
  const f = S.pos.f;
  let s = S.explored[f] || "0".repeat(400);
  const k = cidx(S.pos.x, S.pos.y);
  if (FL(f).dark[k]) return;
  if (s[k] !== "1") { s = s.slice(0, k) + "1" + s.slice(k + 1); S.explored[f] = s; }
}
async function tryMove() {
  const f = FL(S.pos.f), { x, y, d } = S.pos;
  const e = edgeAt(f, x, y, d);
  const k = cidx(x, y);
  if (e === E_WALL || (e === E_SECRET && !isSecretFound(f.n, x, y, d))) {
    Snd.play("bump"); vibrate(30); logMsg("いてっ！ 壁だ。");
    flashView("#b02828");
    return;
  }
  if (e === E_LOCK && !isUnlocked(f.n, x, y, d)) {
    const req = f.lockReq[k * 4 + d];
    if (hasKey(req)) {
      markUnlocked(f.n, x, y, d);
      Snd.play("door");
      if (req === "shards") await tell("三つの封印の欠片が紋章にはまり、まばゆく輝いた。\n封印の扉が、ゆっくりと開いていく……！");
      else if (KEYITEMS[req]) await tell(`${KEYITEMS[req].name}を使った。\n扉が開いた！`);
      else await tell("封印が消え去った！");
    } else if (behindLock(f, x, y)) {
      // 内側からは閂を外して開けられる（テレポーターで奥に飛ばされても閉じ込められない）
      markUnlocked(f.n, x, y, d);
      Snd.play("door");
      await tell("扉の内側には閂がかかっていた。\n閂を外すと、扉が開いた！");
    } else {
      const ev = (f.ev[k] || []).find(v => v.noStep && (v.dir === undefined || MAZE.DIRC[v.dir] === d));
      Snd.play("bump");
      await tell(ev ? ev.text : "鍵がかかっている。");
      return;
    }
  }
  if (e === E_RIDDLE && !S.flags["riddle" + f.n]) {
    if (behindLock(f, x, y)) {
      S.flags["riddle" + f.n] = 1;
      await tell("こちら側には、扉を開ける仕掛けがあった。\n仕掛けを動かすと、扉が開いた！");
    } else {
      const ok = await riddle(f.n);
      if (!ok) return;
    }
  }
  if (e === E_DOOR || e === E_LOCK || e === E_RIDDLE || e === E_SECRET) Snd.play("door"); else Snd.play("walk");
  prevCell = k;
  S.pos.x += DX[d]; S.pos.y += DY[d];
  await animForward();
  S.stats.steps++;
  if (S.light > 0) S.light--;
  if (S.ward > 0) S.ward--;
  markExplored();
  await stepEffects();
  if (!S.inMaze) return;
  await onEnterCell(false);
}
async function riddle(n) {
  const R = RIDDLES[0];
  const ans = await dialog(`<p class="riddle">扉の口が語りかけてきた。<br><br>${esc(R.q).replace(/\n/g, "<br>")}</p><input id="rdIn" maxlength="12" autocomplete="off" placeholder="答えを入力">`,
    [{ label: "立ち去る", value: null }, { label: "答える", cls: "pri", value: b => b.querySelector("#rdIn").value.trim() || false }], { title: "謎かけの扉" });
  if (ans === null) return false;
  const norm = s => s.replace(/\s/g, "").replace(/[ァ-ン]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  if (R.a.some(a => norm(a) === norm(ans))) {
    S.flags["riddle" + n] = 1; Snd.play("sparkle");
    await tell("「……正解だ」\n扉が重々しい音を立てて開いた！");
    return true;
  }
  Snd.play("trap");
  await tell("「違う！」\n扉の口から雷がほとばしった！");
  for (const c of partyChars()) if (isAlive(c)) damageChar(c, rr(3, 12));
  renderParty();
  await checkWipeOutside();
  return false;
}
function damageChar(c, n) {
  if (!isAlive(c)) return false;
  c.hp -= n;
  if (c.hp <= 0) { c.hp = 0; c.status = "dead"; c.poison = 0; S.stats.deaths++; return true; }
  return false;
}
async function stepEffects() {
  const f = FL(S.pos.f), k = cidx(S.pos.x, S.pos.y);
  const died = [];
  for (const c of partyChars()) {
    if (!isAlive(c) || c.status === "stone") continue;
    if (c.poison && damageChar(c, 1)) died.push(c.name + "は毒で死んだ");
    for (const it of c.items) if (it.eq) {
      const d = ITEM[it.id];
      if (d.regen && c.hp > 0 && c.hp < c.maxhp) c.hp++;
      if (d.drainHp && damageChar(c, d.drainHp)) died.push(c.name + "は呪いの力で死んだ");
    }
  }
  if (f.swamp[k]) {
    Snd.play("hurt");
    logMsg("毒の沼に足をとられた！");
    for (const c of partyChars()) if (isAlive(c) && c.status !== "stone") {
      if (damageChar(c, 1)) died.push(c.name + "は沼に沈んだ"); // 1歩ごとに1（HPの少ない魔術師でも歩けるように）
      else if (chance(0.2) && !raceResist(c, "poison")) c.poison = 1;
    }
  }
  renderParty();
  for (const m of died) await tell(m + "……");
  await checkWipeOutside();
}
async function checkWipeOutside() {
  if (partyChars().every(c => isDisabled(c))) await partyWiped();
}

/* マスに入ったときの処理 */
async function onEnterCell(noRandom) {
  const f = FL(S.pos.f), k = cidx(S.pos.x, S.pos.y);
  drawView();
  // 遺体
  const bi = S.bodies.findIndex(b => b.f === f.n && b.x === S.pos.x && b.y === S.pos.y);
  if (bi >= 0) await foundBodies(bi);
  const t = f.tile[k];
  // 固定イベント
  let fought = false;
  const sameRoom = f.roomOf[k] >= 0 && f.roomOf[k] === f.roomOf[prevCell];
  for (const ev of (f.ev[k] || [])) {
    if (ev.noStep) continue;
    if (ev.once && S.flags[ev.once]) continue;
    const isRoomEv = (ev.t === "fight" || ev.t === "boss" || ev.t === "gift");
    const atCell = cidx(...ev.at) === k;
    if (isRoomEv && sameRoom) continue;
    if (!isRoomEv && !atCell) continue;
    if (ev.t === "msg") { Snd.play("move"); await tell(ev.text); if (ev.once) S.flags[ev.once] = 1; }
    else if (ev.t === "fight" || ev.t === "boss") {
      if (ev.t === "boss") await bossIntro();
      else if (ev.text) await tell(ev.text);
      fought = true;
      const r = await battle(ev.mons, { fixed: true, boss: ev.t === "boss", once: ev.once, reward: ev.reward });
      if (!S.inMaze) return;
      if (r === "win") {
        if (ev.once) S.flags[ev.once] = 1;
        if (ev.t === "boss") {
          Bgm.stop(2);
          await tell("モルヴァン「……星喰いの声が……遠のいていく……。\n私はただ……終わらない見張りから、この町を……」");
          await tell("灰の司祭モルヴァンは、灰となって崩れ落ちた。\n床に転がった星灯が、淡く輝いている……。");
        }
        await giveReward(ev.reward);
        if (ev.t === "boss") { await ending(); await exitMaze(null); }
      }
      if (r !== "win") return;
    } else if (ev.t === "altar") {
      if (!S.cleared || fought) continue;
      await altarEvent();
      if (!S.inMaze) return;
    } else if (ev.t === "gift") {
      S.flags[ev.once] = 1;
      Snd.play("sparkle");
      await tell(ev.text);
      await giveReward(ev.reward);
    } else if (ev.t === "treasure") {
      S.flags[ev.once] = 1;
      await tell("宝箱が置かれている！");
      await chestEvent({ gold: ev.gold || 0, items: ev.item ? [{ id: ev.item, known: false }] : [], trapLv: f.n });
    } else if (ev.t === "alarm") {
      Snd.play("trap");
      await tell("足元の板を踏んだ瞬間、警報が鳴り響いた！");
      fought = true;
      const r = await battle(null, {});
      if (!S.inMaze || r !== "win") return;
    } else if (ev.t === "fountain") {
      const drink = await confirmBox(ev.text + "\n水を飲んでみますか？", "飲む", "飲まない");
      if (drink) {
        for (const c of partyChars()) if (isAlive(c) && c.status !== "stone") { c.hp = c.maxhp; c.poison = 0; }
        Snd.play("heal"); renderParty();
        await tell("冷たく清らかな水だ。体の芯から力がみなぎる！\n（全員のHPが回復し、毒が消えた）");
      }
    }
  }
  if (!S.inMaze) return;
  // 床の仕掛け
  if (t) {
    if (t.t === "spin") { S.pos.d = rand(4); drawView(); }
    else if (t.t === "pit") {
      Snd.play("fall"); vibrate(80);
      noteTrap(f.n, S.pos.x, S.pos.y);
      await pitFx();
      await tell("落とし穴だ！");
      await fallDamage(c => chance(clamp((c.st.agi - 8) * 0.04, 0, 0.5)) ? 0 : rr(1, 3 + f.n * 2));
      await checkWipeOutside(); if (!S.inMaze) return;
    } else if (t.t === "chute") {
      Snd.play("fall"); vibrate(120);
      noteTrap(f.n, S.pos.x, S.pos.y);
      await tell("床が抜けた！\nパーティは下の階へ落ちていく――");
      await elevatorRide(f.n, f.n + 1, "fall", [S.pos.x, S.pos.y]);
      await changeFloor(f.n + 1, S.pos.x, S.pos.y);
      Snd.play("land"); stageShake(); vibrate(120);
      await fallDamage(() => rr(1, 8));
      await checkWipeOutside();
      return;
    } else if (t.t === "tele") {
      Snd.play("tele");
      noteTrap(f.n, S.pos.x, S.pos.y);
      await warpFx(async () => { prevCell = -1; S.pos.x = t.to[0]; S.pos.y = t.to[1]; markExplored(); drawView(); });
      await tell("突然、体がねじれるような感覚に襲われた！\nどこかへ飛ばされたようだ……");
      return onEnterCell(true);
    } else if (t.t === "up") {
      logMsg("上り階段がある。");
      if (await stairsPrompt("上り階段がある。", "のぼる")) {
        Snd.play("stairs");
        if (f.n === 1) return exitMaze("パーティは迷宮を抜け、地上の町へ戻った。");
        await elevatorRide(f.n, f.n - 1, "stairs", [S.pos.x, S.pos.y]);
        await changeFloor(f.n - 1, S.pos.x, S.pos.y);
        return;
      }
    } else if (t.t === "down") {
      logMsg("下り階段がある。");
      if (await stairsPrompt("下り階段がある。", "おりる")) {
        Snd.play("stairs");
        await elevatorRide(f.n, f.n + 1, "stairs", [S.pos.x, S.pos.y]);
        await changeFloor(f.n + 1, S.pos.x, S.pos.y);
        return;
      }
    } else if (t.t === "elev") {
      S.elev[f.n] = 1;
      await elevator();
      return;
    }
  }
  // ランダムエンカウント：戦闘のあとENC_GRACE歩は出ない。そこから歩くほど確率が上がり、ENC_MAX歩で必ず戦闘になる
  // 行き倒れの冒険者（地下2階から。1つの階に来るたび最大1回）
  if (!fought && !noRandom && f.n >= 2 && !wanderMet && !t && !f.ev[k] && chance(WANDER_RATE)) {
    wanderMet = true;
    await wandererEvent(f.n);
    return;
  }
  if (!fought && !noRandom) {
    S.encSteps = (S.encSteps || 0) + 1;
    // 魔除けの祈りの間は、敵が出ない歩数を延ばし、確率も下げる（戦闘の回数がおよそ半分になる）
    const ward = S.ward > 0, n = S.encSteps - (ward ? 8 : ENC_GRACE), max = ward ? 60 : ENC_MAX;
    const p = n <= 0 ? 0 : n >= max ? 1 : (f.cfg.encRate + ENC_STEP * (n - 1)) * (ward ? 0.35 : 1);
    if (chance(p)) await battle(null, {});
  }
}
/* 階段・昇降機の上にいるときの専用ボタン */
async function useTile() {
  const f = FL(S.pos.f), t = f.tile[cidx(S.pos.x, S.pos.y)];
  if (!t) return;
  if (t.t !== "elev") Snd.play("stairs");
  if (t.t === "up") {
    if (f.n === 1) return exitMaze("パーティは迷宮を抜け、地上の町へ戻った。");
    await elevatorRide(f.n, f.n - 1, "stairs", [S.pos.x, S.pos.y]);
    await changeFloor(f.n - 1, S.pos.x, S.pos.y);
  } else if (t.t === "down") { await elevatorRide(f.n, f.n + 1, "stairs", [S.pos.x, S.pos.y]); await changeFloor(f.n + 1, S.pos.x, S.pos.y); }
  else if (t.t === "elev") await elevator();
}
/* 落とし穴・落とし戸のダメージ。roll(c) が0ならその人はかわした。誰が何ダメージ受けたかをまとめて出す */
async function fallDamage(roll) {
  const lines = [];
  for (const c of partyChars()) {
    if (!isAlive(c) || c.status === "stone") continue;
    const d = roll(c);
    if (!d) { lines.push(`${c.name}は身をかわした。`); continue; }
    const died = damageChar(c, d);
    popParty(c.id, "-" + d, "hurt"); shakeParty(c.id);
    lines.push(died ? `${c.name}は${d}のダメージを受け、死んだ！` : `${c.name}は${d}のダメージを受けた。`);
  }
  renderParty();
  if (lines.length) { Snd.play("hurt"); await tell(lines.join("\n")); }
}
async function stairsPrompt(text, act) {
  const r = await choose([{ label: act, value: true, cls: "pri" }, { label: "そのまま", value: false }], { title: text });
  return r;
}
/* ────────── 行き倒れの冒険者 ──────────
   助ける：回復の薬（無ければ僧侶の回復呪文1回分）を使う。お礼がもらえ、悪の仲間が善に傾くことがある。
           ただし2割は、行き倒れを装ったならず者の罠で、不意打ちを受ける。
   身ぐるみを剥ぐ：お金と品を奪えるが、善の仲間が悪に傾くことがある。 */
const WANDER_RATE = 0.003; // 1歩あたり。100歩でおよそ4人に1回、階を一通り歩く（約380歩）とおよそ3回に2回出会う
let wanderMet = false; // この階に来てからもう出会ったか（階を移るたびに戻す）
/* 行き倒れの冒険者の種類。bg は背景画像（wizrpg/bg/〇〇.jpg）、who は罠だったときの呼び方 */
const WANDER_TYPES = [
  { bg: "wanderer", who: "男", text: "フードを被った男が、壁際で浅い息をしている。\n「水を……いや、薬があれば……」" },
  { bg: "wanderer_warrior", who: "戦士", text: "壁にもたれた戦士が、かすれた声で呼びかけてきた。\n「た、助けてくれ……仲間とはぐれて、もう歩けない……」" },
  { bg: "wanderer_mage", who: "魔術師", text: "ローブの魔術師がうずくまっている。\n「ここまで来て……こんな所で……。頼む、薬を……」" },
  { bg: "wanderer_rogue", who: "盗賊", text: "血の跡をたどると、覆面の盗賊が倒れていた。\n「頼む……見逃さないでくれ……」" },
];
function tiltAlign(from, to, p) {
  for (const c of partyChars()) if (c.align === from && CLASSES[c.cls].align.includes(to) && chance(p)) {
    c.align = to;
    logMsg(to === "G" ? `${c.name}の心に善の灯がともった…（性格が善になった）` : `${c.name}の心は闇に染まった…（性格が悪になった）`);
  }
}
// 助けるときに使うもの：回復の薬（安いものから）→ 僧侶系の回復呪文1回分 → 何も無ければ手当てだけ
function spendAid() {
  for (const id of ["potion", "potion2", "potion3"]) for (const c of partyChars()) {
    const i = c.items.findIndex(it => it.id === id && !it.eq);
    if (i >= 0) { c.items.splice(i, 1); return `${c.name}は${ITEM[id].name}を分け与えた。`; }
  }
  for (const sid of ["mend", "mend2", "mend3"]) for (const c of partyChars()) {
    if (c.status === "ok" && c.known.includes(sid) && spellSlotsLeft(c, SPELL[sid]) > 0) { c.mpP[SPELL[sid].lv - 1]--; return `${c.name}は「${SPELL[sid].name}」を唱えた。`; }
  }
  return "薬も呪文もない。布を裂いて、できるだけの手当てをした。";
}
/* 助けた冒険者が、その階でまだ見つけていないものを1つ教えてくれる。
   隠された品物は地図に ✦ を書き込んでもらえる。回転床は地図に印が付く */
function wandererHint(fn) {
  const f = FL(fn);
  // おおまかな場所（北＝yが大きい方）
  const area = (x, y) => { const ns = y >= 13 ? "北" : y <= 6 ? "南" : "", ew = x >= 13 ? "東" : x <= 6 ? "西" : ""; return ns || ew ? `${ns}${ew}のあたり` : "まん中あたり"; };
  const deadEnd = (x, y) => [0, 1, 2, 3].filter(d => { const e = edgeAt(f, x, y, d); return e === E_WALL || (e === E_SECRET && !isSecretFound(fn, x, y, d)); }).length >= 3;
  const cands = [];
  S.hiddenFound = S.hiddenFound || {}; S.hiddenSeen = S.hiddenSeen || {};
  (FLOORS[fn].hidden || []).forEach((h, i) => {
    const key = fn + ":" + i; if (S.hiddenFound[key] || S.hiddenSeen[key]) return;
    const [x, y] = h.at;
    cands.push({ w: 3, go: () => { S.hiddenSeen[key] = 1; return `「礼に、いいことを教えてやる。\n${area(x, y)}の${deadEnd(x, y) ? "行き止まり" : "通路"}で、床の石が一つだけ緩んでいた。\n何か埋まっていそうだったが、掘り出す力が残っていなくてな」\n冒険者は、地図にその場所の印を書き込んでくれた。`; } });
  });
  (FLOORS[fn].ev || []).forEach(e => {
    if (e.t !== "treasure" || (e.once && S.flags[e.once])) return;
    cands.push({ w: 2, go: () => `「礼に、いいことを教えてやる。\n${area(...e.at)}の奥で、手つかずの宝箱を見かけた。\n俺たちには、もう開ける余力がなかった……」` });
  });
  for (let k = 0; k < 400; k++) for (let d = 0; d < 2; d++) {
    const x = k % 20, y = (k / 20) | 0;
    if (edgeAt(f, x, y, d) !== E_SECRET || isSecretFound(fn, x, y, d)) continue;
    cands.push({ w: 2, go: () => `「礼に、いいことを教えてやる。\n${area(x, y)}に、壁の向こうから風が吹いてくる場所があった。\nあの壁、どこかが開くのかもしれん」` });
  }
  for (let k = 0; k < 400; k++) {
    const t = f.tile[k], x = k % 20, y = (k / 20) | 0;
    if (!t || t.t !== "spin" || (S.knownTraps && S.knownTraps[fn] && S.knownTraps[fn][k])) continue;
    cands.push({ w: 1, go: () => { noteTrap(fn, x, y); return `「気をつけろ。\n${area(x, y)}に、踏むと向きを狂わされる床がある。\n俺はあれで道を見失った」\n冒険者は、地図にその床の印を書き込んでくれた。`; } });
  }
  // この階の怪物が落とす宝箱から出ることのある、値打ちのある品（randomLoot と同じ段階の品から選ぶ）
  const maxT = Math.min(5, Math.floor((fn + 1) / 2)), have = new Set(S.roster.flatMap(c => c.items.map(it => it.id)));
  const rare = ITEMS.filter(it => it.tier >= 1 && (it.tier === maxT || it.tier === maxT - 1) && it.price >= 500 && !it.cursed && it.t !== "use" && !have.has(it.id) && it.id !== "oborozuki");
  if (rare.length) {
    // 上の段階の品ほど選ばれやすくする
    const it = pick(rare.flatMap(r => r.tier === maxT ? [r, r] : [r]));
    cands.push({ w: 4, go: () => `「礼に、いい話を教えてやる。\nこの階の怪物が抱えている宝箱から、〈${it.name}〉が出たことがあるんだ。\n『${it.unk}』を拾ったら、鑑定してみるといい」` });
  }
  if (!cands.length) return pick(["「この階のことは、もうあんたたちの方が詳しそうだ……\n下の階は、ここよりずっと手強いと聞く。気をつけてな」", "「俺にはもう、この迷宮は無理だ……\nあんたたちなら、きっと奥まで行ける」"]);
  let r = Math.random() * cands.reduce((s, c) => s + c.w, 0);
  return (cands.find(c => (r -= c.w) < 0) || cands[0]).go();
}
async function wandererEvent(fn) {
  const sc = $("scene");
  sc.className = "on chest";
  const wt = pick(WANDER_TYPES);
  setSceneBg(wt.bg); // wizrpg/bg/ の画像があれば背景に出す（無ければ絵文字）
  sc.innerHTML = `<div class="plc"><div class="pg">🧎</div><div class="pn">行き倒れの冒険者</div></div>`;
  $("hud").textContent = "🧎 行き倒れ";
  try {
    Snd.play("move");
    await tell(wt.text);
    const k = await choose([
      { label: "助ける", value: "help", cls: "pri" }, { label: "身ぐるみを剥ぐ", value: "rob" }, { label: "立ち去る", value: "leave" },
    ], { title: "どうする？", cols: 3 });
    if (k === "help") {
      await tell(spendAid());
      renderParty();
      if (chance(0.2)) {
        // 罠だった
        Snd.play("trap");
        await tell(`手当てをしようと屈んだその時、倒れていた${wt.who}がにやりと笑った。\n「……かかったな！」\n物陰から、武器を構えた一団が飛び出してきた！`);
        sc.className = ""; sc.innerHTML = "";
        const humans = MONSTERS.filter(m => m.type === "human" && m.fl[0] && fn >= m.fl[0] && fn <= m.fl[1] && !m.boss);
        // 人間の敵を2種類（同じ種類になったら1つのグループにまとめる）
        let spec = null;
        if (humans.length) {
          spec = [];
          for (let i = 0; i < 2; i++) { const d = pick(humans), n = rr(d.grp[0], d.grp[1]), same = spec.find(s => s[0] === d.id); if (same) same[1] = Math.min(9, same[1] + n); else spec.push([d.id, n]); }
        }
        await battle(spec, { ambush: true });
        return;
      }
      const gold = rr(15, 40) * fn;
      S.gold += gold;
      const items = chance(0.4) ? randomLoot(fn, 1) : [];
      const got = items.map(it => { const c = giveItemToParty(it.id, false); return c ? `${c.name}は${ITEM[it.id].unk}を受け取った。` : ""; }).filter(Boolean);
      Snd.play("sparkle");
      await tell(`冒険者は礼を言った。\n「この恩は忘れない……これを持っていってくれ」\n${gold.toLocaleString()}ゴールドを受け取った。${got.length ? "\n" + got.join("\n") : ""}`);
      await tell(wandererHint(fn));
      await tell("冒険者は、よろめきながら上り階段の方へ去っていった。");
      tiltAlign("E", "G", 0.25);
    } else if (k === "rob") {
      const gold = rr(40, 100) * fn;
      S.gold += gold;
      const items = chance(0.7) ? randomLoot(fn, 1) : [];
      const got = items.map(it => { const c = giveItemToParty(it.id, false); return c ? `${c.name}は${ITEM[it.id].unk}を奪った。` : ""; }).filter(Boolean);
      Snd.play("buy");
      await tell(`抵抗する力も残っていない相手から、持ち物を奪い取った。\n${gold.toLocaleString()}ゴールドを手に入れた。${got.length ? "\n" + got.join("\n") : ""}`);
      tiltAlign("G", "E", 0.35);
    } else {
      await tell("冒険者をその場に残して、先へ進んだ……");
    }
    renderParty(); saveGame();
  } finally {
    if (!BT) { sc.className = ""; sc.innerHTML = ""; renderParty(); if (S.inMaze) drawView(); }
  }
}

async function changeFloor(n, x, y) {
  wanderMet = false;
  S.pos.f = n; S.pos.x = x; S.pos.y = y;
  prevCell = -1;
  preloadMonImgs(n);
  Bgm.play(floorBgm(n));
  S.deepest = Math.max(S.deepest, n);
  markExplored();
  await texWait(n);
  drawView();
  preloadFloor(n + 1);
  logMsg(`地下${n}階「${FLOORS[n].name}」`);
  saveGame(true);
}
async function elevator() {
  const floors = [];
  for (let n = 1; n <= 9; n++) {
    const reached = !!S.elev[n];
    floors.push({ label: `地下${n}階`, value: n, disabled: n === S.pos.f || !reached, sub: n === S.pos.f ? "現在地" : reached ? "" : "未到達" });
  }
  Snd.play("elevator");
  logMsg("昇降機を操作中……");
  const n = await choose(floors, { title: "昇降機だ。どの階へ行く？", cols: 3, cancel: true, cancelLabel: "降りない" });
  if (!n) { logMsg("昇降機の操作をやめた。"); return; }
  Snd.play("elevator");
  const e = FLOORS[n].elev;
  await elevatorRide(S.pos.f, n);
  await changeFloor(n, e[0], e[1]);
  Snd.play("clank");
  const st = $("stage"); st.classList.remove("encshake"); void st.offsetWidth; st.classList.add("encshake");
  vibrate(60);
  S.elev[n] = 1;
  await tell(`昇降機は地下${n}階で止まった。`);
  for (const ev of (FL(n).ev[cidx(...e)] || [])) if (ev.t === "msg") await tell(ev.text);
}
/* 昇降機の移動の演出。下りなら、今の階の景色が上へ流れながら暗くなり、縦穴の中（壁の梁や通り過ぎる階の明かり）を下って、
   目的の階の景色が下からせり上がりながら明るくなって止まる。上りは向きが逆。
   目的の階の景色は先に描いて写しておく（着いたら同じ絵が本物の画面に入れ替わる）。
   kind："elev"＝昇降機 / "stairs"＝階段（短く、縦穴は見せない）/ "fall"＝落とし戸で落ちる（加速して落ち、岩肌が速く流れる）。
   dest：着く位置 [x, y]（省略すると、その階の昇降機の位置） */
async function elevatorRide(from, to, kind = "elev", dest = null) {
  const st = $("stage"), cv = $("view"), W = cv.width, H = cv.height;
  if (!W || !H) return;
  const snap = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; c.getContext("2d").drawImage(cv, 0, 0); return c; };
  const A = snap();
  await texWait(to);
  const keep = { ...S.pos }, hud = $("hud").innerHTML, [ex, ey] = dest || FLOORS[to].elev;
  S.pos = { ...S.pos, f: to, x: ex, y: ey }; drawView();
  const B = snap();
  S.pos = keep; drawView(); $("hud").innerHTML = hud;
  const fx = document.createElement("canvas"); fx.className = "elevfx"; fx.width = W; fx.height = H; st.appendChild(fx);
  const g = fx.getContext("2d"), down = to > from, sg = down ? -1 : 1; // 下りは景色が上へ（マイナス方向へ）流れる
  const slow = walkSpeed() === "off" ? .6 : 1;
  const T = (kind === "stairs" ? 750 : kind === "fall" ? 950 : Math.min(3200, 1300 + Math.abs(to - from) * 260)) * slow;
  const ease = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const easeOut = kind === "fall" ? t => t * t * t : ease; // 落ちるときは、出発した階の景色が加速して流れ去る
  const draw = p => {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    // 縦穴：岩肌の帯と、鉄の梁が流れていく（階段では見せない。落ちるときは速く流れる）
    const vis = kind === "stairs" ? 0 : Math.sin(Math.PI * p), scroll = sg * p * H * (kind === "fall" ? 6 : 2 + Math.abs(to - from));
    for (let i = -1; i < 7 && vis > 0; i++) {
      const y = ((i * H / 5 + scroll) % (H * 1.4) + H * 1.4) % (H * 1.4) - H * .2;
      g.fillStyle = `rgba(70,62,54,${(.35 * vis).toFixed(3)})`; g.fillRect(0, y, W, H * .07);
      g.fillStyle = `rgba(150,130,100,${(.25 * vis).toFixed(3)})`; g.fillRect(0, y, W, Math.max(1, H * .006));
    }
    // 通り過ぎる階の明かり（昇降機だけ。階の数だけ、橙色の光が横切る）
    const n = kind === "elev" ? Math.abs(to - from) : 0;
    for (let k = 1; k < n; k++) {
      const q = (p - .25) / .5 * n - k + .5; // 0〜1 の間に画面を横切る
      if (q < 0 || q > 1) continue;
      const y = down ? H * (1.1 - q * 1.2) : H * (-.1 + q * 1.2);
      const gr = g.createLinearGradient(0, y - H * .12, 0, y + H * .12);
      gr.addColorStop(0, "rgba(255,170,80,0)"); gr.addColorStop(.5, `rgba(255,170,80,${(.35 * vis).toFixed(3)})`); gr.addColorStop(1, "rgba(255,170,80,0)");
      g.fillStyle = gr; g.fillRect(0, y - H * .12, W, H * .24);
    }
    // 出発した階の景色：流れ去りながら暗くなる
    if (p < .45) {
      const q = easeOut(p / .45);
      g.save(); g.globalAlpha = 1 - q; g.drawImage(A, 0, sg * H * .9 * q); g.restore(); // 景色だけを暗く（縦穴の帯は消さない）
    }
    // 着く階の景色：反対側からせり上がり（下り）／下りてきて（上り）、明るくなる
    if (p > .55) {
      const q = ease((p - .55) / .45);
      g.save(); g.globalAlpha = q; g.drawImage(B, 0, -sg * H * .9 * (1 - q)); g.restore();
    }
    // 通過中の階（昇降機だけ）
    if (kind === "elev") {
      const cur = Math.round(from + (to - from) * clamp((p - .1) / .8, 0, 1));
      $("hud").innerHTML = `昇降機 ${down ? "▼" : "▲"} 地下${cur}階`;
    }
  };
  await animate(T, draw);
  fx.remove();
}
/* 落とし穴の演出：景色が加速して上へずれ（穴に落ちる）、底に着いた瞬間に「ドスン」と揺れ、ゆっくり元に戻る（はい上がる） */
async function pitFx() {
  const st = $("stage"), cv = $("view"), W = cv.width, H = cv.height;
  if (!W || !H) return;
  const A = document.createElement("canvas"); A.width = W; A.height = H; A.getContext("2d").drawImage(cv, 0, 0);
  const fx = document.createElement("canvas"); fx.className = "elevfx"; fx.width = W; fx.height = H; st.appendChild(fx);
  const g = fx.getContext("2d"), T = walkSpeed() === "off" ? 700 : 1000;
  let landed = false;
  const draw = p => {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    let off, dark;
    if (p < .3) { const q = p / .3; off = -H * .35 * q * q; dark = .55 * q; }
    else {
      if (!landed) { landed = true; Snd.play("land"); stageShake(); vibrate(100); }
      const q = clamp((p - .45) / .55, 0, 1), e = 1 - (1 - q) ** 2; off = -H * .35 * (1 - e); dark = .55 * (1 - e);
    }
    g.drawImage(A, 0, off);
    g.fillStyle = `rgba(0,0,0,${dark.toFixed(3)})`; g.fillRect(0, 0, W, H);
  };
  await animate(T, draw);
  fx.remove();
}
/* 瞬間移動の演出。今の景色が青白い光の粒と一緒に渦を巻きながら真ん中へ吸い込まれ、暗闇に小さな星が瞬いたあと、
   行き先の景色が渦を巻きながら真ん中から広がって現れる。apply の中で実際に位置を移す（その間は前の景色を映しておく）。
   光過敏への配慮で、画面全体を白く光らせることはしない */
async function warpFx(apply) {
  const st = $("stage"), cv = $("view"), W = cv.width, H = cv.height;
  if (!W || !H) { await apply(); return; }
  const snap = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; c.getContext("2d").drawImage(cv, 0, 0); return c; };
  const A = snap();
  const fx = document.createElement("canvas"); fx.className = "elevfx"; fx.width = W; fx.height = H; st.appendChild(fx);
  const g = fx.getContext("2d"); g.drawImage(A, 0, 0);
  await apply();
  const B = snap();
  const T = walkSpeed() === "off" ? 900 : 1500, cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
  const parts = Array.from({ length: 70 }, () => ({ a: Math.random() * 7, r: .15 + Math.random() * .85, s: .6 + Math.random() * .8, z: 1 + Math.random() * 2 }));
  const ease = t => t * t * (3 - 2 * t);
  // k：大きさ（0〜1）、rot：回転、round：丸く切り抜く度合い（0＝画面全体、1＝丸）。渦に吸い込まれるほど丸くなる
  const swirl = (img, k, rot, alpha, round) => {
    if (k <= .01 || alpha <= 0) return;
    const rad = R * (1 - round) + H * .5 * round;
    g.save(); g.globalAlpha = alpha; g.translate(cx, cy); g.rotate(rot); g.scale(k, k);
    g.beginPath(); g.arc(0, 0, rad, 0, 7); g.clip(); g.drawImage(img, -W / 2, -H / 2); g.restore();
  };
  const draw = p => {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    if (p < .45) { const q = ease(p / .45); swirl(A, 1 - q * .96, q * 2.2, 1 - q * .6, Math.min(1, q * 2.5)); }
    if (p > .55) { const q = ease((p - .55) / .45); swirl(B, .04 + q * .96, -(1 - q) * 2.2, .4 + q * .6, Math.min(1, (1 - q) * 2.5)); }
    // 光の粒：前半は真ん中へ、後半は真ん中から外へ、渦を巻いて動く
    const inward = p < .5, q = inward ? ease(p / .5) : ease((p - .5) / .5), vis = Math.sin(Math.PI * p);
    for (const pt of parts) {
      const rr = (inward ? pt.r * (1 - q) : pt.r * q) * R * .9, aa = pt.a + (inward ? q : -q) * 3 * pt.s;
      const x = cx + Math.cos(aa) * rr, y = cy + Math.sin(aa) * rr * .8, sz = pt.z * (H / 300);
      g.fillStyle = `rgba(190,215,255,${(.75 * vis).toFixed(3)})`; g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    // 真ん中の小さな星（全体は光らせない）
    const star = Math.max(0, 1 - Math.abs(p - .5) / .12);
    if (star > 0) {
      const r = H * .08 * star, gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(220,235,255,${(.85 * star).toFixed(3)})`); gr.addColorStop(1, "rgba(150,180,255,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
    }
  };
  await animate(T, draw);
  fx.remove();
}
/* 封印の祭壇（クリア後）。星灯を取り除くと、封印の奥の星喰いが目を覚ます */
async function altarEvent() {
  if (S.flags.hoshikui) { await tell("祭壇の上で、星灯が静かに輝いている。\n地の底は、もう何も語らない。"); return; }
  await tell("祭壇の上で、星灯が静かに輝いている。\n耳を澄ますと、封印の奥から、低いうなりがかすかに響いてくる……。");
  const k = await choose([{ label: "立ち去る", value: "leave", cls: "pri" }, { label: "星灯を取り除く", value: "take", cls: "danger" }], { title: "封印の祭壇", cols: 2 });
  if (k !== "take") return;
  const ok = await dialog(`<p>星灯を祭壇から取り除きますか？</p><p class="warn">封印がほどけ、地の底に眠るものが目を覚ます。</p>`,
    [{ label: "やめる", value: false, cls: "pri" }, { label: "取り除く", value: true, cls: "danger" }], { title: "封印を解く", small: true });
  if (!ok) return;
  Snd.play("rumble"); Bgm.stop(1.5);
  await tell("星灯を持ち上げた瞬間、祭壇の間が大きく揺れた。\n床の紋様がひび割れ、底知れない闇が口を開ける……。");
  await tell("闇の底から、無数の星をまとった巨大な影がせり上がってきた。\n――星喰いが、目を覚ました。");
  const r = await battle([["hoshikui", 1], ["demonlord", 3]], { fixed: true, boss: true, once: "hoshikui" });
  if (!S.inMaze) return;
  if (r !== "win") { await tell("星灯がひとりでに祭壇へ戻り、闇はふたたび閉ざされた……。"); return; }
  S.flags.hoshikui = 1; Bgm.stop(2);
  await tell("星喰いの体が、光の粒となって砕け散っていく。\n星のかけらが雪のように降りそそぎ、やがて静けさが戻った。");
  await giveReward({ gold: 50000, item: "stareye" });
  await tell("パーティは星灯を祭壇に戻した。\n封印はもう、何も閉じ込めてはいない。\nそれでも星灯は、変わらず町を照らし続けるだろう。");
  for (const c of partyChars()) if (isAlive(c)) c.honor = 2;
  Snd.play("levelup");
  await tell("生き残った冒険者たちは『星喰いを討ちし者』の称号（金色の★）を授けられた。");
  await tell("星喰いが討たれたと聞いて、町の冒険者たちのわだかまりも解けていった。\nこれからは、善と悪の者も同じパーティで旅ができる。");
  saveGame(true);
}
async function bossIntro() {
  Snd.play("rumble");
  await tell("祭壇の間――。\n灰色の法衣の男が、奪った星灯を掲げて何かを唱えている。");
  await tell("灰の司祭モルヴァン「……来たか。かつて封印の守り人だった私が、なぜ星灯を奪ったか分かるか？」");
  await tell("モルヴァン「星喰いこそ、この地の真の主。封印などという檻はもう終わりだ！」");
}
async function giveReward(rw) {
  if (!rw) return;
  for (const k of [].concat(rw.key || [])) { S.keys[k] = 1; Snd.play("sparkle"); await tell(`${KEYITEMS[k].name}を手に入れた！\n（${KEYITEMS[k].desc}）`); }
  if (rw.gold) { S.gold += rw.gold; await tell(`${rw.gold.toLocaleString()}ゴールドを見つけた！`); }
  if (rw.item) {
    const c = giveItemToParty(rw.item, false);
    await tell(c ? `${c.name}は${ITEM[rw.item].unk}を手に入れた。` : "持ち物がいっぱいで、アイテムを持てなかった……");
  }
  renderParty(); saveGame();
}
async function foundBodies(bi) {
  const b = S.bodies[bi];
  // 以前のセーブで同じ場所に別々に残っている亡骸は、ここで1つにまとめる
  for (let i = S.bodies.length - 1; i > bi; i--) { const o = S.bodies[i]; if (o.f === b.f && o.x === b.x && o.y === b.y) { b.ids.push(...o.ids.filter(id => !b.ids.includes(id))); S.bodies.splice(i, 1); } }
  const chars = b.ids.map(charById).filter(Boolean);
  if (!chars.length) { S.bodies.splice(bi, 1); return; }
  const names = chars.map(c => c.name).join("、");
  Snd.play("lose");
  const room = 6 - S.party.length;
  if (room <= 0) { await tell(`${names}の亡骸が横たわっている……\n（パーティに空きがないので運べない）`); return; }
  if (!(await confirmBox(`${names}の亡骸が横たわっている……\n連れて帰りますか？`, "連れて行く", "そのまま"))) return;
  const take = chars.slice(0, room);
  for (const c of take) { S.party.push(c.id); c.where = "maze"; }
  b.ids = b.ids.filter(id => !take.some(c => c.id === id));
  if (!b.ids.length) S.bodies.splice(bi, 1);
  renderParty(); saveGame(true);
  await tell(`${take.map(c => c.name).join("、")}をパーティに加えた。\n町の聖堂で蘇生してもらおう。`);
}
async function partyWiped() {
  Bgm.play("wipe"); // 全滅の曲（町へ戻ると、町の曲に替わる）
  Snd.play("lose");
  $("scene").className = "on wipe";
  setSceneBg("wipe");
  $("scene").innerHTML = `<div class="plc"><div class="pg">💀</div><div class="pn">全滅</div></div>`;
  await tell("パーティは全滅した……");
  const members = partyChars();
  if (S.rule === "classic") {
    // 同じ場所に亡骸があれば、そこへまとめる（踏んだとき一度に見つかるように）
    const here = S.bodies.find(b => b.f === S.pos.f && b.x === S.pos.x && b.y === S.pos.y);
    if (here) here.ids.push(...members.map(c => c.id).filter(id => !here.ids.includes(id)));
    else S.bodies.push({ f: S.pos.f, x: S.pos.x, y: S.pos.y, ids: members.map(c => c.id) });
    for (const c of members) { c.where = "lost"; c.poison = 0; c.bac = 0; if (isAlive(c) && c.status !== "stone" && c.status !== "para") c.status = "dead"; }
    S.party = [];
    S.inMaze = false; S.light = 0; S.ward = 0;
    saveGame(true);
    await tell(`冒険者たちの亡骸は、地下${S.pos.f}階に残された。\n新たなパーティを組んで回収に向かおう。\n（訓練所で新しい冒険者を作れる）`);
    throw new ToTown();
  } else {
    for (const c of members) { c.where = "town"; c.poison = 0; c.bac = 0; if (isAlive(c) && c.status !== "stone" && c.status !== "para") c.status = "dead"; }
    S.gold = Math.floor(S.gold / 2);
    S.inMaze = false; S.light = 0; S.ward = 0;
    saveGame(true);
    await tell("通りがかった冒険者が、君たちを町へ運び戻してくれた。\n（所持金が半分になった。聖堂で蘇生しよう）");
    throw new ToTown();
  }
}

/* ────────── 岩の中 ──────────
   テレポーターの罠や瞬間移動の行き先が岩だったときの事故。
   本格ルール：パーティは岩に閉ざされ、二度と戻らない（仲間は名簿から消える）。救済ルール：全滅と同じ扱い */
const inRock = (fn, x, y) => !!(FL(fn).rock && FL(fn).rock[cidx(x, y)]);
async function buriedInRock() {
  Bgm.play("wipe"); // 全滅の曲（町へ戻ると、町の曲に替わる）
  Snd.play("lose"); vibrate(200);
  $("scene").className = "on wipe";
  setSceneBg("wipe");
  $("scene").innerHTML = `<div class="plc"><div class="pg">🪨</div><div class="pn">岩の中</div></div>`;
  await tell("視界が戻ったとき、四方はすべて岩に閉ざされていた。\n指一本、動かすことができない……");
  const members = partyChars();
  if (S.rule === "classic") {
    for (const c of members) removeLost(c);
    S.party = []; S.inMaze = false; S.light = 0; S.ward = 0;
    saveGame(true);
    await tell(`${members.map(c => c.name).join("、")}は、岩の中に消えた。\n彼らが戻ることは、二度となかった。`);
    throw new ToTown();
  }
  for (const c of members) { c.where = "town"; c.poison = 0; c.bac = 0; if (isAlive(c) && c.status !== "stone" && c.status !== "para") c.status = "dead"; }
  S.gold = Math.floor(S.gold / 2);
  S.inMaze = false; S.light = 0; S.ward = 0;
  saveGame(true);
  await tell("通りがかった鉱夫たちが岩を掘り崩し、君たちを町へ運び戻してくれた。\n（所持金が半分になった。聖堂で蘇生しよう）");
  throw new ToTown();
}
/* 岩のマスを加える前の記録で、中断した場所や遺体が岩になったマスにある場合は、近くの歩けるマスへ移す */
function nearestOpen(fn, x, y) {
  let best = [x, y], bd = 1e9;
  for (let k = 0; k < 400; k++) {
    if (FL(fn).rock[k]) continue;
    const cx = k % 20, cy = (k / 20) | 0, dd = Math.abs(cx - x) + Math.abs(cy - y);
    if (dd < bd) { bd = dd; best = [cx, cy]; }
  }
  return best;
}
function fixRockPositions() {
  if (S.pos && inRock(S.pos.f, S.pos.x, S.pos.y)) [S.pos.x, S.pos.y] = nearestOpen(S.pos.f, S.pos.x, S.pos.y);
  for (const b of S.bodies || []) if (inRock(b.f, b.x, b.y)) [b.x, b.y] = nearestOpen(b.f, b.x, b.y);
}

/* ────────── 調べる ────────── */
async function searchHere() {
  const f = FL(S.pos.f), { x, y, d } = S.pos;
  const e = edgeAt(f, x, y, d);
  if (e === E_SECRET && !isSecretFound(f.n, x, y, d)) {
    markSecret(f.n, x, y, d);
    Snd.play("sparkle");
    drawView();
    await tell("壁を調べた……\n隠し扉を見つけた！");
    return;
  }
  const hi = hiddenAt(f.n, x, y);
  if (hi >= 0) { await findHidden(f.n, hi); return; }
  const around = [0, 1, 2, 3].some(dd => edgeAt(f, x, y, dd) === E_SECRET && !isSecretFound(f.n, x, y, dd));
  Snd.play("move");
  await tell(around ? "何も見つからない。\n……だが、どこかから隙間風を感じる。" : "あたりを調べたが、何も見つからなかった。");
}

/* ────────── キャンプ ────────── */
async function campMenu() {
  while (S.inMaze) {
    $("hud").textContent = "⛺ キャンプ中";
    const hasSpell = partyChars().some(c => isAlive(c) && c.status === "ok" && c.known.some(s => SPELL[s].use.includes("c")));
    const k = await choose([
      { label: "状態・装備", value: "status" },
      { label: "呪文を唱える", value: "spell", disabled: !hasSpell },
      { label: "まとめて回復", value: "heal", disabled: !canAutoHeal() },
      { label: "鑑定", value: "ident", disabled: !canPartyIdent() },
      { label: "並び替え", value: "order" },
      { label: "大事なもの", value: "keys" },
      { label: "図鑑", value: "book" },
      { label: "設定", value: "opt" },
      { label: "中断してタイトルへ", value: "quit" },
    ], { cancel: true, cancelLabel: "キャンプを出る", title: "⛺ キャンプ" });
    if (!k) return;
    // 閉じたら仲間の一覧に戻る（一覧で「もどる」を押すとキャンプのメニューへ）
    if (k === "status") { let c; while ((c = await pickMember("誰の状態を見る？"))) { await charSheet(c, "camp"); renderParty(); } }
    else if (k === "spell") {
      let c;
      while ((c = await pickMember("誰が呪文を唱える？", c => isAlive(c) && c.status === "ok" && c.known.some(s => SPELL[s].use.includes("c"))))) { await campCast(c); renderParty(); }
    }
    else if (k === "heal") await autoHeal();
    else if (k === "ident") await partyIdent();
    else if (k === "order") await reorderParty();
    else if (k === "keys") {
      const ks = Object.keys(S.keys).filter(k => S.keys[k]);
      await dialog(ks.length ? ks.map(k => `<p><b>${KEYITEMS[k].name}</b><br><small>${KEYITEMS[k].desc}</small></p>`).join("") : "<p>なにも持っていない。</p>", null, { title: "大事なもの" });
    }
    else if (k === "book") await monsterBook();
    else if (k === "opt") await settingsDialog();
    else if (k === "quit") {
      if (await confirmBox("冒険を中断してタイトルに戻りますか？\n（今いる場所から再開できます）")) { saveGame(true); location.reload(); return; }
    }
    renderParty();
  }
}
/* ────────── まとめて回復 ──────────
   回復呪文（回復・中回復・大回復）を使える仲間が、けがの重い人から順に自動で唱える。
   弱い呪文から使い、強い呪文は残す。ほとんど無駄になる（回復量の半分も減っていない）ときは唱えない。
   完全回復・蘇生・毒などの治療は、ここでは使わない */
const AUTO_HEALS = ["mend", "mend2", "mend3"];
function healExpect(id, lvl) {
  const h = HEAL_SPELL[id], m = h.dice.match(/(\d+)d(\d+)(?:\+(\d+))?/);
  return Math.min(h.cap, +m[1] * (+m[2] + 1) / 2 + +(m[3] || 0) + h.per * lvl);
}
const healCasters = () => partyChars().filter(c => c.status === "ok").flatMap(c =>
  AUTO_HEALS.filter(id => c.known.includes(id) && spellSlotsLeft(c, SPELL[id]) > 0).map(id => ({ c, sp: SPELL[id], exp: healExpect(id, c.lvl) })));
const hurtMembers = () => partyChars().filter(c => isAlive(c) && c.status !== "stone" && c.hp < c.maxhp);
const canAutoHeal = () => hurtMembers().length > 0 && healCasters().length > 0;
async function autoHeal() {
  if (S.inMaze && FL(S.pos.f).anti[cidx(S.pos.x, S.pos.y)]) { Snd.play("cancel"); await alertBox("ここでは魔法が封じられている。"); return; }
  if (!hurtMembers().length) { await alertBox("回復が必要な仲間はいない。"); return; }
  if (!healCasters().length) { await alertBox("回復の呪文を唱えられる仲間がいない。"); return; }
  const count = {}, before = {}; partyChars().forEach(c => before[c.id] = c.hp);
  for (let guard = 0; guard < 300; guard++) {
    const opts = healCasters().sort((a, b) => a.sp.lv - b.sp.lv || b.exp - a.exp);
    if (!opts.length) break;
    // けがの重い人から。その人に唱えて無駄にならない、いちばん弱い呪文を選ぶ
    let done = false;
    for (const t of hurtMembers().sort((a, b) => (b.maxhp - b.hp) - (a.maxhp - a.hp))) {
      const miss = t.maxhp - t.hp, o = opts.find(x => miss >= x.exp * 0.5);
      if (!o) continue;
      t.hp = Math.min(t.maxhp, t.hp + healAmount(o.sp, o.c, t));
      spendSlot(o.c, o.sp);
      count[o.sp.name] = (count[o.sp.name] || 0) + 1;
      done = true; break;
    }
    if (!done) break;
  }
  renderParty(); saveGame();
  const used = Object.entries(count).map(([n, k]) => `${n}を${k}回`).join("、");
  if (!used) { await alertBox("どの傷も浅く、呪文を使うほどではない。"); return; }
  Snd.play("heal");
  const healed = partyChars().filter(c => c.hp > before[c.id]).map(c => `${c.name}　${before[c.id]} → ${c.hp}${c.hp >= c.maxhp ? "（全快）" : ""}`);
  const left = hurtMembers().some(c => (c.maxhp - c.hp) >= c.maxhp * 0.25);
  await alertBox(`${used}唱えた。\n${healed.join("\n")}${left ? "\n\n呪文が足りず、まだ傷の深い仲間がいる。" : ""}`, "まとめて回復");
}
async function settingsDialog() {
  await dialog(settingsHtml(), null, { title: "設定", onOpen: settingsBind });
}
const TOWN_SPELL_EFFS = ["heal", "cure", "fullheal", "raise", "raise2"];
/* 今いる場所で唱えられる呪文か（町では回復・治療・蘇生だけ） */
const castableHere = sp => sp.use.includes("c") && (S.inMaze || TOWN_SPELL_EFFS.includes(sp.eff));
function spellSlotsLeft(c, sp) { const arr = sp.sc === "M" ? c.mpM : c.mpP; return arr[sp.lv - 1] || 0; }
async function campCast(c) {
  if (c.status !== "ok") { await alertBox(`${c.name}は呪文を唱えられる状態ではない。`); return; }
  const list = SPELLS.filter(s => c.known.includes(s.id) && castableHere(s));
  const sid = await listPick(`${c.name}の呪文`, list.map(s => ({ html: spellRowHtml(s), right: `残${spellSlotsLeft(c, s)}`, value: s.id, disabled: spellSlotsLeft(c, s) <= 0 })), spellListOpt());
  if (!sid) return;
  const sp = SPELL[sid];
  if (S.inMaze && FL(S.pos.f).anti[cidx(S.pos.x, S.pos.y)]) {
    spendSlot(c, sp);
    Snd.play("cancel"); await alertBox("呪文を唱えたが、何も起こらない……\n（ここでは魔法が封じられている）");
    return;
  }
  const ok = await castOutside(c, sp, false);
  if (ok) spendSlot(c, sp);
  renderParty(); saveGame();
}
/* 戦闘外の呪文効果。実行したらtrue */
async function castOutside(c, sp, fromItem) {
  const inMaze = S.inMaze;
  const tgtFilter = {
    heal: x => isAlive(x) && x.status !== "stone", fullheal: x => isAlive(x),
    cure: x => isAlive(x) && (sp.cures.includes("poison") ? x.poison : sp.cures.includes(x.status)),
    raise: x => x.status === "dead", raise2: x => x.status === "dead" || x.status === "ash",
  }[sp.eff];
  let t = null;
  if (tgtFilter) {
    t = await pickMember(`${sp.name}：誰に？`, tgtFilter);
    if (!t) return false;
  }
  const say = async m => { renderParty(); await alertBox(m); };
  switch (sp.eff) {
    case "heal": { const n = healAmount(sp, c, t, fromItem); t.hp = Math.min(t.maxhp, t.hp + n); Snd.play(ITEM_SND[fromItem] || SPELL_SND[sp.id] || "heal"); await say(`${t.name}のHPが${n}回復した。`); return true; }
    case "fullheal": { t.hp = t.maxhp; t.poison = 0; if (t.status !== "dead" && t.status !== "ash") t.status = "ok"; Snd.play(SPELL_SND[sp.id] || "heal"); await say(`${t.name}は完全に回復した！`); return true; }
    case "cure": { if (sp.cures.includes("poison")) t.poison = 0; else t.status = "ok"; Snd.play(SPELL_SND[sp.id] || "heal"); await say(`${t.name}は治った。`); return true; }
    case "raise": {
      if (chance(clamp(50 + t.st.vit * 2, 50, 90) / 100)) { t.status = "ok"; t.hp = 1; t.st.vit = Math.max(3, t.st.vit - 1); await ritual(t.name, "ok"); await say(`${t.name}は生き返った！`); }
      else { t.status = "ash"; await ritual(t.name, "ash"); await say(`失敗した……${t.name}は灰になってしまった。`); }
      return true;
    }
    case "raise2": {
      if (t.status === "ash" && chance(0.05)) { t.status = "lost"; await ritual(t.name, "lost"); await say(`${t.name}は……消え去ってしまった。`); removeLost(t); return true; }
      t.status = "ok"; t.hp = t.maxhp; await ritual(t.name, "ok"); await say(`${t.name}は完全に蘇った！`); return true;
    }
    case "ward": { if (!inMaze) break; S.ward = Math.max(S.ward || 0, sp.val); Snd.play(SPELL_SND[sp.id] || "light"); drawView(); await say("静かな祈りが、パーティを包み込んだ。\n怪物の気配が遠のいていく……"); return true; }
    case "light": { if (!inMaze) break; S.light = Math.max(S.light, sp.val); Snd.play(SPELL_SND[sp.id] || "light"); drawView(); await say("あたりが魔法の光で照らされた。"); return true; }
    case "reveal": {
      if (!inMaze) break;
      Snd.play(SPELL_SND[sp.id] || "light");
      const found = revealAround(1); // 自分のまわり3×3マスだけ
      const hid = revealAround.hidden;
      await say(`周囲の様子が、頭の中にはっきりと浮かび上がった……\n（地図に書き込んだ。${found ? `罠を${found}か所見つけた` : "罠は見当たらない"}${hid ? `。何かが隠されている場所が${hid}か所ある` : ""}）`);
      return true;
    }
    case "identify": { S.identAll = true; Snd.play(SPELL_SND[sp.id] || "light"); await say("怪物の正体が見抜けるようになった。"); return true; }
    case "escape": {
      if (!inMaze) break;
      if (!(await confirmBox("地上の町へ帰還しますか？\n（所持金の半分を失う）"))) return false;
      Snd.play("tele"); S.gold = Math.floor(S.gold / 2);
      if (!fromItem) spendSlot(c, sp);
      await exitMaze("まばゆい光に包まれ、パーティは地上の町へ帰還した。");
      return true;
    }
    case "teleport": {
      if (!inMaze) break;
      const dest = await teleportPicker();
      if (!dest) return false;
      Snd.play("tele");
      if (dest === "castle") { if (!fromItem) spendSlot(c, sp); await exitMaze("パーティは地上の町へ瞬間移動した。"); return true; }
      // 別の階へ飛ぶときは、階段と同じ処理で階を移る（BGM・敵の絵の先読み・行き倒れの冒険者などもそろえる）
      await warpFx(async () => {
        if (dest.f !== S.pos.f) await changeFloor(dest.f, dest.x, dest.y);
        else { prevCell = -1; S.pos.x = dest.x; S.pos.y = dest.y; markExplored(); drawView(); saveGame(true); }
      });
      await alertBox(`パーティは地下${dest.f}階（東${dest.x}・北${dest.y}）へ瞬間移動した。`);
      await onEnterCell(true);
      return true;
    }
    case "trapsense": await say("宝箱の前でなければ意味がない。"); return false;
  }
  await say("今は効果がない。");
  return false;
}
function removeLost(t) { S.roster = S.roster.filter(x => x.id !== t.id); S.party = S.party.filter(i => i !== t.id); }
function teleportPicker() {
  let f = S.pos.f, x = S.pos.x, y = S.pos.y;
  const maxF = Math.min(9, S.deepest);
  return dialog(`<p>行き先を指定する。<br><small>（地下10階へは魔力に阻まれて移動できない）</small></p><div class="tp"></div>`, [
    { label: "やめる", value: null }, { label: "町へ", value: "castle" }, { label: "移動する", cls: "pri", value: () => ({ f, x, y }) },
  ], { title: "瞬間移動", onOpen: b => {
    const box = b.querySelector(".tp");
    box.innerHTML = [["f", "階", 1, maxF], ["x", "東へ", 0, 19], ["y", "北へ", 0, 19]].map(([k, l, a, bb]) => `<div class="bprow"><span>${l}</span><button data-k="${k}" data-d="-1" data-a="${a}" data-b="${bb}">－</button><b data-v="${k}"></b><button data-k="${k}" data-d="1" data-a="${a}" data-b="${bb}">＋</button></div>`).join("");
    // 数字だけを書き換える（ボタンを作り直すと、コントローラのカーソルが外れて連打できなくなるため）
    const draw = () => { box.querySelector('[data-v="f"]').textContent = "地下" + f; box.querySelector('[data-v="x"]').textContent = x; box.querySelector('[data-v="y"]').textContent = y; };
    box.querySelectorAll("button").forEach(bt => bt.onclick = () => { const d = +bt.dataset.d, a = +bt.dataset.a, bb = +bt.dataset.b; if (bt.dataset.k === "f") f = clamp(f + d, a, bb); if (bt.dataset.k === "x") x = clamp(x + d, a, bb); if (bt.dataset.k === "y") y = clamp(y + d, a, bb); Snd.play("move"); draw(); });
    draw();
  } });
}

/* ────────── オートマップ ────────── */
async function showAutomap() {
  let fl = S.pos.f;
  await dialog(`<div class="mapnav"><button data-d="-1">▲</button><b id="mapTitle"></b><button data-d="1">▼</button></div><canvas id="amap"></canvas><div class="maplegend">▲自分　<span style="color:#7dd3fc">↑↓</span>階段　<span style="color:#fbbf24">E</span>昇降機　<span style="color:#c08040">━</span>扉　<span style="color:#f87171">━</span>鍵のかかった扉<br><span style="color:#f87171">●</span>落とし穴　<span style="color:#fb923c">▼</span>落とし戸　<span style="color:#c084fc">◎</span>転移床　<span style="color:#fbbf24">↻</span>回転床　<span style="color:#fde68a">✦</span>何かありそう　<span style="color:#8a7a68">■</span>岩　<span style="color:#8080a8">▨</span>暗闇</div>`,
    null, { title: "地図", onOpen: b => {
      const draw = () => { b.querySelector("#mapTitle").textContent = `地下${fl}階 ${FLOORS[fl].name}` + (fl === S.pos.f ? `（東${S.pos.x}・北${S.pos.y}）` : ""); drawAutomap(b.querySelector("#amap"), fl); };
      const cv = b.querySelector("#amap");
      cv.onclick = e => {
        const r = cv.getBoundingClientRect(), cs = (r.width - 16) / 20;
        const mx = Math.floor((e.clientX - r.left - 8) / cs), my = 19 - Math.floor((e.clientY - r.top - 8) / cs);
        if (mx < 0 || my < 0 || mx > 19 || my > 19) return;
        S.mapMarks = S.mapMarks || {}; const mm = S.mapMarks[fl] = S.mapMarks[fl] || {};
        const k = cidx(mx, my), next = MAP_MARKS[(MAP_MARKS.indexOf(mm[k] || "") + 1) % MAP_MARKS.length];
        if (next) mm[k] = next; else delete mm[k];
        Snd.play("move"); saveGame(); draw();
      };
      b.querySelectorAll(".mapnav button").forEach(bt => bt.onclick = () => { const n = fl + (+bt.dataset.d); if (n >= 1 && n <= 10 && S.explored[n]) { fl = n; Snd.play("move"); draw(); } });
      draw();
    } });
}
const MAP_MARKS = ["", "！", "？", "★", "✕"]; // 地図の自分用の印
function drawAutomap(cv, fn) {
  const f = FL(fn);
  const ex = S.explored[fn] || "0".repeat(400);
  const size = Math.min(cv.parentElement.clientWidth - 30, 420); // 親(sbody)の左右の余白ぶんを引く
  const dpr = window.devicePixelRatio || 1;
  cv.style.width = size + "px"; cv.style.height = size + "px";
  cv.width = size * dpr; cv.height = size * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  paintAutomap(g, fn, size);
}
/* 地図の中身を描く（全体の地図と、灯りの間に出るミニマップで共通） */
function paintAutomap(g, fn, size) {
  const f = FL(fn), ex = S.explored[fn] || "0".repeat(400);
  // 外周の壁の線が端で切れたり、角丸で隠れたりしないよう、周りに余白をとる
  const pad = 8, cs = (size - pad * 2) / 20;
  g.fillStyle = "#0b0d12"; g.fillRect(0, 0, size, size);
  g.strokeStyle = "#1a1f2a"; g.lineWidth = 1;
  for (let i = 0; i <= 20; i++) { g.beginPath(); g.moveTo(pad + i * cs, pad); g.lineTo(pad + i * cs, size - pad); g.stroke(); g.beginPath(); g.moveTo(pad, pad + i * cs); g.lineTo(size - pad, pad + i * cs); g.stroke(); }
  const sx = x => pad + x * cs, sy = y => pad + (19 - y) * cs;
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const k = cidx(x, y);
    if (ex[k] !== "1") continue;
    if (f.rock[k]) { g.fillStyle = "#4a4038"; g.fillRect(sx(x), sy(y), cs, cs); continue; }
    g.fillStyle = f.dark[k] ? "#06060a" : f.swamp[k] ? "#1f3a24" : f.anti[k] ? "#2a2440" : "#1c2536";
    g.fillRect(sx(x) + 0.5, sy(y) + 0.5, cs - 1, cs - 1);
    // 暗闇のマス（透視で書き込んだもの）：ほぼ黒の地に、斜めの点線で暗闇だと分かるようにする
    if (f.dark[k]) {
      g.save(); g.beginPath(); g.rect(sx(x) + 0.5, sy(y) + 0.5, cs - 1, cs - 1); g.clip();
      g.strokeStyle = "rgba(120,120,160,.55)"; g.lineWidth = 1; g.setLineDash([1.5, 2.5]);
      for (let t = -cs; t < cs; t += cs / 3) { g.beginPath(); g.moveTo(sx(x) + t, sy(y) + cs); g.lineTo(sx(x) + t + cs, sy(y)); g.stroke(); }
      g.restore();
    }
    for (let d = 0; d < 4; d++) {
      let e = f.walls[k * 4 + d];
      if (e === E_OPEN) continue;
      if (e === E_SECRET && !isSecretFound(fn, x, y, d)) e = E_WALL;
      const x0 = sx(x), y0 = sy(y);
      const seg = [[x0, y0, x0 + cs, y0], [x0 + cs, y0, x0 + cs, y0 + cs], [x0, y0 + cs, x0 + cs, y0 + cs], [x0, y0, x0, y0 + cs]][d];
      g.strokeStyle = e === E_WALL ? "#c8d0e0" : (e === E_LOCK || e === E_RIDDLE) && !isUnlocked(fn, x, y, d) && !(e === E_RIDDLE && S.flags["riddle" + fn]) ? "#f87171" : "#c08040";
      g.lineWidth = e === E_WALL ? 1.5 : 3;
      g.beginPath(); g.moveTo(seg[0], seg[1]); g.lineTo(seg[2], seg[3]); g.stroke();
    }
    const t = f.tile[k];
    if (t) {
      const lab = { up: "↑", down: "↓", elev: "E" }[t.t];
      if (lab) { g.fillStyle = t.t === "elev" ? "#fbbf24" : "#7dd3fc"; g.font = `bold ${cs * 0.7}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(lab, sx(x) + cs / 2, sy(y) + cs / 2 + 1); }
    }
  }
  // 見つけた罠
  const TRAP_MARK = { pit: ["●", "#f87171"], chute: ["▼", "#fb923c"], tele: ["◎", "#c084fc"], spin: ["↻", "#fbbf24"] };
  const kt = (S.knownTraps && S.knownTraps[fn]) || {};
  for (const k in kt) {
    const [ch, col] = TRAP_MARK[kt[k]] || ["?", "#fff"];
    const x = k % 20, y = (k / 20) | 0;
    g.fillStyle = col; g.font = `bold ${cs * 0.72}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(ch, sx(x) + cs / 2, sy(y) + cs / 2 + 1);
  }
  // 透視で見つけた、まだ拾っていない隠しアイテム
  (FLOORS[fn].hidden || []).forEach((h, i) => {
    const key = fn + ":" + i;
    if (!(S.hiddenSeen && S.hiddenSeen[key]) || (S.hiddenFound && S.hiddenFound[key])) return;
    g.fillStyle = "#fde68a"; g.font = `bold ${cs * 0.72}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("✦", sx(h.at[0]) + cs / 2, sy(h.at[1]) + cs / 2 + 1);
  });
  // 自分で付けた印
  const mm = (S.mapMarks && S.mapMarks[fn]) || {};
  for (const k in mm) {
    const x = k % 20, y = (k / 20) | 0;
    g.fillStyle = "rgba(250,250,250,.14)"; g.fillRect(sx(x) + 1, sy(y) + 1, cs - 2, cs - 2);
    g.fillStyle = "#f5f5f5"; g.font = `bold ${cs * 0.72}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(mm[k], sx(x) + cs / 2, sy(y) + cs / 2 + 1);
  }
  S.bodies.filter(b => b.f === fn).forEach(b => { g.fillStyle = "#f87171"; g.font = `${cs * 0.7}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("✝", sx(b.x) + cs / 2, sy(b.y) + cs / 2); });
  if (fn === S.pos.f) {
    const cx = sx(S.pos.x) + cs / 2, cy = sy(S.pos.y) + cs / 2;
    g.save(); g.translate(cx, cy); g.rotate(S.pos.d * Math.PI / 2);
    g.fillStyle = "#4ade80"; g.beginPath(); g.moveTo(0, -cs * 0.38); g.lineTo(cs * 0.3, cs * 0.3); g.lineTo(-cs * 0.3, cs * 0.3); g.closePath(); g.fill();
    g.restore();
  }
}

/* ────────── ミニマップ ──────────
   灯り・大灯りが効いている間だけ、迷宮の画面の右上に、自分のまわり9×9マスの地図を出す（北が上）。
   全体の地図を見えないキャンバスに描いておき、自分のまわりだけ切り出す。暗闇の中では出さない */
const MINI = { cv: null, key: "", N: 9, BIG: 420, SC: 2 };
// ミニマップを押すと、全体の地図を開く
document.addEventListener("click", e => { if (e.target && e.target.id === "mini" && inputResolver) inputResolver("map"); });
function drawMini() {
  const el = $("mini"); if (!el) return;
  const on = !!(S && S.inMaze && S.pos && S.light > 0 && !f_isDark());
  el.style.display = on ? "block" : "none";
  if (!on) return;
  const { N, BIG, SC } = MINI, fn = S.pos.f;
  const key = [fn, S.pos.x, S.pos.y, S.pos.d, S.explored[fn], JSON.stringify((S.mapMarks && S.mapMarks[fn]) || 0), JSON.stringify((S.knownTraps && S.knownTraps[fn]) || 0), S.bodies.length].join("|");
  if (!MINI.cv) { MINI.cv = document.createElement("canvas"); MINI.cv.width = MINI.cv.height = BIG * SC; }
  if (MINI.key !== key) { MINI.key = key; const g0 = MINI.cv.getContext("2d"); g0.setTransform(SC, 0, 0, SC, 0, 0); paintAutomap(g0, fn, BIG); }
  const w = el.clientWidth; if (!w) return;
  const px = Math.round(w * Math.min(2, window.devicePixelRatio || 1));
  if (el.width !== px) el.width = el.height = px;
  const g = el.getContext("2d");
  g.fillStyle = "#0b0d12"; g.fillRect(0, 0, px, px);
  const pad = 8, cs = (BIG - pad * 2) / 20, sw = N * cs * SC;
  const sx = (pad + (S.pos.x - (N - 1) / 2) * cs) * SC, sy = (pad + (19 - S.pos.y - (N - 1) / 2) * cs) * SC;
  // 階の端では、地図の外にはみ出すぶんを切り落として描く
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(BIG * SC, sx + sw), y1 = Math.min(BIG * SC, sy + sw), k = px / sw;
  g.drawImage(MINI.cv, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
}

/* ────────── 歩く動き ──────────
   前進：新しいマスの景色を、カメラを1マス後ろから前へ滑らせて描く。
   向きを変える：前の景色と新しい景色を横に流して入れ替える。
   長さは設定の「歩く動き」（なし／はやい／ふつう）。テンポを崩さないよう短くしている */
const VA = { dz: 0 };
const easeOut = t => 1 - (1 - t) * (1 - t);
function walkMs(kind) {
  const m = { off: 0, fast: 1, normal: 1.7 }[walkSpeed()];
  return m ? (kind === "turn" ? 80 : 100) * m : 0;
}
// 歩く動きも、core.js の animate（時間が来たら必ず終わる）を使う
async function animForward() {
  const ms = walkMs("move");
  if (!ms || document.hidden) return;
  await animate(ms, t => { VA.dz = 1 - easeOut(t); drawView(); });
  VA.dz = 0; drawView();
}
async function animTurn(dir) {
  const nd = (S.pos.d + (dir === -1 ? 3 : dir)) & 3;
  const ms = walkMs("turn") * (dir === 2 ? 1.4 : 1);
  if (!ms || document.hidden || f_isDark()) { S.pos.d = nd; drawView(); return; }
  const cv = $("view");
  const snap = () => { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; c.getContext("2d").drawImage(cv, 0, 0); return c; };
  drawView(); const before = snap();
  S.pos.d = nd; drawView(); const after = snap();
  const g = cv.getContext("2d"), W = cv.width, sg = dir === -1 ? -1 : 1;
  // 右を向くと景色は左へ流れる
  await animate(ms, t => { const e = easeOut(t); g.drawImage(before, -sg * W * e, 0); g.drawImage(after, sg * W * (1 - e), 0); });
  drawView();
}
const f_isDark = () => { const f = FL(S.pos.f); return !!f.dark[cidx(S.pos.x, S.pos.y)]; };

/* ────────── 3D表示 ────────── */
/* 壁にぶつかった・転移したときに、画面全体へ一瞬うっすら色をかぶせる
   （背景に塗ると、壁に隠れない奥の暗い所だけが色づいてしまうので、描き終わった上から重ねる） */
function flashView(col) {
  drawView();
  const cv = $("view"), g = cv.getContext("2d");
  g.save(); g.globalAlpha = 0.2; g.fillStyle = col; g.fillRect(0, 0, cv.width, cv.height); g.restore(); // 光過敏への配慮で薄めにする
  setTimeout(() => { if (document.body.dataset.mode === "maze") drawView(); }, 120);
}
function sizeCanvas(cv) {
  // 描く細かさは横960ドットまで（パソコンの大きな画面で、描く量が増えて歩くのが重くならないように）
  const w = cv.clientWidth, h = cv.clientHeight;
  const dpr = Math.min(2 * uiZoom, (window.devicePixelRatio || 1) * uiZoom, w ? 960 / w : 2); // 横長の画面で拡大しているぶんも細かく描く
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  return dpr;
}
/* ────────── 迷宮のテクスチャ ──────────
   wizrpg/tex/ に wall.jpg / door.jpg / floor.jpg / ceiling.jpg を置くと、壁・扉・床・天井に貼られる。
   wall_b3.jpg のように階番号付きの画像があれば、その階だけ差し替わる。無ければ今までどおりコードで描く。 */
const TEX = {}; // 名前 -> { st: "loading" | "ok" | "ng", img }
const TEX_AUTO_SEAMLESS = true; // 読み込んだ画像の継ぎ目を自動でなじませる（最初から継ぎ目のない画像だけ使うなら false でもよい）
/* 画像の端を、半分ずらした自分自身と混ぜて、端どうしが必ずつながるようにする。
   壁は左右だけ（上下は床と天井に接するので不要）、床・天井は上下左右。扉は1枚で完結するので処理しない。 */
function makeSeamless(img, horiz, vert) {
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0);
    const src = g.getImageData(0, 0, w, h), out = g.createImageData(w, h);
    const s = src.data, o = out.data, band = 0.28; // 端から28%の幅でなじませる
    const ramp = t => { t = clamp(t / band, 0, 1); return t * t * (3 - 2 * t); };
    for (let y = 0; y < h; y++) {
      const wy = vert ? ramp(Math.min(y, h - 1 - y) / h) : 1;
      const sy = vert ? (y + (h >> 1)) % h : y;
      for (let x = 0; x < w; x++) {
        const wx = horiz ? ramp(Math.min(x, w - 1 - x) / w) : 1;
        const sx = horiz ? (x + (w >> 1)) % w : x;
        const a = Math.min(wx, wy), i = (y * w + x) * 4, j = (sy * w + sx) * 4;
        o[i] = s[i] * a + s[j] * (1 - a); o[i + 1] = s[i + 1] * a + s[j + 1] * (1 - a); o[i + 2] = s[i + 2] * a + s[j + 2] * (1 - a); o[i + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
    return cv;
  } catch (e) { return img; } // 読み込み元の制限などで処理できない環境では、そのまま使う
}
function texLoad(name) {
  let t = TEX[name];
  if (!t) {
    t = TEX[name] = { st: "loading", img: new Image() };
    t.img.onload = () => {
      const kind = name.split("_")[0];
      if (TEX_AUTO_SEAMLESS && kind !== "door") t.img = makeSeamless(t.img, true, kind !== "wall");
      t.st = "ok"; if (document.body.dataset.mode === "maze") drawView();
    };
    t.img.onerror = () => { t.st = "ng"; };
    t.img.src = `wizrpg/tex/${name}.jpg`;
  }
  return t.st === "ok" ? t.img : null;
}
const texFor = (kind, n) => texLoad(`${kind}_b${n}`) || texLoad(kind);
/* その階のテクスチャを読み込み終わるまで待つ（読み込み前に描くと、コードで描いた仮の壁が一瞬見えるため）。
   通信が遅いときに止まったままにならないよう、待つのは長くても ms まで */
function texWait(n, ms = 2500) {
  const names = ["wall", "door", "floor", "ceiling"].flatMap(k => [`${k}_b${n}`, k]);
  names.forEach(texLoad);
  return Promise.race([new Promise(res => { const chk = () => names.every(nm => TEX[nm].st !== "loading") ? res() : setTimeout(chk, 40); chk(); }), sleep(ms)]);
}
// 次に行きそうな階の画像を、裏で先に読み込んでおく
function preloadFloor(n) { if (!FLOORS[n]) return; texWait(n); preloadMonImgs(n); }

/* ────────── 迷宮の空気 ──────────
   深い階（地下6〜10階）では細かい塵がゆっくり漂い（深いほど多い）、水の多い階（地下2・7階）ではときどき天井から水滴が落ちて音が鳴る。
   迷宮を歩いている間だけ動かす（戦闘中・町・画面が見えないときは止める）。明るさが揺れる演出は使わない */
const Amb = (() => {
  let cv = null, g = null, running = false, last = 0, nextDrip = 0, floor = 0;
  let dust = [], drops = [];
  const DUST = n => n >= 6 ? 12 + (n - 6) * 7 : 0;
  const WET = n => n === 2 || n === 7;
  const active = () => S && S.inMaze && S.pos && document.body.dataset.mode === "maze" && !BT && !document.hidden && (DUST(S.pos.f) || WET(S.pos.f));
  function reset(n) {
    floor = n;
    dust = Array.from({ length: DUST(n) }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * .00003, vy: -.00001 - Math.random() * .00002, a: .12 + Math.random() * .22, s: .6 + Math.random() * 1.2 }));
    drops = []; nextDrip = performance.now() + 2000 + Math.random() * 4000;
  }
  function frame(now) {
    if (!active()) { running = false; if (g) g.clearRect(0, 0, cv.width, cv.height); return; }
    if (S.pos.f !== floor) reset(S.pos.f);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const dt = Math.min(50, now - (last || now)); last = now;
    g.clearRect(0, 0, W, H);
    for (const p of dust) {
      p.x = (p.x + p.vx * dt + 1) % 1; p.y = (p.y + p.vy * dt + 1) % 1;
      g.fillStyle = `rgba(210,195,165,${p.a})`; g.fillRect(p.x * W, p.y * H, p.s, p.s);
    }
    if (WET(S.pos.f) && now > nextDrip) {
      drops.push({ x: .15 + Math.random() * .7, y: .02, v: 0, splash: 0 });
      nextDrip = now + 4000 + Math.random() * 7000;
    }
    for (const d of drops) {
      if (!d.splash) {
        d.v += .0000045 * dt; d.y += d.v * dt;
        g.fillStyle = "rgba(170,200,230,.55)"; g.fillRect(d.x * W - .75, d.y * H - 5, 1.5, 5);
        if (d.y > .8) { d.splash = 1; Snd.play("drip"); }
      } else {
        d.splash += dt / 400;
        const r = d.splash * W * .025;
        g.strokeStyle = `rgba(170,200,230,${(.45 * (1 - d.splash)).toFixed(3)})`; g.lineWidth = 1;
        g.beginPath(); g.ellipse(d.x * W, .8 * H, r, r * .3, 0, 0, 7); g.stroke();
      }
    }
    drops = drops.filter(d => d.splash < 1);
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || !active()) return;
    if (!cv) { cv = document.createElement("canvas"); cv.className = "ambfx"; $("stage").appendChild(cv); g = cv.getContext("2d"); }
    running = true; last = 0; requestAnimationFrame(frame);
  }
  return { start };
})();
// 別のタブなどから戻ったら、迷宮の空気をすぐ再開する（次に歩くまで止まったままにしない）
document.addEventListener("visibilitychange", () => { if (!document.hidden) Amb.start(); });

/* 昇降機の鉄の模様をプログラムで作る（一度作ったら使い回す）。細かいざらつき・錆のしみ・引っかき傷。
   端で途切れないよう、しみと傷は上下左右にずらした位置にも描いて、並べたときにつながるようにする */
const PROC_TEX = {};
function procTex(kind) {
  if (PROC_TEX[kind]) return PROC_TEX[kind];
  const N = 128, cv = document.createElement("canvas"); cv.width = cv.height = N;
  const g = cv.getContext("2d");
  let seed = kind === "rust" ? 7 : 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const [r0, g0, b0] = kind === "rust" ? [118, 76, 44] : [88, 82, 74];
  const img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) { const n = (rnd() - .5) * 34; img.data[i * 4] = r0 + n; img.data[i * 4 + 1] = g0 + n; img.data[i * 4 + 2] = b0 + n * .9; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const wrap = draw => { for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.save(); g.translate(ox, oy); draw(); g.restore(); } };
  for (let i = 0; i < 9; i++) {
    const x = rnd() * N, y = rnd() * N, r = 8 + rnd() * 22, a = .18 + rnd() * .25;
    wrap(() => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(138,72,30,${a})`); gr.addColorStop(1, "rgba(138,72,30,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); });
  }
  for (let i = 0; i < 12; i++) {
    const x = rnd() * N, y = rnd() * N, l = 6 + rnd() * 20, an = rnd() * Math.PI, a = .12 + rnd() * .12;
    wrap(() => { g.strokeStyle = `rgba(210,200,180,${a})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l); g.stroke(); });
  }
  return (PROC_TEX[kind] = cv);
}

/* ────────── 立体の絵（昇降機・上り階段・下り階段）──────────
   Blender で作ったモデルを、ゲームと同じ見え方で、位置と向きごとに描き出した絵（wizrpg/obj3d/。作り方は make_obj3d.py）。
   絵は必要になったときに読み込み、読み込めるまで（または絵が無いとき）は、今までの線画で描く。
   枚数を減らすため、左側の位置は右側の絵を左右反転して使い、3〜4マス先は2マス先の絵を縮めて使う。
   明るさは均一に描き出してあるので、遠いほど暗くする処理はここでかける */
const OBJ3D = { img: {}, shaded: {} };
function objSprite(kind, dd, l, rel) {
  const man = window.OBJ3D_DATA && window.OBJ3D_DATA[kind]; if (!man) return null;
  if (dd < (kind === "down" ? 0 : 1) || dd > 4 || Math.abs(l) > 3) return null;
  // 左側は、右側の絵の左右反転（向きも左右を入れ替える）。3〜4マス先は、2マス先の絵を縮める（横に3マスの位置は、その距離の絵がある）
  const flip = l < 0, L = Math.abs(l), R = flip ? (rel === 1 ? 3 : rel === 3 ? 1 : rel) : rel;
  const far = dd >= 3 && L <= 2, D = far ? 2 : dd, shrink = far ? (2 + 0.78) / (dd + 0.78) : 1;
  const it = man.items[D + "," + L + "," + R], key = kind + ":" + D + "," + L + "," + R;
  if (!it) return "none"; // 描き出した範囲で絵が無い＝その位置からは見えない
  let e = OBJ3D.img[key];
  if (!e) {
    e = OBJ3D.img[key] = { ok: false, im: new Image() };
    e.im.onload = () => { e.ok = true; if (S && S.inMaze && !BT && !VA.dz) drawView(); };
    e.im.onerror = () => { e.ng = true; };
    e.im.src = "wizrpg/obj3d/" + it[0];
  }
  return e.ok ? { key, it, im: e.im, man, flip, shrink } : null;
}
function objShaded(sp, b) {
  const q = Math.round(clamp(b, 0, 1) * 16);
  if (q >= 16) return sp.im;
  const k = sp.key + "|" + q;
  let c = OBJ3D.shaded[k];
  if (!c) {
    const keys = Object.keys(OBJ3D.shaded); if (keys.length > 80) keys.slice(0, 40).forEach(x => delete OBJ3D.shaded[x]);
    c = OBJ3D.shaded[k] = document.createElement("canvas"); c.width = sp.im.width; c.height = sp.im.height;
    const cg = c.getContext("2d"); cg.drawImage(sp.im, 0, 0);
    cg.globalCompositeOperation = "source-atop"; cg.fillStyle = `rgba(0,0,0,${((1 - q / 16) * 0.92).toFixed(3)})`; cg.fillRect(0, 0, c.width, c.height);
  }
  return c;
}
function drawView() {
  if (!S || !S.pos) return;
  drawMini();
  Amb.start(); // 迷宮の空気（塵・水滴）。すでに動いていれば何もしない
  const cv = $("view"); const dpr = sizeCanvas(cv);
  const g = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const f = FL(S.pos.f), { x, y, d } = S.pos;
  const light = S.light > 0;
  const here = f.tile[cidx(x, y)];
  const foot = here && { up: "▲上り階段", down: "▼下り階段", elev: "昇降機" }[here.t];
  $("hud").innerHTML = `地下${f.n}階　<b>${DIR_NAME[d]}</b>${light ? "　💡" : ""}${S.ward > 0 ? "　🧿" : ""}${f.anti[cidx(x, y)] ? "　🚫魔法" : ""}${foot ? `　<span style="color:#7dd3fc">${foot}</span>` : ""}`;
  $("loc").textContent = `B${f.n} ${f.cfg.name}`;
  // 背景（床と天井）
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#07080c"); bg.addColorStop(0.48, "#101320"); bg.addColorStop(0.52, "#0d0f16"); bg.addColorStop(1, "#1a1c24");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  if (f.dark[cidx(x, y)]) {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#556"; g.font = `${14 * dpr}px ${canvasFont()}`; g.textAlign = "center"; g.fillText("暗闇だ。何も見えない……", W / 2, H / 2);
    return;
  }
  const K = W * 0.56, cx = W / 2, cy = H / 2, ZO = 0.28;
  // VA.dz：歩く動きの途中で、カメラを後ろへずらす量（1＝1マス後ろ）。カメラより後ろの点は画面外へ飛ばす
  const P = (lx, ly, z) => { const zz = Math.max(0.06, z + VA.dz); return [cx + lx / zz * K, cy - ly / zz * K]; };
  const fw = d, rt = (d + 1) & 3, lf = (d + 3) & 3;
  const depth = light ? 6 : 4;
  const shade = z => clamp(1.15 - (z + VA.dz) / (depth + 0.6), 0.12, 1);
  const poly = (pts, fill, stroke, lw) => {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || dpr; g.stroke(); }
  };
  const wallCol = (b, side) => `rgb(${Math.round((side ? 44 : 54) * b)},${Math.round((side ? 48 : 58) * b)},${Math.round((side ? 64 : 76) * b)})`;
  const lineCol = b => `rgba(150,175,235,${0.25 + 0.75 * b})`;
  const edgeType = (cx2, cy2, dd) => {
    let e = edgeAt(f, cx2, cy2, dd);
    if (e === E_SECRET) { if (light && !isSecretFound(f.n, cx2, cy2, dd)) markSecret(f.n, cx2, cy2, dd); if (!isSecretFound(f.n, cx2, cy2, dd)) e = E_WALL; }
    return e;
  };
  const doorFill = (e, b) => e === E_LOCK ? `rgb(${Math.round(110 * b)},${Math.round(60 * b)},${Math.round(40 * b)})` : e === E_RIDDLE ? `rgb(${Math.round(100 * b)},${Math.round(40 * b)},${Math.round(90 * b)})` : `rgb(${Math.round(92 * b)},${Math.round(66 * b)},${Math.round(40 * b)})`;
  const mortar = b => `rgba(0,0,0,${0.35 * b})`;
  const TW = texFor("wall", f.n), TD = texFor("door", f.n), TF = texFor("floor", f.n), TC = texFor("ceiling", f.n);
  const shadeOver = (pts, b) => { if (b < 0.99) poly(pts, `rgba(0,0,0,${((1 - b) * 0.92).toFixed(3)})`, null); };
  /* 階段・昇降機の面に模様を貼る（単色だと、模様のある壁や床から浮いて見えるため）。
     tile：模様1枚がマス何個分の幅になるか。k：明るさ（壁と同じく、黒を重ねて暗くする）。z：面のおおよその奥行き */
  const texFace = (pts, img, tile, k, z) => {
    const pat = g.createPattern(img, "repeat"), sc = (K / Math.max(.12, z)) * tile / img.width;
    pat.setTransform(new DOMMatrix([sc, 0, 0, sc, pts[0][0], pts[0][1]]));
    poly(pts, pat, null);
    shadeOver(pts, clamp(k, 0, 1));
  };
  // 模様付きの箱（階段の段・昇降機の鉄骨）。正面・側面・上面で明るさを少し変える
  const drawBoxTex = (x0, x1, y0, y1, z0, z1, img, tile, k, edge) => {
    const zc = (z0 + z1) / 2;
    if (z0 > 0.05) texFace([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], img, tile, k * .68, z0);
    if (x0 > 0) texFace([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], img, tile, k * .55, zc);
    if (x1 < 0) texFace([P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)], img, tile, k * .55, zc);
    if (y1 < 0) texFace([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], img, tile, k * 1.15, zc);
    if (edge) poly([P(x0, y1, z0), P(x1, y1, z0)], null, edge, dpr);
  };
  // 奥行き方向に伸びる面（側面の壁・扉）は、縦の短冊に分けて貼ると遠近が正しくなる。
  // 短冊は画面上で数ピクセル幅になるよう本数を決め、面の形（台形）で切り抜く（上下の辺が階段状に欠けないように）
  const stripsSide = (img, lx, zA, zB, yT, yB) => {
    const iw = img.width, ih = img.height;
    const quad = [P(lx, yT, zA), P(lx, yT, zB), P(lx, yB, zB), P(lx, yB, zA)];
    const n = clamp(Math.ceil(Math.abs(quad[1][0] - quad[0][0]) / (3 * dpr)), 2, 200);
    g.save(); pathOf(quad); g.clip();
    for (let i = 0; i < n; i++) {
      const za = zA + (zB - zA) * i / n, zb = zA + (zB - zA) * (i + 1) / n, zm = (za + zb) / 2;
      const xa = P(lx, 0, za)[0], xb = P(lx, 0, zb)[0];
      // 近い側（背が高い側）の高さで描き、はみ出しは切り抜きで落とす
      const zNear = Math.min(za, zb), yt = P(lx, yT, zNear)[1], yb = P(lx, yB, zNear)[1];
      g.drawImage(img, iw * i / n, 0, Math.max(1, iw / n), ih, Math.min(xa, xb) - 0.5, yt, Math.abs(xb - xa) + 1, yb - yt);
    }
    g.restore();
  };

  // 床・天井は横の短冊に分けて貼る（本数は画面上の高さに合わせる）
  const stripsFlat = (img, l, zA, zB, yy) => {
    const iw = img.width, ih = img.height;
    const n = clamp(Math.ceil(Math.abs(P(0, yy, zA)[1] - P(0, yy, zB)[1]) / (3 * dpr)), 2, 120);
    for (let i = 0; i < n; i++) {
      const za = zA + (zB - zA) * i / n, zb = zA + (zB - zA) * (i + 1) / n, zm = (za + zb) / 2;
      const ya = P(0, yy, za)[1], yb = P(0, yy, zb)[1], xl = P(l - .5, yy, zm)[0], xr = P(l + .5, yy, zm)[0];
      g.drawImage(img, 0, ih * i / n, iw, Math.max(1, ih / n), xl, Math.min(ya, yb) - 0.5, xr - xl, Math.abs(yb - ya) + 1);
    }
  };

  // ── 階段・昇降機の線画（予備）──
  // ふだんは Blender で描き出した立体の絵（drawObj3d）を貼る。ここから下の線画は、その絵をまだ読み込めていない間と、
  // 読み込めなかったときにだけ使う（階段や昇降機が何も描かれない、ということが起きないように残してある）
  const rgbK = (r, gg, bb, k) => `rgb(${Math.round(r * k)},${Math.round(gg * k)},${Math.round(bb * k)})`;
  const pathOf = pts => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); };
  /* 階段・昇降機は迷宮の中で決まった向きを持つ（入口側から反対側へ上る/下る）。
     見る方向が変わっても同じ向きに見えるよう、マス内の座標を今の視点の座標に置き換えて描く。
     rel：その向きが今の視点から見て 0=奥 1=右 2=手前 3=左 */
  const cellMap = (l, zn, zf, rel) => {
    const cz = (zn + zf) / 2, L = .84;
    // a：横方向（-1〜1）、v：上る/下る向き（0〜1）、hw：横の半幅 → [画面の横位置lx, 奥行きz]
    return (a, v, hw) => {
      const s2 = (v - .5) * L, t = a * hw;
      return rel === 0 ? [l + t, cz + s2] : rel === 2 ? [l - t, cz - s2] : rel === 1 ? [l + s2, cz - t] : [l - s2, cz + t];
    };
  };
  const P3 = (m, a, v, hw, y) => { const [lx, z] = m(a, v, hw); return P(lx, y, z); };
  // 下り階段：床の穴。段は入口側（v=0）から奥（v=1）へ、1段ずつ低くなっていく立体の段として描く。
  // 穴の中は、両側と奥の石壁→遠い段から順に、穴の形で切り抜いて重ねる（切り抜きで、見えない面は自然に消える）。
  // 実際の深さだと段がふちに隠れてしまうため、1段の落差は浅め（DY）にして、奥ほど暗くして深さを出す
  // 立体の絵があれば、それを貼る（歩く動きの途中は、カメラが下がった分だけ縮める）。貼れたら（または、その位置からは見えないなら）true
  const drawObj3d = (kind, l, zn, b, rel) => {
    const dd3 = Math.round(zn - ZO), sp = objSprite(kind, dd3, l, rel);
    if (sp === "none") return true;
    if (!sp) return false;
    const cz = dd3 + ZO + 0.5, s = W / sp.man.w * (cz / Math.max(0.2, cz + VA.dz)) * sp.shrink;
    const left = sp.flip ? sp.man.w - (sp.it[1] + sp.it[3]) : sp.it[1];
    const X = cx + (left - sp.man.w / 2) * s, Y = cy + (sp.it[2] - sp.man.h / 2) * s, w = sp.it[3] * s, h = sp.it[4] * s, img = objShaded(sp, b);
    if (sp.flip) { g.save(); g.translate(X + w, Y); g.scale(-1, 1); g.drawImage(img, 0, 0, w, h); g.restore(); }
    else g.drawImage(img, X, Y, w, h);
    return true;
  };
  const drawDownStairs = (l, zn, zf, b, rel) => {
    if (drawObj3d("down", l, zn, b, rel)) return;
    // 奥へ下る向き（rel=0）は、遠いほど段がふちに隠れやすいので、1段の落差を距離に合わせて浅くする
    const m = cellMap(l, zn, zf, rel), hw = .4, N = 6, VE = .84, BOT = -1.6;
    const DY = rel === 0 ? Math.min(.07, .03 / Math.max(.3, zn)) : .06;
    const F = (a, v) => P3(m, a, v, hw, -.5);
    const hole = [F(-1, 0), F(1, 0), F(1, 1), F(-1, 1)];
    poly(hole, "#020203", null);
    g.save(); pathOf(hole); g.clip();
    const stone = TF || TW; // 段には、その階の床（無ければ壁）の石の模様を貼る
    // 穴の内側の石壁（上は明るく、下へ行くほど闇に沈む）
    const wallQ = (a0, v0, a1, v1) => {
      const q = (a, v, y) => P3(m, a, v, hw, y), zz = m((a0 + a1) / 2, (v0 + v1) / 2, hw)[1];
      const pts = [q(a0, v0, -.5), q(a1, v1, -.5), q(a1, v1, BOT), q(a0, v0, BOT)];
      if (TW) texFace(pts, TW, .45, b * .28, zz); else poly(pts, rgbK(32, 34, 42, b), null);
      const top = (pts[0][1] + pts[1][1]) / 2, bot = (pts[2][1] + pts[3][1]) / 2;
      const gr = g.createLinearGradient(0, top, 0, bot);
      gr.addColorStop(0, "rgba(2,2,3,.25)"); gr.addColorStop(.45, "rgba(2,2,3,.9)"); gr.addColorStop(1, "rgba(2,2,3,1)");
      poly(pts, gr, null);
    };
    wallQ(-1, 1, 1, 1); wallQ(-1, 0, -1, 1); wallQ(1, 0, 1, 1);
    // 段（遠いものから順に）。最後の段の先は、さらに下へ続く闇
    const steps = [];
    for (let j = 0; j < N; j++) {
      const [x0, x1, z0, z1] = boxOf(m, -1, 1, VE * j / N, VE * (j + 1) / N, hw);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      steps.push({ j, x0, x1, z0, z1, dist: cx * cx + cz * cz });
    }
    steps.sort((p, q) => q.dist - p.dist);
    for (const s of steps) {
      const k = b * Math.max(.1, 1 - s.j * .15), top = -.5 - (s.j + 1) * DY;
      const edge = `rgba(235,220,190,${(.55 * k).toFixed(3)})`; // 段の角に淡い光の線
      if (stone) drawBoxTex(s.x0, s.x1, BOT, top, s.z0, s.z1, stone, .45, k, edge);
      else drawBox(s.x0, s.x1, BOT, top, s.z0, s.z1,
        { front: rgbK(58, 60, 74, k), side: rgbK(48, 50, 62, k), top: rgbK(120, 124, 140, k) },
        `rgba(190,205,240,${(.2 + .5 * k).toFixed(3)})`);
    }
    g.restore();
    // 穴のふちの石組み
    poly(hole, null, rgbK(120, 118, 110, b), 3 * dpr);
    poly(hole, null, `rgba(0,0,0,${.6 * b})`, dpr);
  };
  // 視点の座標でそろった箱（x0..x1, y0..y1, z0..z1）を、見える面だけ描く
  const drawBox = (x0, x1, y0, y1, z0, z1, cols, edge) => {
    if (z0 > 0.05) poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], cols.front, null);
    if (x0 > 0) poly([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], cols.side, null);
    if (x1 < 0) poly([P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)], cols.side, null);
    if (y1 < 0) poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], cols.top, null);
    if (edge) poly([P(x0, y1, z0), P(x1, y1, z0)], null, edge, dpr);
  };
  const boxOf = (m, a0, a1, v0, v1, hw) => {
    const p = m(a0, v0, hw), q = m(a1, v1, hw);
    return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])];
  };
  // 上り階段：入口側（v=0）から奥（v=1）へ、天井の穴まで上っていく
  const drawUpStairs = (l, zn, zf, b, rel) => {
    if (drawObj3d("up", l, zn, b, rel)) return;
    const m = cellMap(l, zn, zf, rel), hw = .36, N = 7, H = 1 / N;
    // 天井の穴
    const [hx0, hx1, hz0, hz1] = boxOf(m, -1, 1, (N - 2) / N, 1, hw);
    poly([P(hx0, .5, hz0), P(hx1, .5, hz0), P(hx1, .5, hz1), P(hx0, .5, hz1)], "#020203", `rgba(0,0,0,${.6 * b})`, dpr);
    // 段ごとの柱を、遠いものから順に描く
    const cols = [];
    for (let i = 0; i < N; i++) {
      const [x0, x1, z0, z1] = boxOf(m, -1, 1, i / N, (i + 1) / N, hw);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      cols.push({ i, x0, x1, z0, z1, dist: cx * cx + cz * cz });
    }
    cols.sort((p, q) => q.dist - p.dist);
    const stone = TF || TW; // 段には、その階の床（無ければ壁）の石の模様を貼る
    for (const c of cols) {
      const k = b * (1 - c.i * .05), edge = `rgba(235,220,190,${(.28 * k).toFixed(3)})`; // 段の角に淡い光の線
      if (stone) drawBoxTex(c.x0, c.x1, -.5, -.5 + (c.i + 1) * H, c.z0, c.z1, stone, .45, k, edge);
      else drawBox(c.x0, c.x1, -.5, -.5 + (c.i + 1) * H, c.z0, c.z1,
        { front: rgbK(66, 68, 82, k), side: rgbK(52, 54, 66, k), top: rgbK(104, 108, 124, k) },
        `rgba(170,190,235,${(.12 + .4 * k).toFixed(3)})`);
    }
  };
  /* 昇降機：坑道の鉄のケージ。縞鋼板の床とリベット、四隅の鉄骨の柱と天井の枠、左右は斜め格子の柵、
     奥（v=1）は蛇腹の格子戸とその向こうの縦穴、天井の穴へ伸びる2本の吊り索、片隅のランタンと入口の操作レバー。
     見る向きが変わっても重なりが崩れないよう、部品を遠いものから順に描く */
  const drawElevator = (l, zn, zf, b, rel) => {
    if (drawObj3d("elev", l, zn, b, rel)) return;
    const m = cellMap(l, zn, zf, rel), hw = .42, YT = .40; // YT：ケージの天井の枠の高さ
    const iron = k => rgbK(82, 76, 68, b * k), ironHi = rgbK(112, 102, 88, b), rust = rgbK(118, 74, 42, b);
    const lw = z => Math.max(1, .02 / Math.max(.12, z) * K);
    const Q = (a, v, y) => { const [lx, z] = m(a, v, hw); return P(lx, y, z); };
    const line = (p1, p2, wdt, col) => { g.strokeStyle = col; g.lineWidth = wdt; g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke(); };
    const depthOf = (a, v) => { const [lx, z] = m(a, v, hw); return lx * lx + z * z; };
    // 天井の縦穴（吊り索が抜けていく）
    poly([Q(-.4, .3, .5), Q(.4, .3, .5), Q(.4, .7, .5), Q(-.4, .7, .5)], "#020203", `rgba(0,0,0,${.7 * b})`, dpr);
    // 床：縞鋼板（錆と傷の模様を貼る）。縁にリベット
    const IRON = procTex("iron");
    const floorPts = [Q(-1, 0, -.5), Q(1, 0, -.5), Q(1, 1, -.5), Q(-1, 1, -.5)];
    texFace(floorPts, IRON, .35, b * .62, m(0, .5, hw)[1]);
    poly(floorPts, null, rgbK(40, 38, 34, b), 1.5 * dpr);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      const a = -.8 + i * .4 + (j % 2) * .2, v = .15 + j * .23;
      if (a > .9) continue;
      line(Q(a - .08, v - .03, -.5), Q(a + .08, v + .03, -.5), Math.max(1, dpr), rgbK(140, 132, 118, b * .8));
    }
    for (const v of [.06, .94]) for (let i = 0; i < 6; i++) {
      const [px, py] = Q(-.9 + i * .36, v, -.5); const [, z] = m(-.9 + i * .36, v, hw);
      g.fillStyle = ironHi; g.beginPath(); g.arc(px, py, Math.max(1, .012 / Math.max(.12, z) * K), 0, 7); g.fill();
    }
    const parts = [];
    // 格子の面（a0,v0 → a1,v1 の辺に立つ面）。gate=true は蛇腹の戸（奥は縦穴の闇）
    const panel = (a0, v0, a1, v1, gate) => parts.push({
      d: depthOf((a0 + a1) / 2, (v0 + v1) / 2), draw: () => {
        const at = (t, y) => Q(a0 + (a1 - a0) * t, v0 + (v1 - v0) * t, y);
        const [, z] = m((a0 + a1) / 2, (v0 + v1) / 2, hw);
        poly([at(0, YT), at(1, YT), at(1, -.5), at(0, -.5)], gate ? `rgba(0,0,0,${(.7 * b).toFixed(3)})` : `rgba(0,0,0,${(.22 * b).toFixed(3)})`, null);
        const n = gate ? 6 : 4, top = gate ? YT : .05, w = lw(z) * (gate ? .55 : .5), col = gate ? rust : iron(1.1);
        for (let i = 0; i < n; i++) { line(at(i / n, -.5), at((i + 1) / n, top), w, col); line(at((i + 1) / n, -.5), at(i / n, top), w, col); }
        for (const y of gate ? [-.5, YT] : [-.5, .05]) line(at(0, y), at(1, y), lw(z) * .9, ironHi);
      },
    });
    panel(-1, 0, -1, 1, false); panel(1, 0, 1, 1, false); panel(-1, 1, 1, 1, true);
    // 四隅の柱と天井の枠（厚みのある鉄骨。錆と傷の模様を貼る）
    const beam = (x0, x1, y0, y1, z0, z1, edge) => drawBoxTex(x0, x1, y0, y1, z0, z1, IRON, .3, b * .82, edge);
    for (const [ca, cv] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
      const [bx0, bx1, bz0, bz1] = boxOf(m, ca - .07 * Math.sign(ca), ca, cv === 0 ? 0 : .95, cv === 0 ? .05 : 1, hw);
      parts.push({ d: depthOf(ca, cv), draw: () => beam(bx0, bx1, -.5, YT, bz0, bz1, `rgba(200,190,170,${(.3 * b).toFixed(3)})`) });
    }
    for (const [a0, a1, v0, v1] of [[-1, 1, 0, .05], [-1, 1, .95, 1], [-1, -.93, 0, 1], [.93, 1, 0, 1]]) {
      const [bx0, bx1, bz0, bz1] = boxOf(m, a0, a1, v0, v1, hw);
      parts.push({ d: depthOf((a0 + a1) / 2, (v0 + v1) / 2) - .01, draw: () => beam(bx0, bx1, YT, YT + .05, bz0, bz1, null) });
    }
    // 吊り索（天井の枠の真ん中から、天井の穴へ）
    parts.push({ d: depthOf(0, .5), draw: () => {
      const [, z] = m(0, .5, hw);
      for (const a of [-.12, .12]) line(Q(a, .5, YT + .05), Q(a, .5, .5), lw(z) * .8, rgbK(50, 46, 40, b));
    } });
    // 入口のそばの操作レバー
    parts.push({ d: depthOf(.7, .12), draw: () => {
      const [bx0, bx1, bz0, bz1] = boxOf(m, .6, .8, .08, .16, hw);
      beam(bx0, bx1, -.5, -.22, bz0, bz1, null);
      const [, z] = m(.7, .12, hw);
      line(Q(.7, .12, -.22), Q(.62, .12, -.02), lw(z) * .9, ironHi);
      g.fillStyle = rgbK(170, 40, 30, b); const [kx, ky] = Q(.62, .12, -.02); g.beginPath(); g.arc(kx, ky, lw(z) * 1.3, 0, 7); g.fill();
    } });
    // 片隅のランタン（橙色の明かり）
    parts.push({ d: depthOf(-.8, .15) - .02, draw: () => {
      const [, z] = m(-.8, .15, hw), r = .05 / Math.max(.12, z) * K;
      const [lx, ly] = Q(-.8, .15, .12);
      line(Q(-.8, .15, YT), [lx, ly - r], lw(z) * .5, rgbK(60, 56, 50, b));
      const glow = g.createRadialGradient(lx, ly, 0, lx, ly, r * 5);
      glow.addColorStop(0, `rgba(255,190,90,${(.45 * b).toFixed(3)})`); glow.addColorStop(1, "rgba(255,160,60,0)");
      g.fillStyle = glow; g.beginPath(); g.arc(lx, ly, r * 5, 0, 7); g.fill();
      g.fillStyle = rgbK(60, 50, 38, b); g.fillRect(lx - r * .6, ly - r, r * 1.2, r * 2);
      g.fillStyle = `rgba(255,214,130,${(.95 * b).toFixed(3)})`; g.fillRect(lx - r * .35, ly - r * .6, r * .7, r * 1.2);
    } });
    parts.sort((p, q) => q.d - p.d).forEach(p => p.draw());
  };
  // 階段・昇降機の向き：入口は必ず通れる側（通路）を向け、奥は壁の側にする。行き止まりでは、歩いてくる方から入口が正面に見える。
  // 迷宮の形から毎回同じ向きに決まる
  const elevDir = (qx, qy) => {
    const st = (qx * 7 + qy * 13) & 3, wall = dd => edgeAt(f, qx, qy, dd) === E_WALL;
    for (let i = 0; i < 4; i++) { const dd = (st + i) & 3; if (wall(dd) && !wall((dd + 2) & 3)) return dd; }
    for (let i = 0; i < 4; i++) { const dd = (st + i) & 3; if (!wall((dd + 2) & 3)) return dd; }
    return st;
  };
  const lockTint = e =>e === E_LOCK ? "rgba(200,110,40,.28)" : e === E_RIDDLE ? "rgba(170,70,170,.28)" : null;
  const drawFront = (l, z, e, b) => {
    const quad = [P(l - .5, .5, z), P(l + .5, .5, z), P(l + .5, -.5, z), P(l - .5, -.5, z)];
    if (TW) {
      g.drawImage(TW, quad[0][0], quad[0][1], quad[1][0] - quad[0][0], quad[2][1] - quad[0][1]);
      shadeOver(quad, b);
      if (e !== E_WALL) {
        const dq = [P(l - .28, .3, z), P(l + .28, .3, z), P(l + .28, -.5, z), P(l - .28, -.5, z)];
        if (TD) { g.drawImage(TD, dq[0][0], dq[0][1], dq[1][0] - dq[0][0], dq[2][1] - dq[0][1]); shadeOver(dq, b); const t = lockTint(e); if (t) poly(dq, t, null); }
        else poly(dq, doorFill(e, b), lineCol(b), 1.3 * dpr);
        if (!TD && (e === E_LOCK || e === E_RIDDLE)) { const [kx, ky] = P(l + .17, -.12, z); g.fillStyle = `rgba(250,200,60,${b})`; g.beginPath(); g.arc(kx, ky, Math.max(1.5, 0.04 / z * K), 0, 7); g.fill(); }
      }
      poly(quad, null, `rgba(0,0,0,${0.5 * b})`, dpr);
      return;
    }
    poly(quad, wallCol(b, false), lineCol(b), 1.3 * dpr);
    // 石積みの目地
    g.strokeStyle = mortar(b); g.lineWidth = dpr;
    for (let r = 0; r < 4; r++) {
      const yy = .5 - (r + 1) * 0.2;
      const a = P(l - .5, yy, z), c2 = P(l + .5, yy, z);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c2[0], c2[1]); g.stroke();
      for (let k = 0; k < 3; k++) {
        const xx = l - .5 + (k + (r % 2 ? .5 : 1)) * (1 / 3); if (xx >= l + .5) continue;
        const p1 = P(xx, yy + .2, z), p2 = P(xx, yy, z);
        g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke();
      }
    }
    if (e !== E_WALL) {
      poly([P(l - .28, .3, z), P(l + .28, .3, z), P(l + .28, -.5, z), P(l - .28, -.5, z)], doorFill(e, b), lineCol(b), 1.3 * dpr);
      if (e === E_LOCK || e === E_RIDDLE) { const [kx, ky] = P(l + .17, -.12, z); g.fillStyle = `rgba(250,200,60,${b})`; g.beginPath(); g.arc(kx, ky, Math.max(1.5, 0.04 / z * K), 0, 7); g.fill(); }
    }
  };
  const drawSide = (lx, zn, zf, e, b) => {
    const quad = [P(lx, .5, zn), P(lx, .5, zf), P(lx, -.5, zf), P(lx, -.5, zn)];
    if (TW) {
      stripsSide(TW, lx, zn, zf, .5, -.5);
      shadeOver(quad, b * 0.85); // 側面は正面より少し暗く
      if (e !== E_WALL) {
        const a = zn + (zf - zn) * 0.22, c2 = zf - (zf - zn) * 0.22;
        const dq = [P(lx, .3, a), P(lx, .3, c2), P(lx, -.5, c2), P(lx, -.5, a)];
        if (TD) { stripsSide(TD, lx, a, c2, .3, -.5); shadeOver(dq, b * 0.85); const t = lockTint(e); if (t) poly(dq, t, null); }
        else poly(dq, doorFill(e, b * 0.85), lineCol(b), 1.3 * dpr);
      }
      poly(quad, null, `rgba(0,0,0,${0.5 * b})`, dpr);
      return;
    }
    poly(quad, wallCol(b, true), lineCol(b), 1.3 * dpr);
    g.strokeStyle = mortar(b); g.lineWidth = dpr;
    for (let r = 0; r < 4; r++) {
      const yy = .5 - (r + 1) * 0.2;
      const a = P(lx, yy, zn), c2 = P(lx, yy, zf);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c2[0], c2[1]); g.stroke();
    }
    if (e !== E_WALL) {
      const a = zn + (zf - zn) * 0.22, c2 = zf - (zf - zn) * 0.22;
      poly([P(lx, .3, a), P(lx, .3, c2), P(lx, -.5, c2), P(lx, -.5, a)], doorFill(e, b * 0.85), lineCol(b), 1.3 * dpr);
    }
  };
  if (TF || TC) {
    for (let dd = depth - 1; dd >= (VA.dz > 0 ? -1 : 0); dd--) {
      const Lm = Math.min(Math.max(1, Math.ceil(dd + 1 + VA.dz)), 3), zn = dd + ZO, zf = dd + 1 + ZO, b = shade(zf - 0.5);
      for (let l = -Lm; l <= Lm; l++) {
        const qx = x + DX[fw] * dd + DX[rt] * l, qy = y + DY[fw] * dd + DY[rt] * l;
        if (!inb(qx, qy) || (f.dark[cidx(qx, qy)] && dd > 0)) continue;
        if (TF) { stripsFlat(TF, l, zn, zf, -.5); shadeOver([P(l - .5, -.5, zn), P(l + .5, -.5, zn), P(l + .5, -.5, zf), P(l - .5, -.5, zf)], b); }
        if (TC) { stripsFlat(TC, l, zn, zf, .5); shadeOver([P(l - .5, .5, zn), P(l + .5, .5, zn), P(l + .5, .5, zf), P(l - .5, .5, zf)], b * 0.8); }
      }
    }
  }
  for (let dd = depth - 1; dd >= (VA.dz > 0 ? -1 : 0); dd--) {
    const Lm = Math.min(Math.max(1, Math.ceil(dd + 1 + VA.dz)), 3);
    const order = [];
    for (let l = -Lm; l <= -1; l++) order.push(l);
    for (let l = Lm; l >= 1; l--) order.push(l);
    order.push(0);
    const zn = dd + ZO, zf = dd + 1 + ZO;
    for (const l of order) {
      const qx = x + DX[fw] * dd + DX[rt] * l, qy = y + DY[fw] * dd + DY[rt] * l;
      if (!inb(qx, qy)) continue;
      const qk = cidx(qx, qy);
      // 暗闇のマスは、中が見えない黒い塊として描く（描かずに飛ばすと、そのマスの壁まで消えて、
      // 隣のマスが通路のように見えてしまう）。手前に壁があれば、あとから描く手前の壁で隠れる
      if (f.dark[qk] && dd > 0) {
        poly([P(l - .5, .5, zn), P(l + .5, .5, zn), P(l + .5, -.5, zn), P(l - .5, -.5, zn)], "#000", null);
        if (l < 0) poly([P(l + .5, .5, zn), P(l + .5, .5, zf), P(l + .5, -.5, zf), P(l + .5, -.5, zn)], "#000", null);
        if (l > 0) poly([P(l - .5, .5, zn), P(l - .5, .5, zf), P(l - .5, -.5, zf), P(l - .5, -.5, zn)], "#000", null);
        continue;
      }
      const b = shade(zf - 0.5);
      // 床の目印（明かりがあるときだけ見える落とし穴）
      const t = f.tile[qk];
      if (t && dd >= 1 && dd <= 3 && light && (t.t === "pit" || t.t === "chute"))
        poly([P(l - .32, -.5, zn + .2), P(l + .32, -.5, zn + .2), P(l + .32, -.5, zf - .2), P(l - .32, -.5, zf - .2)], `rgba(0,0,0,${0.25 * b})`, `rgba(0,0,0,${b})`, 1.2 * dpr);
      if (f.swamp[qk] && dd <= 3) poly([P(l - .5, -.5, zn), P(l + .5, -.5, zn), P(l + .5, -.5, zf), P(l - .5, -.5, zf)], `rgba(40,110,50,${0.35 * b})`, null);
      if (l <= 0) { const e = edgeType(qx, qy, lf); if (e !== E_OPEN) drawSide(l - .5, zn, zf, e, b); }
      if (l >= 0) { const e = edgeType(qx, qy, rt); if (e !== E_OPEN) drawSide(l + .5, zn, zf, e, b); }
      const e = edgeType(qx, qy, fw);
      if (e !== E_OPEN) drawFront(l, zf, e, shade(zf));
      // 階段・昇降機はそのマスの壁より手前にあるので、壁のあとに描く
      // 自分が立っているマスの階段・昇降機は、視界をふさがないよう描かない（下り階段の穴は床なので描く）
      if (t && dd <= 4 && (dd + VA.dz > 0.3 || t.t === "down")) {
        const rel = (elevDir(qx, qy) - d + 4) & 3;
        if (t.t === "down") drawDownStairs(l, zn, zf, b, rel);
        else if (t.t === "up") drawUpStairs(l, zn, zf, b, rel);
        else if (t.t === "elev") drawElevator(l, zn, zf, b, rel);
      }
    }
  }
}
window.addEventListener("resize", () => { if (document.body.dataset.mode === "maze") drawView(); });
