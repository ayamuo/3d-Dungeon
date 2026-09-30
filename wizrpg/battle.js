/* 星灯の迷宮 — 戦闘・宝箱 */
"use strict";

var BT = null; // 戦闘中の状態
const MON_MISS = new Set(); // 画像が無かったモンスター（毎回404を出さないため）
const MON_OK = new Set();   // 画像を読み込めたモンスター（描き直しのたびに仮の四角が一瞬出ないよう、最初から画像ありで描く）
const MON_PRE = {};
/* その階に出る怪物の画像を先に読み込んでおく（戦闘開始時に仮の絵文字が一瞬出るのを防ぐ） */
function preloadMonImgs(fn) {
  const ids = MONSTERS.filter(m => m.fl[0] && fn >= m.fl[0] && fn <= m.fl[1]).map(m => m.id);
  for (const e of (FLOORS[fn].ev || [])) for (const [id] of (e.mons || [])) ids.push(id);
  for (const id of ids) {
    if (MON_PRE[id] || MON_MISS.has(id)) continue;
    const im = MON_PRE[id] = new Image();
    im.onerror = () => MON_MISS.add(id);
    im.onload = () => MON_OK.add(id);
    im.src = `wizrpg/monsters/${id}.png`;
  }
}

function monExp(def) {
  if (def.exp) return def.exp;
  let sp = 0;
  ["breath", "spells", "drain", "crit", "para", "stone", "poison", "call", "regen"].forEach(k => { if (def[k]) sp++; });
  return Math.round((15 * def.lv * def.lv + 25 * def.lv) * (1 + sp * 0.2));
}
function mkMon(def) { const hp = Math.max(1, dice(def.hp)); return { hp, maxhp: hp, status: "ok", silenced: false }; }
function mkGroup(id, n) {
  const def = MONSTER[id];
  return { def, ms: Array.from({ length: n }, () => mkMon(def)), ident: S.identAll || def.boss || chance(identChance()), acMod: 0 };
}
function identChance() {
  const iq = Math.max(0, ...partyChars().filter(c => c.status === "ok").map(c => c.st.iq));
  return clamp(0.3 + (iq - 10) * 0.04, 0.2, 0.7);
}
function randomGroups(fn) {
  const pool = MONSTERS.filter(m => m.fl[0] && fn >= m.fl[0] && fn <= m.fl[1]);
  let ng = 1 + (chance(0.5) ? 1 : 0) + (fn >= 4 && chance(0.35) ? 1 : 0) + (fn >= 8 && chance(0.25) ? 1 : 0);
  ng = Math.min(4, ng);
  const gs = [];
  for (let i = 0; i < ng; i++) {
    // 深い階ほど、その階の新しい怪物が出やすい
    const deep = pool.filter(m => m.fl[1] >= fn);
    const def = (deep.length && chance(0.6)) ? pick(deep) : pick(pool);
    gs.push(mkGroup(def.id, rr(def.grp[0], def.grp[1])));
  }
  return gs;
}
const gName = g => g.ident ? g.def.name : g.def.unk;
/* 正体が分かった怪物の危険な能力を、名前の下に小さな印で出す（印の意味はヘルプの「戦闘」に書く） */
const MON_ICONS = [
  [d => d.type === "undead", "👻", "不死"], [d => d.spells, "✨", "呪文を使う"],
  [d => d.breath === "fire", "🔥", "炎の息"], [d => d.breath === "cold", "❄️", "冷気の息"], [d => d.breath === "gas", "💨", "毒の息"],
  [d => d.crit, "🔪", "首をはねる"], [d => d.poison, "🧪", "毒"], [d => d.para, "⚡", "麻痺"], [d => d.stone, "🗿", "石化"],
  [d => d.sleepAtk, "🎵", "眠らせる"], [d => d.drain, "🩸", "レベルを吸い取る"], [d => d.call, "📣", "仲間を呼ぶ"],
  [d => d.regen, "♻️", "傷が治る"], [d => d.mr, "🚫", "呪文が効きにくい"],
];
const ELEM_NAME = { fire: "炎", cold: "冷気", elec: "雷" };
function monIcons(def) {
  const ic = MON_ICONS.filter(([f]) => f(def));
  // 印がないグループも同じ高さの行を取り、名前の位置がそろうようにする
  return `<div class="micons">${ic.map(([, e, t]) => `<span title="${t}">${e}</span>`).join("")}</div>`;
}
const livingMs = g => g.ms.filter(m => m.hp > 0);
const ableMs = g => g.ms.filter(m => m.hp > 0 && m.status === "ok");

/* ────────── 遭遇の演出 ──────────
   迷宮の画面にひびが入り「ENCOUNTER!」の文字が一瞬出てから戦闘画面に切り替わる */
/* ボス戦の始まり：画面がゆっくり暗くなり、ボスの黒い影が赤い光をまとって下から浮かび上がる。
   できた絵のキャンバスを返す（このあとのガラスの演出で、この絵ごと割る。割れたあとに呼び出し側で消す） */
