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
function waitMazeInput() {
  const cmd = $("cmd");
  const t = FL(S.pos.f).tile[cidx(S.pos.x, S.pos.y)];
  const tl = t && { up: "▲ 階段をのぼる", down: "▼ 階段をおりる", elev: "昇降機を使う" }[t.t];
  cmd.innerHTML = `<div class="pad">
    <button data-a="map" class="sm">🗺️<small>地図</small></button><button data-a="fwd" class="arr">▲<small>前進</small></button><button data-a="search" class="sm">🔍<small>調べる</small></button>
    <button data-a="left" class="arr">↰<small>左を向く</small></button><button data-a="back" class="arr">⟲<small>振り返る</small></button><button data-a="right" class="arr">↱<small>右を向く</small></button>
    <button data-a="camp" class="camp${tl ? " half" : ""}">⛺ キャンプ</button>${tl ? `<button data-a="tile" class="camp half pri">${tl}</button>` : ""}</div>`;
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
      if (damageChar(c, rr(1, 3))) died.push(c.name + "は沼に沈んだ");
      else if (chance(0.2)) c.poison = 1;
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
        if (ev.t === "boss") await tell("灰の司祭モルヴァンは、灰となって崩れ落ちた。\n床に転がった星灯が、淡く輝いている……。");
        await giveReward(ev.reward);
        if (ev.t === "boss") { await ending(); await exitMaze(null); }
      }
      if (r !== "win") return;
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
      setTimeout(() => Snd.play("land"), 450);
      noteTrap(f.n, S.pos.x, S.pos.y);
      await tell("落とし穴だ！");
      for (const c of partyChars()) if (isAlive(c) && c.status !== "stone") {
        if (chance(clamp((c.st.agi - 8) * 0.04, 0, 0.5))) continue;
        damageChar(c, rr(1, 3 + f.n * 2));
      }
      renderParty(); await checkWipeOutside(); if (!S.inMaze) return;
    } else if (t.t === "chute") {
      Snd.play("fall"); vibrate(120);
      noteTrap(f.n, S.pos.x, S.pos.y);
      await tell("床が抜けた！\nパーティは下の階へ落ちていく――");
      await changeFloor(f.n + 1, S.pos.x, S.pos.y);
      for (const c of partyChars()) if (isAlive(c) && c.status !== "stone") damageChar(c, rr(1, 8));
      renderParty(); await checkWipeOutside();
      return;
    } else if (t.t === "tele") {
      Snd.play("tele"); flashView("#6040ff");
      noteTrap(f.n, S.pos.x, S.pos.y);
      await tell("突然、体がねじれるような感覚に襲われた！");
      prevCell = -1;
      S.pos.x = t.to[0]; S.pos.y = t.to[1];
      markExplored(); drawView();
      return onEnterCell(true);
    } else if (t.t === "up") {
      if (await stairsPrompt("上り階段がある。", "のぼる")) {
        Snd.play("stairs");
        if (f.n === 1) return exitMaze("パーティは迷宮を抜け、地上の町へ戻った。");
        await changeFloor(f.n - 1, S.pos.x, S.pos.y);
        return;
      }
    } else if (t.t === "down") {
      if (await stairsPrompt("下り階段がある。", "おりる")) {
        Snd.play("stairs");
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
    await changeFloor(f.n - 1, S.pos.x, S.pos.y);
  } else if (t.t === "down") await changeFloor(f.n + 1, S.pos.x, S.pos.y);
  else if (t.t === "elev") await elevator();
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
  const n = await choose(floors, { title: "昇降機だ。どの階へ行く？", cols: 3, cancel: true, cancelLabel: "降りない" });
  if (!n) return;
  Snd.play("elevator");
  const e = FLOORS[n].elev;
  await changeFloor(n, e[0], e[1]);
  S.elev[n] = 1;
  await tell(`昇降機は地下${n}階で止まった。`);
  for (const ev of (FL(n).ev[cidx(...e)] || [])) if (ev.t === "msg") await tell(ev.text);
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
  Bgm.stop(0.8);
  Snd.play("lose");
  $("scene").className = "on wipe";
  setSceneBg("wipe");
  $("scene").innerHTML = `<div class="plc"><div class="pg">💀</div><div class="pn">全滅</div></div>`;
  await tell("パーティは全滅した……");
  const members = partyChars();
  if (S.rule === "classic") {
    S.bodies.push({ f: S.pos.f, x: S.pos.x, y: S.pos.y, ids: members.map(c => c.id) });
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
  Bgm.stop(0.8);
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
      { label: "鑑定", value: "ident", disabled: !canPartyIdent() },
      { label: "並び替え", value: "order" },
      { label: "大事なもの", value: "keys" },
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
    else if (k === "ident") await partyIdent();
    else if (k === "order") await reorderParty();
    else if (k === "keys") {
      const ks = Object.keys(S.keys).filter(k => S.keys[k]);
      await dialog(ks.length ? ks.map(k => `<p><b>${KEYITEMS[k].name}</b><br><small>${KEYITEMS[k].desc}</small></p>`).join("") : "<p>なにも持っていない。</p>", null, { title: "大事なもの" });
    }
    else if (k === "opt") await castle_speed();
    else if (k === "quit") {
      if (await confirmBox("冒険を中断してタイトルに戻りますか？\n（今いる場所から再開できます）")) { saveGame(true); location.reload(); return; }
    }
    renderParty();
  }
}
async function castle_speed() {
  await dialog(`<h4>メッセージ速度</h4><div class="spd">${[0.6, 1, 1.6, 2.5].map(v => `<button data-v="${v}" class="${S.speed === v ? "pri" : ""}">${{ 0.6: "ゆっくり", 1: "ふつう", 1.6: "はやい", 2.5: "最速" }[v]}</button>`).join("")}</div>
    <h4>BGM</h4><div class="spd"><button data-bgm="1" class="${!S.bgmOff ? "pri" : ""}">オン</button><button data-bgm="0" class="${S.bgmOff ? "pri" : ""}">オフ</button></div>${fontOptHtml()}${walkOptHtml()}${spellDescOptHtml()}`,
    null, { title: "設定", onOpen: b => b.querySelectorAll(".spd button").forEach(bt => bt.onclick = () => {
      if (fontOptClick(bt, b) || walkOptClick(bt, b) || spellDescOptClick(bt, b)) return;
      if (bt.dataset.bgm) { S.bgmOff = bt.dataset.bgm === "0"; saveGame(); Bgm.sync(); b.querySelectorAll("[data-bgm]").forEach(x => x.classList.toggle("pri", x === bt)); Snd.play("click"); return; } S.speed = +bt.dataset.v; saveGame(); b.querySelectorAll(".spd button[data-v]").forEach(x => x.classList.toggle("pri", x === bt)); Snd.play("click"); }) });
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
    (sp.sc === "M" ? c.mpM : c.mpP)[sp.lv - 1]--;
    Snd.play("cancel"); await alertBox("呪文を唱えたが、何も起こらない……\n（ここでは魔法が封じられている）");
    return;
  }
  const ok = await castOutside(c, sp, false);
  if (ok) (sp.sc === "M" ? c.mpM : c.mpP)[sp.lv - 1]--;
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
      if (!fromItem) (sp.sc === "M" ? c.mpM : c.mpP)[sp.lv - 1]--;
      await exitMaze("まばゆい光に包まれ、パーティは地上の町へ帰還した。");
      return true;
    }
    case "teleport": {
      if (!inMaze) break;
      const dest = await teleportPicker();
      if (!dest) return false;
      Snd.play("tele");
      if (dest === "castle") { if (!fromItem) (sp.sc === "M" ? c.mpM : c.mpP)[sp.lv - 1]--; await exitMaze("パーティは地上の町へ瞬間移動した。"); return true; }
      prevCell = -1;
      S.pos.f = dest.f; S.pos.x = dest.x; S.pos.y = dest.y;
      S.deepest = Math.max(S.deepest, dest.f);
      markExplored(); drawView(); saveGame(true);
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
  await dialog(`<div class="mapnav"><button data-d="-1">▲</button><b id="mapTitle"></b><button data-d="1">▼</button></div><canvas id="amap"></canvas><div class="maplegend">▲自分　<span style="color:#7dd3fc">↑↓</span>階段　<span style="color:#fbbf24">E</span>昇降機　<span style="color:#c08040">━</span>扉　<span style="color:#f87171">━</span>鍵のかかった扉<br><span style="color:#f87171">●</span>落とし穴　<span style="color:#fb923c">▼</span>落とし戸　<span style="color:#c084fc">◎</span>転移床　<span style="color:#fbbf24">↻</span>回転床　<span style="color:#fde68a">✦</span>何かありそう　<span style="color:#8a7a68">■</span>岩</div>`,
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
    g.fillStyle = f.swamp[k] ? "#1f3a24" : f.anti[k] ? "#2a2440" : "#1c2536";
    g.fillRect(sx(x) + 0.5, sy(y) + 0.5, cs - 1, cs - 1);
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
function animate(ms, fn) {
  return new Promise(res => {
    const t0 = performance.now();
    const step = now => { const t = Math.min(1, (now - t0) / ms); fn(t); if (t < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });
}
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
  const dpr = Math.min(2, window.devicePixelRatio || 1, w ? 960 / w : 2);
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

function drawView() {
  if (!S || !S.pos) return;
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

  // ── 階段・昇降機の立体表示 ──
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
  // 下り階段：床の穴。段は入口側（v=0）から奥（v=1）へ下っていく
  // （実際の透視だと段はふちに隠れて見えないため、穴の中を帯に分けて踏み面と蹴上げを描く）
  const drawDownStairs = (l, zn, zf, b, rel) => {
    const m = cellMap(l, zn, zf, rel), hw = .4, N = 6;
    const F = (a, v) => P3(m, a, v, hw, -.5);
    const hole = [F(-1, 0), F(1, 0), F(1, 1), F(-1, 1)];
    poly(hole, "#020203", null);
    g.save(); pathOf(hole); g.clip();
    for (let j = 0; j < N; j++) {
      const k = b * Math.max(.12, 1 - j * .16), v0 = j / N, vm = (j + .45) / N, v1 = (j + 1) / N;
      poly([F(-1, v0), F(1, v0), F(1, vm), F(-1, vm)], rgbK(120, 124, 140, k), null);
      poly([F(-1, vm), F(1, vm), F(1, v1), F(-1, v1)], rgbK(58, 60, 74, k), null);
      poly([F(-1, v0), F(1, v0)], null, `rgba(190,205,240,${(.2 + .6 * k).toFixed(3)})`, 1.5 * dpr);
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
    for (const c of cols) {
      const k = b * (1 - c.i * .05);
      drawBox(c.x0, c.x1, -.5, -.5 + (c.i + 1) * H, c.z0, c.z1,
        { front: rgbK(66, 68, 82, k), side: rgbK(52, 54, 66, k), top: rgbK(104, 108, 124, k) },
        `rgba(170,190,235,${(.12 + .4 * k).toFixed(3)})`);
    }
  };
  // 昇降機：金属の床板と天井板、四隅の柱と手すり、奥側（v=1）に格子戸と暗い縦穴
  const drawElevator = (l, zn, zf, b, rel) => {
    const m = cellMap(l, zn, zf, rel), hw = .42;
    const metal = rgbK(168, 132, 64, b), metalDark = rgbK(96, 76, 40, b);
    const lw = z => Math.max(1, .025 / z * K);
    const [x0, x1, z0, z1] = boxOf(m, -1, 1, 0, 1, hw);
    const plate = yy => {
      poly([P(x0, yy, z0), P(x1, yy, z0), P(x1, yy, z1), P(x0, yy, z1)], rgbK(58, 54, 46, b), metalDark, 1.5 * dpr);
      g.strokeStyle = `rgba(0,0,0,${.45 * b})`; g.lineWidth = dpr;
      for (let i = 1; i < 4; i++) {
        const xx = x0 + (x1 - x0) * i / 4, zz = z0 + (z1 - z0) * i / 4;
        let p = P(xx, yy, z0), q = P(xx, yy, z1); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
        p = P(x0, yy, zz); q = P(x1, yy, zz); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
      }
    };
    const bar = (p1, p2, wdt, col) => { g.strokeStyle = col || metal; g.lineWidth = wdt; g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke(); };
    // 格子戸（v=1の辺）
    const [ga, gb] = [m(-1, 1, hw), m(1, 1, hw)];
    const G = (t, y) => P(ga[0] + (gb[0] - ga[0]) * t, y, ga[1] + (gb[1] - ga[1]) * t);
    const gz = (ga[1] + gb[1]) / 2;
    const drawGate = () => {
      if (rel !== 2) poly([G(0, .5), G(1, .5), G(1, -.5), G(0, -.5)], `rgba(0,0,0,${(.55 * b).toFixed(3)})`, null);
      for (const yy of [-.32, .34]) bar(G(0, yy), G(1, yy), lw(gz) * .7, metalDark);
      for (let i = 1; i < 7; i++) bar(G(i / 7, -.5), G(i / 7, .5), lw(gz) * .5, metalDark);
    };
    plate(-.5); plate(.5);
    const gateNear = rel === 2;
    if (!gateNear) drawGate();
    // 四隅の柱（遠い順）と、横の手すり
    const corners = [[x0, z1], [x1, z1], [x0, z0], [x1, z0]];
    for (const [xx, zz] of corners) bar(P(xx, -.5, zz), P(xx, .5, zz), lw(zz));
    for (const xx of [x0, x1]) for (const yy of [-.15, .2]) bar(P(xx, yy, z0), P(xx, yy, z1), lw(z1));
    if (gateNear) drawGate();
  };
  // 階段・昇降機の向き：壁に向かって上る/下る（奥が壁で反対側が通れる向きを優先）。迷宮の形から毎回同じ向きに決まる
  const stairDir = (qx, qy) => {
    const st = (qx * 7 + qy * 13) & 3, wall = dd => edgeAt(f, qx, qy, dd) === E_WALL;
    for (let i = 0; i < 4; i++) { const dd = (st + i) & 3; if (wall(dd) && !wall((dd + 2) & 3)) return dd; }
    for (let i = 0; i < 4; i++) { const dd = (st + i) & 3; if (wall(dd)) return dd; }
    return st;
  };
  const lockTint = e => e === E_LOCK ? "rgba(200,110,40,.28)" : e === E_RIDDLE ? "rgba(170,70,170,.28)" : null;
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
        const rel = (stairDir(qx, qy) - d + 4) & 3;
        if (t.t === "down") drawDownStairs(l, zn, zf, b, rel);
        else if (t.t === "up") drawUpStairs(l, zn, zf, b, rel);
        else if (t.t === "elev") drawElevator(l, zn, zf, b, rel);
      }
    }
  }
}
window.addEventListener("resize", () => { if (document.body.dataset.mode === "maze") drawView(); });