async function bossReveal(def) {
  const st = $("stage"), cv = $("view"), W = cv.width, H = cv.height;
  if (!W || !H) return null;
  const fx = document.createElement("canvas"); fx.className = "elevfx"; fx.style.zIndex = 6; fx.width = W; fx.height = H; st.appendChild(fx);
  const g = fx.getContext("2d");
  let img = null;
  if (!MON_MISS.has(def.id)) { img = new Image(); img.src = `wizrpg/monsters/${def.id}.png`; try { await img.decode(); } catch (e) { img = null; } }
  Snd.play("rumble");
  const T = 1700, glow = Math.max(2, Math.round(H * .02)), glow2 = Math.max(4, Math.round(H * .06));
  const draw = p => {
    g.clearRect(0, 0, W, H); g.drawImage(cv, 0, 0);
    g.fillStyle = `rgba(0,0,0,${Math.min(.95, p * 2.5).toFixed(3)})`; g.fillRect(0, 0, W, H);
    const q = clamp((p - .25) / .75, 0, 1), e = 1 - (1 - q) ** 3;
    if (e <= 0) return;
    const h = H * .86 * (.86 + .14 * e), w = img ? h * img.width / img.height : h, x = (W - w) / 2, y = H * .08 + (1 - e) * H * .08;
    g.save(); g.globalAlpha = e;
    g.filter = `brightness(0) drop-shadow(0 0 ${glow}px rgba(215,40,40,.95)) drop-shadow(0 0 ${glow2}px rgba(150,20,20,.6))`;
    if (img) g.drawImage(img, x, y, w, h);
    else { g.font = `${Math.round(h * .6)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#000"; g.fillText(def.g, W / 2, H / 2); }
    g.restore();
  };
  await animate(T, draw);
  await sleep(250);
  return fx;
}
async function encounterFx(boss, src) { // src：割れる前の絵（省略すると迷宮の画面）
  const st = $("stage");
  const fx = document.createElement("div");
  fx.className = "encfx" + (boss ? " boss" : "");
  fx.innerHTML = `<canvas></canvas><b>${boss ? "BOSS BATTLE!" : "ENCOUNTER!"}</b>`;
  st.appendChild(fx);
  const T = boss ? 1300 : 900;
  glassShatter(fx.firstChild, st, T, src);
  if (BT) renderBattle(); // 割れたガラスの奥に戦闘画面を用意しておく（破片が落ちると見える）
  st.classList.remove("encshake"); void st.offsetWidth; st.classList.add("encshake");
  Snd.play("encounter"); vibrate(boss ? 150 : 70);
  await sleep(T);
  fx.remove(); st.classList.remove("encshake");
}
/* 画面のガラスが割れる演出。
   当たった点から放射状のひびと同心円状のひびを走らせ、ひびで区切られた破片ごとに景色を少しずらして映す（本物のガラスの屈折っぽく見える）。
   最後は破片が落ちて、その奥の戦闘画面に切り替わる。光過敏への配慮で、白く光らせる量はごく控えめにする */
function glassShatter(cv, st, T, src) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.width = Math.round(st.clientWidth * dpr), H = cv.height = Math.round(st.clientHeight * dpr);
  const g = cv.getContext("2d"); if (!g || !W || !H) return;
  // 割れる前の迷宮の画面を写しておく
  const snap = document.createElement("canvas"); snap.width = W; snap.height = H;
  try { snap.getContext("2d").drawImage(src || $("view"), 0, 0, W, H); } catch (e) { }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const cx = W * rnd(0.44, 0.56), cy = H * rnd(0.42, 0.56), D = Math.hypot(W, H) * 0.62;
  const NR = 16 + Math.floor(Math.random() * 5), RING = [0.04, 0.1, 0.2, 0.36, 0.6, 1.4];
  const ang = Array.from({ length: NR }, (_, i) => (i + rnd(-0.3, 0.3)) / NR * Math.PI * 2);
  // p[i][k]：i本目の放射状のひびと、k番目の輪の交わる点（少しずつ揺らして手で割ったような形にする）
  const p = ang.map(a => RING.map(r => { const rr = r * D * rnd(r < 0.15 ? 0.85 : 0.65, r < 0.15 ? 1.15 : 1.35), aa = a + rnd(-0.1, 0.1); return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr]; }));
  const jag = (a, b, amt) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, s = rnd(-amt, amt) * l; return [(a[0] + b[0]) / 2 - dy / l * s, (a[1] + b[1]) / 2 + dx / l * s]; };
  const rm = p.map((row) => row.map((pt, k) => k ? jag(row[k - 1], pt, 0.12) : jag([cx, cy], pt, 0.12))); // 放射状のひびの途中の折れ目
  const gm = p.map((row, i) => row.map((pt, k) => jag(pt, p[(i + 1) % NR][k], 0.1)));                    // 輪のひびの途中の折れ目
  const ringOn = p.map(() => RING.map((_, k) => Math.random() < [1, 0.7, 0.4, 0.25, 0.15, 0][k]));
  // 破片（2本の放射状のひびと2つの輪で囲まれた部分）
  const shards = [];
  for (let i = 0; i < NR; i++) {
    const j = (i + 1) % NR;
    for (let k = 0; k < RING.length; k++) {
      const poly = k === 0 ? [[cx, cy], rm[i][0], p[i][0], gm[i][0], p[j][0], rm[j][0]]
        : [p[i][k - 1], rm[i][k], p[i][k], gm[i][k], p[j][k], rm[j][k], p[j][k - 1], gm[i][k - 1]];
      const mx = poly.reduce((s, q) => s + q[0], 0) / poly.length, my = poly.reduce((s, q) => s + q[1], 0) / poly.length;
      const out = Math.atan2(my - cy, mx - cx);
      const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]);
      const bx = Math.max(0, Math.floor(Math.min(...xs)) - 4), by = Math.max(0, Math.floor(Math.min(...ys)) - 4);
      const bw = Math.min(W, Math.ceil(Math.max(...xs)) + 4) - bx, bh = Math.min(H, Math.ceil(Math.max(...ys)) + 4) - by;
      if (bw > 0 && bh > 0) shards.push({ poly, mx, my, k, bx, by, bw, bh, dx: rnd(-3, 3) * dpr, dy: rnd(-3, 3) * dpr, lite: rnd(-0.12, 0.1),
        vx: Math.cos(out) * rnd(20, 90) * dpr, vy: Math.sin(out) * rnd(10, 60) * dpr - rnd(0, 40) * dpr, vr: rnd(-3, 3), delay: rnd(0, 0.25) });
    }
  }
  // ひびの線（太さは中心ほど太く、外ほど細い）
  const cracks = [];
  for (let i = 0; i < NR; i++) for (let k = 0; k < RING.length; k++) {
    cracks.push({ pts: [k ? p[i][k - 1] : [cx, cy], rm[i][k], p[i][k]], r: k ? RING[k - 1] : 0, w: 1.5 - k * 0.15, a: rnd(0.5, 0.85) });
    if (ringOn[i][k]) cracks.push({ pts: [p[i][k], gm[i][k], p[(i + 1) % NR][k]], r: RING[k], w: 0.9, a: rnd(0.4, 0.7) });
    // 放射状のひびから枝分かれする短いひび（規則的なクモの巣に見えないように）
    if (k >= 2 && k < RING.length - 1 && Math.random() < 0.35) {
      const [x, y] = rm[i][k], a = ang[i] + (Math.random() < 0.5 ? -1 : 1) * rnd(0.3, 0.7), l = rnd(0.05, 0.12) * D;
      cracks.push({ pts: [[x, y], jag([x, y], [x + Math.cos(a) * l, y + Math.sin(a) * l], 0.15), [x + Math.cos(a) * l, y + Math.sin(a) * l]], r: RING[k - 1], w: 0.7, a: rnd(0.35, 0.6) });
    }
  }
  // 当たった点のまわりの細かいひび
  const bits = Array.from({ length: 26 }, () => { const a = rnd(0, 7), r = rnd(2, RING[1] * D); return [[cx + Math.cos(a) * r, cy + Math.sin(a) * r], [cx + Math.cos(a + rnd(-1, 1)) * (r + rnd(4, 12) * dpr), cy + Math.sin(a + rnd(-1, 1)) * (r + rnd(4, 12) * dpr)]]; });
  // 破片の中に、少しずらした景色を映す（重くならないよう、破片のまわりの範囲だけ写す）
  const paint = (s) => g.drawImage(snap, s.bx, s.by, s.bw, s.bh, s.bx + s.dx, s.by + s.dy, s.bw, s.bh);
  const path = (poly) => { g.beginPath(); poly.forEach((q, n) => n ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); };
  const line = (pts, w, col) => { g.beginPath(); pts.forEach((q, n) => n ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.lineWidth = Math.max(0.6, w) * dpr; g.strokeStyle = col; g.stroke(); };
  const GROW = 150, FALL = T - 420, t0 = performance.now(); let still = null;
  g.lineJoin = g.lineCap = "round";
  (function frame(now) {
    if (!cv.isConnected) return;
    const t = now - t0, reach = Math.min(1, t / GROW) * 1.1; // ひびが中心から外へ広がる
    g.clearRect(0, 0, W, H);
    if (t < FALL && still) g.drawImage(still, 0, 0);
    else if (t < FALL) {
      g.drawImage(snap, 0, 0);
      // 割れた破片ごとに、景色を少しずらして映す
      for (const s of shards) {
        if ((s.k ? RING[s.k - 1] : 0) > reach) continue;
        g.save(); path(s.poly); g.clip();
        paint(s);
        g.fillStyle = s.lite > 0 ? `rgba(210,230,255,${s.lite})` : `rgba(0,0,10,${-s.lite})`; g.fill();
        g.restore();
      }
      for (const c of cracks) {
        if (c.r > reach) continue;
        const sh = c.pts.map(q => [q[0] + dpr, q[1] + dpr]);
        line(sh, c.w + 0.6, "rgba(0,0,0,.45)");          // ひびの影
        line(c.pts, c.w + 1.4, "rgba(190,220,255,.1)"); // ひびのまわりのにじみ
        line(c.pts, c.w, `rgba(245,250,255,${c.a})`); // ひびの筋
      }
      for (const b of bits) line(b, 0.8, "rgba(240,248,255,.7)");
      if (t >= GROW) { still = document.createElement("canvas"); still.width = W; still.height = H; still.getContext("2d").drawImage(cv, 0, 0); }
    } else {
      // 破片が外へはじけながら落ちる
      const ft = (t - FALL) / 1000;
      for (const s of shards) {
        const u = Math.max(0, ft - s.delay * 0.4); if (!u) { g.save(); path(s.poly); g.clip(); paint(s); g.restore(); continue; }
        const ox = s.vx * u, oy = s.vy * u + 1400 * dpr * u * u, rot = s.vr * u;
        g.save(); g.globalAlpha = Math.max(0, 1 - u * 2.6);
        g.translate(s.mx + ox, s.my + oy); g.rotate(rot); g.translate(-s.mx, -s.my);
        path(s.poly); g.save(); g.clip(); paint(s); g.fillStyle = s.lite > 0 ? `rgba(210,230,255,${s.lite + 0.05})` : `rgba(0,0,10,${-s.lite})`; g.fill(); g.restore();
        g.lineWidth = dpr; g.strokeStyle = "rgba(235,245,255,.6)"; g.stroke();
        g.restore();
      }
    }
    requestAnimationFrame(frame);
  })(t0);
}

/* ────────── 表示 ────────── */
function renderBattle() {
  if (!BT) return;
  const sc = $("scene");
  sc.className = "on battle";
  if (sc.dataset.bg) setSceneBg(null);
  sc.innerHTML = `<div class="mgs n${BT.groups.length}">${BT.groups.map((g, i) => {
    const id = g.def.id;
    // 画像(wizrpg/monsters/ID.png)があれば表示し、無ければ絵文字の仮グラフィックのまま
    const img = MON_MISS.has(id) ? "" : `<img src="wizrpg/monsters/${id}.png" alt="" onload="MON_OK.add('${id}')" onerror="MON_MISS.add('${id}');this.parentNode.classList.remove('hasimg');this.remove()">`;
    const lv = livingMs(g).length, ab = ableMs(g).length;
    const hit = BT.hitFx && BT.hitFx.g === i && Date.now() < BT.hitFx.until ? " hit" : "";
    const tint = BT.tint && BT.tint.on && BT.tint.gs.includes(i);
    // 動きの演出：全滅したグループは崩れて沈む（dying）、攻撃してくる敵は迫る（atk）、一部が倒れたグループは一瞬暗くなる（lose）。
    // 描き直しても途中から続くよう、始まってからの時間を負の遅れ（--dl）で渡す
    const now = Date.now(); let mv = "", dl = 0;
    if (!lv && g.deathFx) { mv = " dying"; dl = now - g.deathFx; }
    else if (BT.atkFx && BT.atkFx.g === i && now - BT.atkFx.t < 360) { mv = " atk"; dl = now - BT.atkFx.t; }
    else if (g.deathFx && now - g.deathFx < 360) { mv = " lose"; dl = now - g.deathFx; }
    const sty = (tint ? `--tf:${BT.tint.f};--tc:${BT.tint.c};` : "") + (mv ? `--dl:-${dl}ms;` : "");
    return `<div class="mg${hit}${tint ? " tint" : ""}${mv}" data-g="${i}"${sty ? ` style="${sty}"` : ""}><div class="mimg${MON_MISS.has(id) ? "" : " hasimg"}" style="--mc:${g.def.col}"><span class="glyph">${g.def.g}</span>${img}<i class="kari">仮</i></div>
      <div class="mname">${i + 1}) ${esc(gName(g))}</div>${g.ident ? monIcons(g.def) : `<div class="micons"></div>`}<div class="mcnt">×${lv}<small>（${ab}）</small>${g.ms.some(m => m.hp > 0 && m.status === "sleep") ? " 💤" : ""}${g.silenced ? " 🤐" : ""}</div></div>`;
  }).join("")}</div>`;
  $("hud").innerHTML = BT.boss ? "⚔️ 決戦" : "⚔️ 戦闘中";
  renderParty();
}
/* ダメージの数字を浮かび上がらせる（敵の上・パーティ表の行の横）。首をはねたときは画面を揺らす */
function floatText(x, y, text, cls) {
  const el = document.createElement("div");
  el.className = "ftxt" + (cls ? " " + cls : ""); el.textContent = text;
  el.style.left = x / uiZoom + "px"; el.style.top = y / uiZoom + "px"; // 横長の画面で全体を拡大しているときは、画面上の位置を拡大前の単位に戻す
  document.body.appendChild(el); setTimeout(() => el.remove(), 900);
}
function popDmg(gi, text, cls) {
  const el = document.querySelector(`#scene .mg[data-g="${gi}"]`); if (!el) return;
  const r = el.getBoundingClientRect(); floatText(r.left + r.width / 2, r.top + r.height * 0.4, text, cls);
}
// 数字を複数（1回ごと・1体ごと）出すときは、少しずつ位置と時間をずらして並べる
function popDmgs(gi, list, cls) {
  const el = document.querySelector(`#scene .mg[data-g="${gi}"]`); if (!el) return;
  const r = el.getBoundingClientRect(), n = Math.min(list.length, 6), step = Math.min(30, r.width / (n + 1));
  list.slice(0, n).forEach((v, i) => setTimeout(() => floatText(r.left + r.width / 2 + (i - (n - 1) / 2) * step, r.top + r.height * (0.3 + 0.12 * (i % 2)), String(v), cls), i * 110));
}
function popParty(id, text, cls) {
  const el = document.querySelector(`#party .prow[data-id="${id}"]`); if (!el) return;
  const r = el.getBoundingClientRect(); floatText(r.right - 34, r.top + r.height / 2, text, cls || "hurt"); // HPの数字に重ならないよう、右端の状態の欄に出す
}
function stageShake() { const st = $("stage"); st.classList.remove("encshake"); void st.offsetWidth; st.classList.add("encshake"); }
function hitFx(gi) {
  if (!BT) return;
  BT.hitFx = { g: gi, until: Date.now() + 200 }; // 直後にメッセージで描き直しても揺れが消えないよう、しばらく覚えておく
  const el = document.querySelector(`#scene .mg[data-g="${gi}"]`); if (!el) return;
  el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit");
}
async function bmsg(t, ms) { renderBattle(); await flash(t, ms); }

/* ────────── 戦闘本体 ────────── */
async function battle(spec, opt = {}) {
  const fn = S.pos.f;
  const groups = spec ? spec.map(([id, n]) => mkGroup(id, n)) : randomGroups(fn);
  BT = { groups, fixed: !!opt.fixed, boss: !!opt.boss, killed: [], dispelled: [], round: 0, anti: !!FL(fn).anti[cidx(S.pos.x, S.pos.y)] };
  S.stats.battles++;
  S.encSteps = 0; // どんな戦闘でも、ランダムエンカウントの歩数カウントはリセット
  partyChars().forEach(c => { c.bac = 0; c.silenced = false; c._parry = false; });
  let result = null;
  try {
    // 遭遇の演出と同時に戦闘BGMを流し始める（最後の戦い・各階の番人は専用の曲）
    pushLog(`―― 戦闘（地下${fn}階）――`, "sep");
    Bgm.play(opt.boss ? "lastboss" : (opt.fixed && /boss$|sph$|^b10[ac]$/.test(opt.once || "")) ? "boss" : "battle");
    $("cmd").innerHTML = ""; // 迷宮の移動ボタンを演出の間に残さない
    // ボス戦（最後の戦い・各階の番人）は、画面が暗くなってボスの影が浮かび上がってから、その絵ごとガラスが割れる
    const bossy = opt.boss || (opt.fixed && /boss$|sph$|^b10[ac]$/.test(opt.once || ""));
    const shadow = bossy ? await bossReveal(groups.reduce((a, g) => (g.def.lv > a.def.lv ? g : a)).def) : null;
    await encounterFx(BT.boss, shadow);
    if (shadow) shadow.remove();
    if (groups.some(g => g.def.type === "dragon")) Snd.play("roar_dragon");
    clearMsg();
    renderBattle();
    // 友好的な怪物
    const g0 = groups[0];
    if (!spec && g0.def.friendly && groups.length === 1 && chance(g0.def.friendly)) {
      const r = await choose([{ label: "戦う", value: "fight" }, { label: "立ち去る", value: "leave", cls: "pri" }], { title: `友好的な${gName(g0)}たちに出会った。` });
      if (r === "leave") {
        for (const c of partyChars()) if (c.align === "E" && CLASSES[c.cls].align.includes("G") && chance(0.25)) { c.align = "G"; logMsg(`${c.name}の心に善の灯がともった…（性格が善になった）`); }
        await sleep(400);
        return (result = "flee");
      }
      for (const c of partyChars()) if (c.align === "G" && CLASSES[c.cls].align.includes("E") && chance(0.35)) { c.align = "E"; logMsg(`${c.name}の心は闇に染まった…（性格が悪になった）`); }
    }
    // 「〇〇が現れた！」は表示するだけで待たず、すぐに戦闘メニューを出す（演出のあとにワンテンポ待たせない）
    logMsg(groups.map(g => `${gName(g)}×${livingMs(g).length}`).join("、") + " が現れた！");
    let surprise = 0;
    // 不意打ち：盗賊・忍者がいると、こちらが先に気付きやすく、不意をつかれにくい。素早さの高いパーティも不意をつかれにくい
    if (!BT.boss) {
      const able = partyChars().filter(c => c.status === "ok");
      const scout = able.some(c => ["thi", "nin"].includes(c.cls));
      const avgAgi = able.reduce((a, c) => a + c.st.agi, 0) / Math.max(1, able.length);
      const pAmbush = clamp(0.08 - (scout ? 0.03 : 0) - Math.max(0, avgAgi - 10) * 0.004, 0.03, 0.08);
      const pFirst = scout ? 0.13 : 0.1;
      const r = Math.random();
      if (r < pFirst) surprise = 1; else if (r > 1 - pAmbush && !BT.fixed) surprise = -1;
    }
    if (opt.ambush) surprise = -1; // 行き倒れを装った罠など、必ず不意をつかれる戦闘
    if (surprise === 1) await bmsg("怪物たちはまだこちらに気付いていない！", 800);
    // 不意をつかれても、先に動けるのは前の2グループまで（後ろの群れは気付いたばかり）
    if (surprise === -1) { await bmsg("怪物たちに不意をつかれた！", 800); await runRound(false, true, 2); }
    while (!result) {
      if (!BT.groups.length) { result = "win"; break; }
      const acts = await inputPhase();
      if (acts === "flee") {
        const avgAgi = partyChars().filter(c => c.status === "ok").reduce((a, c) => a + c.st.agi, 0) / Math.max(1, partyChars().filter(c => c.status === "ok").length);
        const p = BT.boss ? 0 : clamp(0.55 + (avgAgi - 10) * 0.03 - BT.groups.length * 0.03, 0.15, 0.9);
        if (chance(p)) { Snd.play("walk"); await bmsg("パーティは逃げ出した！", 700); result = "flee"; break; }
        await bmsg(BT.boss ? "逃げることはできない！" : "逃げられなかった！", 700);
        partyChars().forEach(c => c._act = null);
      }
      result = await runRound(true, surprise !== 1);
      surprise = 0;
    }
    if (result === "win") await victory(fn, opt);
    pushLog(result === "win" ? "―― 勝利 ――" : result === "flee" ? "―― 逃走 ――" : "―― 戦闘終了 ――", "sep");
    if (result === "flee" && prevCell >= 0 && !opt.noBack) { // 1つ前のマスへ戻る
      const px = prevCell % 20, py = Math.floor(prevCell / 20);
      if (Math.abs(px - S.pos.x) + Math.abs(py - S.pos.y) === 1) { S.pos.x = px; S.pos.y = py; }
    }
    return result;
  } finally {
    if (S.inMaze) setTimeout(() => { if (S.inMaze && !BT) Bgm.play(floorBgm(S.pos.f)); }, 400); else Bgm.stop(0.8);
    BT = null;
    for (const c of partyChars()) { c.bac = 0; c.silenced = false; c._act = null; c._parry = false; if (c.status === "sleep") c.status = "ok"; }
    // 行動不能者を後ろへ
    S.party.sort((a, b) => (isDisabled(charById(a)) ? 1 : 0) - (isDisabled(charById(b)) ? 1 : 0));
    $("scene").className = ""; $("scene").innerHTML = "";
    renderParty();
    if (S.inMaze) drawView();
    saveGame(true);
  }
}

/* 各メンバーの行動を決める。全員逃げるなら"flee" */
async function inputPhase() {
  const list = partyChars();
  let i = 0;
  while (i < list.length) {
    const c = list[i];
    if (c.status !== "ok") { c._act = null; i++; continue; }
    partyHighlight = c.id; renderBattle();
    const front = S.party.indexOf(c.id) < 3;
    const bSpells = c.known.filter(s => SPELL[s].use.includes("b"));
    const hasSpell = bSpells.some(s => spellSlotsLeft(c, SPELL[s]) > 0);
    const battleUse = it => ITEM[it.id].useSpell && SPELL[ITEM[it.id].useSpell].use.includes("b");
    const usable = c.items.some(battleUse);
    const undead = BT.groups.some(g => g.def.type === "undead" && g.ident); // 正体が分かった不死の怪物がいるときだけ（押せるかどうかで正体が漏れないように）
    const firstAble = list.findIndex(x => x.status === "ok") === i;
    const a = await choose([
      { label: "⚔️ 戦う", value: "fight", disabled: !front },
      { label: "✨ 呪文", value: "spell", disabled: !hasSpell || c.silenced },
      { label: "🛡️ 身を守る", value: "parry" },
      { label: "🎒 使う", value: "use", disabled: !usable },
      CLASSES[c.cls].dispel ? { label: "☩ ディスペル", value: "dispel", disabled: !undead } : null,
      { label: "🏃 逃げる", value: "flee" },
      i > 0 ? { label: "↩ ひとつ戻る", value: "back", cls: "back" } : null,
      firstAble ? { label: "⚡ おまかせ", value: "auto" } : null,
    ], { title: `${c.name}（${clsLabel(c)}）はどうする？${front ? "" : "　※後列"}`, cols: 3 });
    if (a === "auto") {
      for (const x of list) if (x.status === "ok") x._act = S.party.indexOf(x.id) < 3 ? { t: "fight", g: 0 } : { t: "parry" };
      partyHighlight = null; return "ok";
    }
    if (a === "back") { i--; while (i > 0 && list[i].status !== "ok") i--; if (list[i].status !== "ok") i = 0; continue; }
    if (a === "flee") { partyHighlight = null; return "flee"; }
    if (a === "parry") { c._act = { t: "parry" }; i++; continue; }
    if (a === "fight") {
      const g = await pickGroup(Math.min(2, BT.groups.length), "どのグループを攻撃する？");
      if (g === null) continue;
      c._act = { t: "fight", g }; i++; continue;
    }
    if (a === "dispel") {
      const g = await pickGroup(BT.groups.length, "どのグループをディスペルする？", gg => gg.def.type === "undead" && gg.ident);
      if (g === null) continue;
      c._act = { t: "dispel", g }; i++; continue;
    }
    if (a === "spell") {
      const sid = await listPick(`${c.name}の呪文`, SPELLS.filter(s => c.known.includes(s.id) && s.use.includes("b")).map(s => ({
        html: spellRowHtml(s), right: `残${spellSlotsLeft(c, s)}`, value: s.id, disabled: spellSlotsLeft(c, s) <= 0 })),
        { ...spellListOpt(), note: BT.anti ? "⚠ ここでは呪文が封じられている！" : "" });
      if (!sid) continue;
      const t = await pickSpellTarget(SPELL[sid]);
      if (t === null) continue;
      c._act = { t: "spell", sp: sid, tgt: t }; i++; continue;
    }
    if (a === "use") {
      const ii = await listPick("何を使う？", c.items.map((it, k) => ({ label: itemName(it), right: it.known && ITEM[it.id].useSpell ? SPELL[ITEM[it.id].useSpell].name : "", value: k + 1, disabled: !battleUse(it) })));
      if (!ii) continue;
      const it = c.items[ii - 1]; const sp = SPELL[ITEM[it.id].useSpell];
      const t = await pickSpellTarget(sp);
      if (t === null) continue;
      c._act = { t: "use", item: it, sp: sp.id, tgt: t }; i++; continue;
    }
  }
  partyHighlight = null;
  return "ok";
}
async function pickGroup(n, title, filter) {
  const opts = BT.groups.slice(0, n).map((g, i) => ({ label: `${i + 1}) ${gName(g)} ×${livingMs(g).length}`, value: i, disabled: filter && !filter(g) }));
  if (opts.filter(o => !o.disabled).length === 1) return opts.find(o => !o.disabled).value;
  const r = await choose(opts, { title, cols: 1, cancel: true });
  return r === null ? null : r;
}
async function pickSpellTarget(sp) {
  if (sp.tgt === "enemy1" || sp.tgt === "group") return pickGroup(BT.groups.length, `${sp.name}：どのグループに？`);
  if (sp.tgt === "ally") {
    const r = await choose(partyChars().map(c => ({ label: `${c.name}`, subHtml: hpHtml(c) + (statusLabel(c) ? ` <em class="pst">${statusLabel(c)}</em>` : ""), value: c.id })), { title: `${sp.name}：誰に？`, cols: 2, cancel: true });
    return r === null ? null : r;
  }
  return 0;
}

/* 1ラウンドを実行。戦闘終了なら結果を返す */
async function runRound(partyOn, monOn, groupLimit = 99) {
  BT.round++;
  const actors = [];
  if (partyOn) { for (const c of partyChars()) if (c._act) actors.push({ c, init: c.st.agi + agiBonus(c.st.agi) * 2 + rr(1, 10) }); }
  else partyChars().forEach(c => c._act = null);
  if (monOn) for (const g of BT.groups.slice(0, groupLimit)) for (const m of g.ms) actors.push({ g, m, init: rr(1, 10) + Math.floor(g.def.lv / 2) + 4 });
  actors.sort((a, b) => b.init - a.init);
  for (const c of partyChars()) c._parry = c._act && c._act.t === "parry";
  for (const a of actors) {
    if (!BT.groups.length) break;
    if (a.c) {
      if (a.c.status !== "ok" || !a.c._act) continue;
      const r = await playerAct(a.c, a.c._act);
      if (r) return r;
    } else {
      if (a.m.hp <= 0 || a.m.status !== "ok" || !BT.groups.includes(a.g)) continue;
      await monsterAct(a.g, a.m);
      if (partyChars().every(c => isDisabled(c))) { renderBattle(); await sleep(500); await partyWiped(); }
    }
  }
  // ラウンド終了処理
  for (const c of partyChars()) {
    c._act = null; c._parry = false;
    if (c.status === "sleep" && chance(0.4)) c.status = "ok";
    if (c.poison && isAlive(c) && c.status !== "stone" && damageChar(c, 1)) await bmsg(`${c.name}は毒で死んだ。`, 600);
    for (const it of c.items) if (it.eq && ITEM[it.id].regen && isAlive(c) && c.hp < c.maxhp) c.hp = Math.min(c.maxhp, c.hp + ITEM[it.id].regen);
  }
  for (const g of BT.groups) {
    for (const m of g.ms) {
      if (m.hp > 0 && m.status === "sleep" && chance(0.3)) m.status = "ok";
      if (m.hp > 0 && g.def.regen) m.hp = Math.min(m.maxhp, m.hp + g.def.regen);
    }
    if (!g.ident && chance(0.25)) g.ident = true;
  }
  // 行動不能者は後ろへ
  S.party.sort((a, b) => (isDisabled(charById(a)) ? 1 : 0) - (isDisabled(charById(b)) ? 1 : 0));
  renderBattle();
  if (partyChars().every(c => isDisabled(c))) await partyWiped();
  if (!BT.groups.length) return "win";
  return null;
}
function cleanupGroups() {
  BT.groups = BT.groups.filter(g => livingMs(g).length > 0);
  for (const g of BT.groups) g.ms = g.ms.filter(m => m.hp > 0);
}
/* 全滅したグループが崩れて消える演出を見せ終わってから、一覧から外す */
async function reapGroups() {
  const dying = BT.groups.filter(g => !livingMs(g).length && g.deathFx);
  if (dying.length) {
    const wait = 520 - (Date.now() - Math.min(...dying.map(g => g.deathFx)));
    if (wait > 0) { renderBattle(); await sleep(wait); }
  }
  cleanupGroups();
}
/* 敵が攻撃してくるとき、その敵の絵が一瞬こちらへ迫る */
async function lunge(g) {
  if (!BT) return;
  BT.atkFx = { g: BT.groups.indexOf(g), t: Date.now() };
  renderBattle();
  await sleep(Math.round(200 / (S.speed || 1)));
}
function killMon(g, m, how) {
  m.hp = 0; g.deathFx = Date.now();
  if (how === "dispel") BT.dispelled.push(g.def); else BT.killed.push(g.def);
}
function targetGroup(gi) { return BT.groups[gi] || BT.groups[0]; }

/* ────────── 味方の行動 ────────── */
async function playerAct(c, act) {
  if (act.t === "parry") return null;
  if (act.t === "fight") {
    const g = targetGroup(act.g);
    if (!g) return null;
    const idx = BT.groups.indexOf(g);
    if (idx > 1 && S.party.indexOf(c.id) < 3) { /* 並びが変わって届かない場合も、一番近いグループを狙う */ }
    const m = livingMs(g)[0]; // グループの先頭の1体を集中して狙う
    const w = equipped(c, "weapon"); const wd = w ? ITEM[w.id] : null;
    const skill = hitSkill(c);
    const ac = g.def.ac + g.acMod + (m.status !== "ok" ? 6 : 0);
    const p = clamp((10 + skill + ac + 1) / 20, 0.05, 0.95);
    let hits = 0, dmg = 0, crit = false; const each = [];
    const n = swings(c);
    for (let s = 0; s < n; s++) {
      if (!chance(p)) continue;
      hits++;
      let d = wd ? dice(wd.dmg) : (c.cls === "nin" ? dice("2d4") + Math.floor(c.lvl / 3) : dice("1d2"));
      d += strDmg(c.st.str) + (wd && wd.strUp ? 2 : 0);
      if (wd && wd.slay && wd.slay === g.def.type) d *= 2;
      if (m.status === "sleep") d = Math.round(d * 1.3);
      dmg += Math.max(1, d); each.push(Math.max(1, d));
      const cr = CLASSES[c.cls].crit || 0;
      if (!g.def.boss && (cr || (wd && wd.critUp))) {
        const pc = Math.min(0.4, c.lvl * 0.012 * cr + (wd && wd.critUp ? wd.critUp : 0)) * (c.cls === "nin" && !wd ? 1.3 : 1);
        if (chance(pc) && g.def.lv <= c.lvl + 6) { crit = true; break; }
      }
    }
    const nm = gName(g);
    if (!hits) { Snd.play("miss"); await bmsg(`${c.name}の攻撃！　${nm}にかわされた。`); return null; }
    Snd.play(crit ? (weaponSnd(wd) === "axe" ? "axecrit" : "crit") : weaponSnd(wd)); hitFx(idx);
    if (crit) { popDmg(idx, "首はね！", "crit"); stageShake(); vibrate(60); } else popDmgs(idx, each);
    if (crit) {
      killMon(g, m); c.kills++;
      await bmsg(`${c.name}は${nm}の首をはねた！`, 800);
    } else {
      m.hp -= dmg;
      await bmsg(`${c.name}の攻撃！　${nm}に${hits}回当たり、${dmg}のダメージ！`);
      if (m.hp <= 0) { killMon(g, m); c.kills++; Snd.play("kill"); await bmsg(`${nm}は倒れた。`, 500); }
    }
    await reapGroups();
    return null;
  }
  if (act.t === "dispel") {
    const g = targetGroup(act.g);
    if (!g) return null;
    Snd.play("holy");
    await bmsg(`${c.name}は聖印を掲げた！`, 500);
    if (g.def.type !== "undead") { await bmsg("効果がなかった。"); return null; }
    let n = 0;
    const base = c.cls === "lor" ? 0.35 : c.cls === "bis" ? 0.4 : 0.5;
    for (const m of livingMs(g)) if (!g.def.boss && chance(clamp(base + (c.lvl - g.def.lv) * 0.08, 0.05, 0.95))) { killMon(g, m, "dispel"); n++; }
    await bmsg(n ? `${gName(g)}が${n}体消え去った！` : "しかし何も起こらなかった。");
    await reapGroups();
    return null;
  }
  if (act.t === "spell" || act.t === "use") {
    const sp = SPELL[act.sp];
    if (act.t === "spell") {
      if (spellSlotsLeft(c, sp) <= 0) return null;
      spendSlot(c, sp);
      Snd.play("cast");
      await bmsg(`${c.name}は${sp.name}を唱えた！`, 550);
    } else {
      if (!c.items.includes(act.item)) return null;
      act.item.known = true;
      await bmsg(`${c.name}は${ITEM[act.item.id].name}を使った！`, 550);
      const d = ITEM[act.item.id];
      if (d.consume) c.items.splice(c.items.indexOf(act.item), 1);
      else if (d.brk && chance(d.brk)) { c.items.splice(c.items.indexOf(act.item), 1); logMsg(`${d.name}は砕け散った。`); }
    }
    if (BT.anti) { Snd.play("shield"); await bmsg("呪文は打ち消された！"); return null; }
    return await spellEffect(c, sp, act.tgt, act.t === "use" ? act.item.id : false);
  }
  return null;
}
async function spellEffect(c, sp, tgt, fromItem) {
  Snd.play(ITEM_SND[fromItem] || SPELL_SND[sp.id] || "light");
  const resist = (g) => g.def.mr && chance(g.def.mr / 100);
  const kind = spellFxKind(sp);
  switch (sp.eff) {
    case "dmg": case "undead": {
      let targets;
      if (sp.tgt === "enemy1") { const g = targetGroup(tgt); if (!g) return null; targets = [[g, [pick(livingMs(g))]]]; }
      else if (sp.tgt === "group") { const g = targetGroup(tgt); if (!g) return null; targets = [[g, livingMs(g)]]; }
      else targets = BT.groups.map(g => [g, livingMs(g)]);
      tintGroups(targets.filter(([g]) => sp.eff !== "undead" || g.def.type === "undead").map(([g]) => groupIdx(g)), kind);
      for (const [g, ms] of targets) {
        if (sp.eff === "undead" && g.def.type !== "undead") { await bmsg(`${gName(g)}には効果がない！`); continue; }
        let tot = 0, kills = 0, blocked = 0; const each = [];
        const weak = sp.elem && g.def.res && g.def.res.includes(sp.elem); // 耐性があるとダメージは半分
        for (const m of ms) {
          if (resist(g)) { blocked++; continue; }
          let d = dice(sp.dice);
          if (weak) d = Math.floor(d / 2);
          tot += d; m.hp -= d; each.push(d);
          if (m.hp <= 0) { killMon(g, m); kills++; c.kills++; }
        }
        const hitN = ms.length - blocked;
        hitFx(BT.groups.indexOf(g));
        if (hitN) popDmgs(BT.groups.indexOf(g), each, "spell");
        if (blocked) Snd.play("shield");
        if (blocked) await bmsg(`${gName(g)}は呪文を${hitN ? blocked + "体が" : ""}無効化した！`, 500);
        if (hitN) await bmsg(`${gName(g)}${hitN > 1 ? `${hitN}体に平均${Math.round(tot / hitN)}` : `に${tot}`}のダメージ！${kills ? `　${kills}体を倒した！` : ""}`);
        if (hitN && weak) await bmsg(`${gName(g)}には${ELEM_NAME[sp.elem]}の効きが悪いようだ……`, 700);
      }
      await reapGroups();
      return null;
    }
    case "sleep": case "silence": case "suffocate": {
      const g = targetGroup(tgt); if (!g) return null;
      tintGroups([groupIdx(g)], kind);
      let n = 0;
      for (const m of livingMs(g)) {
        if (resist(g) || g.def.boss) continue;
        if (sp.eff === "sleep") { if (g.def.res && g.def.res.includes("sleep")) continue; if (chance(clamp(0.85 - g.def.lv * 0.05, 0.1, 0.85))) { m.status = "sleep"; n++; } }
        else if (sp.eff === "silence") { if (chance(clamp(0.8 - g.def.lv * 0.03, 0.2, 0.8))) { g.silenced = true; n++; } }
        else { if (g.def.type === "undead" || g.def.type === "other") continue; if (chance(g.def.lv <= 4 ? 0.9 : g.def.lv <= 8 ? 0.6 : 0.25)) { killMon(g, m); n++; c.kills++; } }
      }
      const w = { sleep: "眠った", silence: "沈黙した", suffocate: "窒息して倒れた" }[sp.eff];
      const noSleep = sp.eff === "sleep" && g.def.res && g.def.res.includes("sleep");
      await bmsg(n ? `${gName(g)}が${sp.eff === "silence" ? "" : n + "体"}${w}！` : noSleep ? `${gName(g)}は眠りを受けつけないようだ……` : "効果がなかった。");
      await reapGroups();
      return null;
    }
    case "slay": {
      tintGroups(BT.groups.map((g, i) => i), kind);
      let n = 0;
      for (const g of BT.groups) if (g.def.lv <= sp.val && !g.def.boss) for (const m of livingMs(g)) { if (!resist(g)) { killMon(g, m); n++; c.kills++; } }
      await bmsg(n ? `${n}体の怪物が消し飛んだ！` : "効果がなかった。");
      await reapGroups();
      return null;
    }
    case "death": {
      const g = targetGroup(tgt); if (!g) return null;
      tintGroups([groupIdx(g)], kind);
      const m = pick(livingMs(g));
      if (!g.def.boss && !resist(g) && chance(clamp(0.8 - g.def.lv * 0.04, 0.05, 0.8))) { killMon(g, m); c.kills++; await bmsg(`${gName(g)}の心臓が止まった！`); }
      else await bmsg("効果がなかった。");
      await reapGroups();
      return null;
    }
    case "drain": {
      const g = targetGroup(tgt); if (!g) return null;
      tintGroups([groupIdx(g)], kind);
      const m = pick(livingMs(g));
      if (resist(g)) { await bmsg(`${gName(g)}は呪文を無効化した！`); return null; }
      const left = rr(1, 4); const got = Math.max(0, m.hp - left);
      m.hp = Math.min(m.hp, left); c.hp = Math.min(c.maxhp, c.hp + got);
      await bmsg(`${gName(g)}の生命力を吸い取った！（${got}）`);
      return null;
    }
    case "eac": { const g = targetGroup(tgt); if (!g) return null; tintGroups([groupIdx(g)], kind); g.acMod += sp.val; await bmsg(`${gName(g)}は闇に包まれた。`); return null; }
    case "ac": { c.bac = (c.bac || 0) + sp.val; await bmsg(`${c.name}の守りが固くなった。`); return null; }
    case "pac": { partyChars().forEach(x => x.bac = (x.bac || 0) + sp.val); await bmsg("パーティ全員の守りが固くなった。"); return null; }
    case "heal": case "fullheal": case "cure": {
      const t = charById(tgt); if (!t || !isAlive(t)) { await bmsg("効果がなかった。"); return null; }
      if (sp.eff === "heal") { const n = healAmount(sp, c, t, fromItem); t.hp = Math.min(t.maxhp, t.hp + n); popParty(t.id, "+" + n, "heal"); await bmsg(`${t.name}のHPが${n}回復した。`); }
      else if (sp.eff === "fullheal") { t.hp = t.maxhp; t.poison = 0; t.status = "ok"; await bmsg(`${t.name}は完全に回復した！`); }
      else { if (sp.cures.includes("poison")) t.poison = 0; if (sp.cures.includes(t.status)) t.status = "ok"; await bmsg(`${t.name}は治った。`); }
      return null;
    }
    case "identify": { S.identAll = true; BT.groups.forEach(g => g.ident = true); await bmsg("怪物たちの正体が明らかになった！"); return null; }
    case "escape": {
      S.gold = Math.floor(S.gold / 2);
      await bmsg("まばゆい光がパーティを包んだ！", 800);
      BT = null; $("scene").className = "";
      await exitMaze("パーティは地上の町へ帰還した。（所持金が半分になった）");
      return "escape";
    }
    case "teleport": {
      if (FLOORS[S.pos.f].noTele) { await bmsg("強い魔力に阻まれた！"); return null; }
            [S.pos.x, S.pos.y] = randomTeleportCell(); prevCell = -1; markExplored();
      await bmsg("パーティは瞬間移動した！", 800);
      return "escape";
    }
  }
  await bmsg("何も起こらなかった。");
  return null;
}
/* 呪文の見た目：系統ごとに画面を光らせる色(c)と、当たった敵の絵を染める色(f) */
const SPELL_FX = {
  fire:    { c: "rgba(255,110,40,.45)",  f: "sepia(1) saturate(8) hue-rotate(-35deg) brightness(1.15)" },
  cold:    { c: "rgba(120,200,255,.45)", f: "sepia(1) saturate(4) hue-rotate(165deg) brightness(1.35)" },
  elec:    { c: "rgba(255,240,120,.5)",  f: "sepia(1) saturate(6) hue-rotate(10deg) brightness(1.7)" },
  nuke:    { c: "rgba(255,255,255,.7)",  f: "grayscale(1) brightness(3)" },
  holy:    { c: "rgba(255,236,170,.45)", f: "sepia(.8) saturate(2) brightness(2)" },
  dark:    { c: "rgba(120,50,170,.45)",  f: "sepia(1) saturate(4) hue-rotate(225deg) brightness(.7)" },
  sleep:   { c: "rgba(150,120,255,.35)", f: "sepia(1) saturate(3) hue-rotate(200deg) brightness(.8)" },
  silence: { c: "rgba(160,160,180,.35)", f: "grayscale(1) brightness(.7)" },
  air:     { c: "rgba(140,220,170,.35)", f: "sepia(1) saturate(3) hue-rotate(90deg) brightness(.85)" },
  heal:    { c: "rgba(120,255,150,.35)" },
  guard:   { c: "rgba(140,190,255,.3)" },
  light:   { c: "rgba(255,255,230,.45)" },
  magic:   { c: "rgba(180,140,255,.35)", f: "sepia(1) saturate(3) hue-rotate(230deg) brightness(1.3)" },
};
function spellFxKind(sp) {
  if (sp.elem) return sp.elem;
  return { dmg: "holy", undead: "holy", slay: "nuke", sleep: "sleep", silence: "silence", suffocate: "air", death: "dark", drain: "dark", eac: "dark",
    heal: "heal", fullheal: "heal", cure: "heal", ac: "guard", pac: "guard" }[sp.eff] || "light";
}
// 光の強さを変えずに色だけ取り出す（敵の絵のまわりの光に使う）
const fxGlow = (c) => c.replace(/[\d.]+\)$/, ".9)");
// 当たった敵のグループの絵を、呪文の色に1回だけ染めて、まわりをその色でぼんやり光らせる。
// 光過敏への配慮で、画面全体は光らせず、点滅もさせない。途中で描き直されても続くよう、状態は BT に持たせる
function tintGroups(gis, kind) {
  const fx = SPELL_FX[kind]; if (!BT || !fx || !fx.f || !gis.length) return;
  const t = BT.tint = { gs: gis, f: fx.f, c: fxGlow(fx.c), on: true };
  const apply = () => document.querySelectorAll("#scene .mg").forEach(el => {
    const on = t.on && gis.includes(+el.dataset.g); el.classList.toggle("tint", on);
    if (on) { el.style.setProperty("--tf", t.f); el.style.setProperty("--tc", t.c); }
  });
  apply();
  setTimeout(() => { if (!BT || BT.tint !== t) return; t.on = false; apply(); BT.tint = null; }, 450);
}
// 敵の呪文や息がパーティに当たったときは、パーティ表の枠だけをその色でぼんやり光らせる
function glowParty(kind) {
  const el = $("party"); if (!el) return;
  el.style.boxShadow = `inset 0 0 14px ${fxGlow((SPELL_FX[kind] || SPELL_FX.magic).c)}`;
  setTimeout(() => el.style.boxShadow = "", 450);
}
const groupIdx = (g) => BT.groups.indexOf(g);

/* ────────── 怪物の行動 ────────── */
const MON_SPELLS = {
  M: [null, ["firebolt", "sleepcloud"], ["firebolt", "sleepcloud"], ["flamestorm", "sparkrain"], ["blizzard", "inferno"], ["deepfreeze", "airless"], ["deepfreeze", "inferno"], ["cataclysm", "deepfreeze"]],
  P: [null, ["smite"], ["smite", "hush"], ["smite", "hush"], ["greatsmite"], ["deathword", "firepillar"], ["deathword", "firepillar"], ["judgment"]],
};
function frontTargets() {
  const pc = partyChars();
  const front = pc.slice(0, 3).filter(c => isAlive(c) && c.status !== "stone");
  return front.length ? front : pc.filter(c => isAlive(c) && c.status !== "stone");
}
function saveThrow(c, base) { return chance(clamp(base + (c.st.luk - 10) * 0.02 + c.lvl * 0.01, 0, 0.8)); }
function partyAC(c) { return computeAC(c, true) + (c._parry ? -2 : 0) + (c.status === "sleep" ? 5 : 0); }
async function monsterAct(g, m) {
  const def = g.def, nm = gName(g);
  // 逃走
  if (!def.boss && !BT.fixed && m.hp < m.maxhp * 0.3 && (def.type === "human" || def.type === "animal") && chance(0.1)) {
    m.hp = 0; cleanupGroups(); Snd.play("flee"); await bmsg(`${nm}は逃げ出した。`); return;
  }
  // 仲間を呼ぶ
  if (def.call && g.ms.length < 9 && g.calledRound !== BT.round && chance(def.call)) {
    g.calledRound = BT.round;
    Snd.play("call"); await bmsg(`${nm}は仲間を呼んだ！`, 500);
    if (chance(0.5)) { g.ms.push(mkMon(def)); await bmsg(`${nm}が現れた！`); } else await bmsg("しかし誰も来なかった。");
    return;
  }
  // 呪文
  if (def.spells && !g.silenced && chance(def.boss ? 0.65 : def.lv <= 3 ? 0.35 : 0.45)) {
    const sc = def.spells.M && (!def.spells.P || chance(0.6)) ? "M" : "P";
    const lvMax = def.spells[sc];
    const cands = [];
    for (let L = Math.max(1, lvMax - 2); L <= lvMax; L++) cands.push(...MON_SPELLS[sc][L]);
    const sp = SPELL[pick(cands)];
    Snd.play("cast");
    await bmsg(`${nm}は${sp.name}を唱えた！`, 550);
    if (BT.anti) { Snd.play("shield"); await bmsg("呪文は打ち消された！"); return; }
    await monsterSpell(def, sp);
    return;
  }
  // ブレス
  if (def.breath && chance(0.4)) {
    await lunge(g);
    Snd.play(def.breath === "fire" ? "breath_fire" : def.breath === "cold" ? "breath_ice" : "breath_gas");
    glowParty(def.breath === "gas" ? "air" : def.breath);
    await bmsg(`${nm}は${{ fire: "炎", cold: "冷気", gas: "毒の息" }[def.breath]}を吐いた！`, 550);
    const base = Math.max(2, Math.floor(m.hp / 3));
    const lines = [];
    for (const c of partyChars()) {
      if (!isAlive(c) || c.status === "stone") continue;
      let d = base; if (saveThrow(c, 0.25)) d = Math.floor(d / 2);
      if (damageChar(c, d)) lines.push(`${c.name}は死んだ！`);
      else if (def.breath === "gas" && !saveThrow(c, 0.3)) c.poison = 1;
    }
    vibrate(80); shakeParty();
    await bmsg(`パーティ全員に約${base}のダメージ！`);
    if (lines.length) Snd.play("death");
    for (const l of lines) await bmsg(l, 600);
    return;
  }
  if (!def.atk.length) { await bmsg(`${nm}はうろうろしている。`, 400); return; }
  // 打撃
  const t = pick(frontTargets()); if (!t) return;
  await lunge(g);
  // 命中率：敵レベル＋対象のAC で決める。鎧で固めるほど当たりにくくなる
  const p = clamp((partyAC(t) + def.lv + 2) / 20, 0.05, 0.95);
  let hits = 0, dmg = 0;
  for (const a of def.atk) if (chance(p)) { hits++; dmg += Math.max(1, dice(a)); }
  if (!hits) { Snd.play("block"); await bmsg(`${nm}の攻撃！　${t.name}はかわした。`); return; }
  Snd.play("hurt"); vibrate(40); shakeParty(t.id); popParty(t.id, "-" + dmg);
  const died = damageChar(t, dmg);
  await bmsg(`${nm}の攻撃！　${t.name}に${hits}回当たり、${dmg}のダメージ！`);
  if (died) { Snd.play("death"); await bmsg(`${t.name}は死んだ！`, 700); return; }
  // 特殊攻撃
  if (def.crit && !saveThrow(t, 0.1) && chance(def.crit)) { Snd.play("ecrit"); t.hp = 0; t.status = "dead"; S.stats.deaths++; stageShake(); shakeParty(t.id); popParty(t.id, "首はね"); vibrate(150); await bmsg(`${t.name}は首をはねられた！`, 900); return; }
  if (def.drain && chance(def.drain) && !saveThrow(t, 0.25)) {
    Snd.play("leveldrain");
    const lost = drainLevel(t);
    if (lost) { t.hp = 0; await bmsg(`${t.name}は生命力を吸い尽くされ、消滅した……`, 900); removeLost(t); return; }
    await bmsg(`${t.name}はレベルを吸い取られた！（Lv${t.lvl}）`, 700);
  }
  if (def.stone && chance(def.stone) && !saveThrow(t, 0.15)) { Snd.play("stone"); t.status = "stone"; await bmsg(`${t.name}は石になった！`, 700); return; }
  if (def.para && chance(def.para) && !saveThrow(t, 0.15)) { Snd.play("para"); t.status = "para"; await bmsg(`${t.name}は麻痺した！`, 700); return; }
  if (def.sleepAtk && chance(def.sleepAtk) && !saveThrow(t, 0.15)) { Snd.play("sleep"); t.status = "sleep"; await bmsg(`${t.name}は眠ってしまった！`, 600); return; }
  if (def.poison && chance(def.poison) && !t.poison && !saveThrow(t, 0.15)) { Snd.play("poison"); t.poison = 1; await bmsg(`${t.name}は毒に冒された！`, 600); }
}
function shakeParty(id) {
  const el = id ? document.querySelector(`#party .prow[data-id="${id}"]`) : $("party");
  if (!el) return; el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake");
}
async function monsterSpell(def, sp) {
  const alive = partyChars().filter(c => isAlive(c) && c.status !== "stone");
  if (!alive.length) return;
  Snd.play(SPELL_SND[sp.id] || "light");
  const monDice = { cataclysm: "6d8", judgment: "6d6", deepfreeze: "5d6", blizzard: "4d6", inferno: "4d6", flamestorm: "3d6", sparkrain: "2d6", firepillar: "2d8" }; // 怪物が唱える全体呪文はパーティ全員に当たるので弱めにする
  if (sp.eff === "dmg") {
    glowParty(spellFxKind(sp)); shakeParty(); vibrate(80);
    const targets = sp.tgt === "enemy1" ? [pick(alive)] : alive;
    const lines = []; let tot = 0;
    for (const c of targets) {
      let d = dice(monDice[sp.id] || sp.dice); if (saveThrow(c, 0.2)) d = Math.floor(d / 2);
      tot += d; if (damageChar(c, d)) lines.push(`${c.name}は死んだ！`);
    }
    await bmsg(targets.length > 1 ? `パーティ全員に平均${Math.round(tot / targets.length)}のダメージ！` : `${targets[0].name}に${tot}のダメージ！`);
    if (lines.length) Snd.play("death");
    for (const l of lines) await bmsg(l, 600);
    return;
  }
  if (sp.eff === "sleep") {
    let n = 0;
    for (const c of alive) if (c.status === "ok" && !saveThrow(c, 0.3)) { c.status = "sleep"; n++; }
    await bmsg(n ? `${n}人が眠ってしまった！` : "誰も眠らなかった。"); return;
  }
  if (sp.eff === "silence") {
    let n = 0;
    for (const c of alive) if (!saveThrow(c, 0.35)) { c.silenced = true; n++; }
    await bmsg(n ? `${n}人が沈黙させられた！（呪文が使えない）` : "効果がなかった。"); return;
  }
  if (sp.eff === "suffocate") {
    const lines = [];
    for (const c of alive) if (!saveThrow(c, 0.3) && chance(clamp(0.4 - (c.lvl - 5) * 0.05, 0.05, 0.4))) { c.hp = 0; c.status = "dead"; S.stats.deaths++; lines.push(`${c.name}は窒息した！`); }
    await bmsg(lines.length ? lines.join(" ") : "パーティは息を止めて耐えた！"); return;
  }
  if (sp.eff === "death") {
    const t = pick(alive);
    if (!saveThrow(t, 0.3) && chance(clamp(0.6 - t.lvl * 0.03, 0.1, 0.6))) { t.hp = 0; t.status = "dead"; S.stats.deaths++; await bmsg(`${t.name}の心臓が止まった！`, 800); }
    else await bmsg(`${t.name}は耐えた！`);
    return;
  }
  await bmsg("しかし何も起こらなかった。");
}

/* ────────── 勝利 ────────── */
function randomLoot(fn, n) {
  const out = [];
  const maxT = Math.min(5, Math.floor((fn + 1) / 2));
  for (let i = 0; i < n; i++) {
    let t = maxT - (chance(0.45) ? 0 : chance(0.6) ? 1 : 2);
    t = clamp(t, 0, 5);
    if (t === 5 && !chance(0.35)) t = 4; // 最上位の品はめったに出ない
    let pool = ITEMS.filter(it => it.tier === t && !["oborozuki"].includes(it.id));
    if (!pool.length) pool = ITEMS.filter(it => it.tier === 0);
    out.push({ id: pick(pool).id, known: false });
  }
  return out;
}
async function victory(fn, opt) {
  Bgm.stop(0.5); // 勝利のファンファーレの前にBGMを下げる
  cleanupGroups();
  const killed = BT.killed, disp = BT.dispelled;
  S.stats.kills += killed.length + disp.length;
  let exp = killed.reduce((a, d) => a + monExp(d), 0) + Math.floor(disp.reduce((a, d) => a + monExp(d), 0) / 2);
  let gold = killed.reduce((a, d) => a + d.lv * rr(4, 12) * (d.gold || 1), 0);
  if (opt.fixed) gold = Math.floor(gold * 1.5);
  const alive = partyChars().filter(c => isAlive(c) && c.status !== "stone");
  const each = alive.length ? Math.floor(exp / alive.length) : 0;
  alive.forEach(c => c.exp += each);
  Snd.play("win");
  $("hud").innerHTML = "🏆 勝利";
  await bmsg(`怪物たちを倒した！　経験値を${each.toLocaleString()}ずつ獲得した。`, 1100);
  const lv = alive.filter(c => c.exp >= nextExp(c));
  if (lv.length) logMsg(`（${lv.map(c => c.name).join("、")}は宿屋で休むとレベルが上がる）`);
  // 最後の戦いのあとは宝箱を出さない（エンディングへの流れを切らないように）
  const hasChest = killed.length && !opt.boss && (opt.fixed ? !opt.reward || !opt.reward.item : chance(0.33));
  BT.groups = [];
  if (hasChest) {
    const items = randomLoot(fn, opt.fixed ? 1 + (chance(0.4) ? 1 : 0) : (chance(0.55) ? 1 : 0));
    await chestEvent({ gold, items, trapLv: fn });
  } else if (gold) {
    S.gold += gold;
    await bmsg(`${gold.toLocaleString()}ゴールドを手に入れた。`, 800);
  }
}

/* ────────── 宝箱 ────────── */
function pickTrap(lv) {
  if (chance(0.25)) return "none";
  const ok = TRAPS.filter(t => t.id !== "none" && t.min <= lv && !(t.id === "teleport" && FLOORS[S.pos.f].noTele));
  return pick(ok).id;
}
const trapName = id => TRAPS.find(t => t.id === id).name;
async function chestEvent(opt) {
  try { return await chestBody(opt); }
  finally { if (!BT) { $("scene").className = ""; $("scene").innerHTML = ""; renderParty(); if (S.inMaze) drawView(); } }
}
async function chestBody({ gold, items, trapLv }) {
  const trap = pickTrap(trapLv);
  let disarmed = trap === "none";
  const sc = $("scene");
  sc.className = "on chest";
  setSceneBg("chest");
  sc.innerHTML = `<div class="plc"><div class="pg">🧰</div><div class="pn">宝箱</div><div class="pd">罠が仕掛けられているかもしれない……</div></div>`;
  $("hud").innerHTML = "🧰 宝箱";
  const thiefLike = c => ["thi", "nin"].includes(c.cls);
  while (true) {
    const canCalfa = partyChars().some(c => c.status === "ok" && c.known.includes("trapsense") && spellSlotsLeft(c, SPELL.trapsense) > 0);
    const k = await choose([
      { label: "開ける", value: "open", cls: "pri" }, { label: "調べる", value: "inspect" },
      { label: "罠を外す", value: "disarm" }, { label: "罠見破り", value: "trapsense", disabled: !canCalfa },
      { label: "立ち去る", value: "leave" },
    ], { title: "宝箱だ！　どうする？", cols: 2 });
    if (k === "leave") { if (await confirmBox("宝箱を置いて立ち去りますか？")) return; continue; }
    if (k === "open") {
      const c = await pickMember("誰が開ける？", x => x.status === "ok");
      if (!c) continue;
      if (!disarmed) { const r = await springTrap(trap, c, trapLv); if (r === "gone") return; }
      break;
    }
    if (k === "inspect") {
      const c = await pickMember("誰が調べる？", x => x.status === "ok");
      if (!c) continue;
      const skill = thiefLike(c) ? clamp(0.6 + c.lvl * 0.03 + (c.st.agi - 10) * 0.02, 0.5, 0.95) * CLASSES[c.cls].thief : clamp(0.15 + c.lvl * 0.02, 0.1, 0.4);
      if (!thiefLike(c) && chance(0.08)) { await tell(`${c.name}は罠を作動させてしまった！`); const r = await springTrap(trap, c, trapLv); if (r === "gone") return; break; }
      const guess = chance(skill) ? trap : pick(TRAPS.filter(t => t.min <= trapLv)).id;
      Snd.play("move");
      await tell(`${c.name}は宝箱を調べた。\n「${trapName(guess)}」のようだ。`);
      continue;
    }
    if (k === "trapsense") {
      const c = await pickMember("誰が唱える？", x => x.status === "ok" && x.known.includes("trapsense") && spellSlotsLeft(x, SPELL.trapsense) > 0);
      if (!c) continue;
      c.mpP[SPELL.trapsense.lv - 1]--;
      Snd.play("light");
      await tell(`${c.name}は「罠見破り」を唱えた。\n罠は「${trapName(chance(0.95) ? trap : pick(TRAPS).id)}」だ！`);
      continue;
    }
    if (k === "disarm") {
      const c = await pickMember("誰が罠を外す？", x => x.status === "ok");
      if (!c) continue;
      const nm = await choose(TRAPS.filter(t => t.min <= Math.max(trapLv, 1)).map(t => ({ label: t.name, value: t.id })), { title: "罠の名前を選ぶ", cols: 2, cancel: true });
      if (!nm) continue;
      if (nm !== trap) {
        await tell(`${c.name}は罠を外そうとした……\nしまった、罠の種類が違う！`);
        const r = await springTrap(trap, c, trapLv); if (r === "gone") return;
        break;
      }
      if (trap === "none") { await tell("罠はなかった。"); break; }
      const skill = thiefLike(c) ? clamp(0.55 + c.lvl * 0.04 + (c.st.agi - 10) * 0.02, 0.4, 0.95) * CLASSES[c.cls].thief : clamp(0.1 + c.lvl * 0.01, 0.05, 0.3);
      if (chance(skill)) { Snd.play("sparkle"); await tell(`${c.name}は${trapName(trap)}を外した！`); c.exp += 10 * trapLv; break; }
      if (chance(0.5)) { await tell(`${c.name}は失敗して罠を作動させた！`); const r = await springTrap(trap, c, trapLv); if (r === "gone") return; break; }
      await tell("うまく外せなかった……（もう一度試せる）");
      continue;
    }
  }
  // 中身
  Snd.play("chest");
  const got = [];
  if (gold) { S.gold += gold; got.push(`${gold.toLocaleString()}ゴールド`); }
  for (const it of items) {
    const c = giveItemToParty(it.id, it.known);
    got.push(c ? `${c.name}は${it.known ? ITEM[it.id].name : ITEM[it.id].unk}を手に入れた` : `${ITEM[it.id].unk}（持ちきれず捨てた）`);
  }
  renderParty(); saveGame();
  await tell(got.length ? "宝箱を開けた！\n" + got.join("\n") : "宝箱は空っぽだった。");
}
/* 罠の煙：色の付いた煙が表示窓いっぱいに広がって薄れていく（画面を白く光らせることはしない） */
function trapSmoke(color) {
  const st = $("stage"), fx = document.createElement("div");
  fx.className = "smoke"; fx.style.setProperty("--sm", color); st.appendChild(fx);
  setTimeout(() => fx.remove(), 1600);
}
async function springTrap(trap, c, lv) {
  vibrate(100);
  // 罠ごとの見た目：爆弾は大きく揺れて茶色い煙、毒ガスは緑の煙、呪文の罠は紫の煙
  if (trap === "bomb") { stageShake(); trapSmoke("rgba(120,90,60,.85)"); }
  else if (trap === "gas") trapSmoke("rgba(90,170,70,.8)");
  else if (trap === "mblast" || trap === "pblast") { trapSmoke("rgba(130,70,180,.8)"); stageShake(); }  Snd.play({ needle: "trap_needle", arrow: "trap_arrow", gas: "breath_gas", stunner: "trap_stun", bomb: "trap_bomb", teleport: "tele", alarm: "trap", mblast: "darkspell", pblast: "darkspell" }[trap] || "trap");
  const alive = partyChars().filter(x => isAlive(x) && x.status !== "stone");
  const deaths = [];
  const hurt = (x, d) => { if (damageChar(x, d)) deaths.push(x.name); };
  let msg = "";
  switch (trap) {
    case "needle": c.poison = 1; msg = `毒針だ！　${c.name}は毒に冒された。`; break;
    case "arrow": { const d = rr(1, lv * 4 + 4); hurt(c, d); msg = `石弓の矢が飛び出した！　${c.name}に${d}のダメージ。`; break; }
    case "gas": alive.forEach(x => { if (!saveThrow(x, 0.3)) x.poison = 1; }); msg = "ガス爆弾だ！　毒ガスが噴き出した！"; break;
    case "stunner": if (!saveThrow(c, 0.2)) { c.status = "para"; msg = `痺れ針だ！　${c.name}は麻痺した！`; } else msg = `スタナーだ！　${c.name}は何とか耐えた。`; break;
    case "bomb": alive.forEach(x => hurt(x, saveThrow(x, 0.3) ? rr(1, lv * 2 + 2) : rr(1, lv * 3 + 4))); msg = "爆弾だ！　宝箱が爆発した！"; break;
    case "teleport": {
      [S.pos.x, S.pos.y] = randomTeleportCell(); prevCell = -1; markExplored();
      await tell("テレポーターだ！　パーティはどこかへ飛ばされた！\n（宝箱は消えてしまった）");
      renderParty(); return "gone";
    }
    case "alarm": {
      await tell("警報だ！　けたたましい音が鳴り響く！");
      const saved = BT; BT = null;
      const r = await battle(null, { noBack: true });
      BT = saved;
      if (r !== "win") return "gone";
      $("scene").className = "on chest";
      setSceneBg("chest");
      $("scene").innerHTML = `<div class="plc"><div class="pg">🧰</div><div class="pn">宝箱</div></div>`;
      return "ok";
    }
    case "mblast": alive.forEach(x => { if ((x.known.some(s => SPELL[s].sc === "M")) && !saveThrow(x, 0.2)) x.status = "para"; }); msg = "魔術師殺しだ！　呪文使いたちが麻痺した！"; break;
    case "pblast": alive.forEach(x => { if ((x.known.some(s => SPELL[s].sc === "P")) && !saveThrow(x, 0.2)) x.status = "para"; }); msg = "僧侶殺しだ！　僧侶たちが麻痺した！"; break;
  }
  renderParty();
  if (msg) await tell(msg);
  if (deaths.length) await tell(`${deaths.join("、")}は死んだ……`);
  if (partyChars().every(x => isDisabled(x))) await partyWiped();
  return "ok";
}
