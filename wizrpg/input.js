/* 星灯の迷宮 — キーボード・ゲームパッドでの操作
   ・迷宮：十字キー/スティックで移動、A＝階段・昇降機（無ければ調べる）、X＝地図、Y/START＝キャンプ
   ・メニュー・戦闘：十字キーでボタンを選び、A＝決定、B＝戻る（選択中のボタンは光る枠で表示）
   ・キーボード：矢印キーで選択、Enter/Space/Z＝決定、Esc/X/BackSpace＝戻る */
"use strict";
const Nav = (() => {
  let navMode = false;   // キーボードかゲームパッドを最後に使ったか（タップしたら枠を消す）
  // コントローラ・キーボードで操作している間は body に navmode を付ける（マウスの位置に出る ▶ を隠し、カーソルが2つ出ないようにする）
  const setNav = v => { navMode = v; document.body.classList.toggle("navmode", v); };
  let cur = null;        // 選択中の要素
  let cmdCur = null;     // 画面下のボタン欄で最後に選んでいた要素（ダイアログを閉じたら戻す）
  const CANCEL_WORDS = ["とじる", "もどる", "やめる", "いいえ", "降りない", "キャンプを出る", "町へ戻る", "そのまま"];

  const visible = el => el && el.offsetParent !== null && !el.disabled;
  const help = () => $("helpOv").classList.contains("on") ? $("helpOv") : null;
  const overlay = () => $("ov").classList.contains("on") ? $("ov") : null;
  const mazePad = () => !help() && !overlay() && !!$("cmd").querySelector(".pad");

  function items() {
    const ov = overlay();
    if (ov) return [...ov.querySelectorAll("button, input")].filter(visible);
    const list = [...$("cmd").querySelectorAll("button")].filter(visible);
    // 町ではパーティ表の人物も選べるようにする（装備の変更などに必要）
    if (!BT && !mazePad() && document.body.dataset.mode === "town") list.push(...$("party").querySelectorAll(".prow[data-id]"));
    return list;
  }
  function defaultItem(list) {
    const ov = overlay();
    if (ov) return list.find(e => e.classList.contains("srow")) || list.find(e => e.tagName === "INPUT")
      || list.find(e => e.closest(".sfoot") && e.classList.contains("pri")) || list[list.length - 1];
    return list.find(e => e.classList.contains("next")) || list[0];
  }
  function setCur(el) {
    if (cur) cur.classList.remove("gfocus");
    cur = el || null;
    if (cur && !overlay() && !help()) cmdCur = cur;
    if (!cur || !navMode) return;
    cur.classList.add("gfocus");
    try { cur.scrollIntoView({ block: "nearest" }); } catch (e) { }
    if (cur.tagName === "INPUT") cur.focus();
  }
  /* 画面ごとに、最後に決定した項目を覚えておく（一覧から選んで戻ってきたとき、同じ所にカーソルを戻す）。
     画面の見分けは見出しの文字（数字は変わるので除く）。危ない操作のボタン（danger）には戻さない */
  const memo = {};
  function scopeKey() {
    const ov = overlay();
    const t = ov ? ov.querySelector(".shead b") : $("cmd").querySelector(".ctitle");
    return (ov ? "ov:" : "cmd:") + (t ? t.textContent : "").replace(/[0-9０-９,，]+/g, "#");
  }
  // 覚えないもの：戦闘中（キャラごとに行動が違うので毎回はじめの位置から）、閉じる・戻るのボタン
  const isCancelBtn = el => (!!el.closest(".sfoot") && !el.classList.contains("keep")) || el.classList.contains("back") || CANCEL_WORDS.includes(el.textContent.trim());
  function remember(el) {
    if (help() || mazePad() || BT || isCancelBtn(el)) return;
    memo[scopeKey()] = { v: el.dataset.v, text: el.textContent };
  }
  // 覚えた項目が今の一覧にあればそこへ。見つからなければ（選んだ人が一覧から消えた等）はじめの位置
  function recalled(list) {
    const m = memo[scopeKey()];
    if (!m || BT) return null;
    const el = list.find(e => m.v !== undefined ? e.dataset.v === m.v : e.textContent === m.text);
    return el && !el.classList.contains("danger") && !isCancelBtn(el) ? el : null;
  }
  // ボタンの目印（種類・data属性・文字）。画面が描き直されても、同じ役割のボタンなら同じ目印になる
  const sigOf = el => el.tagName + JSON.stringify(el.dataset) + "|" + el.textContent;
  function ensure() {
    const list = items();
    // 選んでいたボタンが描き直しで作り直されたら（＋－のボタンなど）、同じ役割のボタンにカーソルを残す
    if (cur && !cur.isConnected) { const sig = sigOf(cur), same = list.find(e => sigOf(e) === sig); if (same) { setCur(same); return cur; } }
    if (!cur || !list.includes(cur)) setCur(list.includes(cmdCur) ? cmdCur : recalled(list) || defaultItem(list));
    else setCur(cur);
    return cur;
  }
  // 画面上の位置関係で、押した方向のボタンへ移る。
  // 上下：まず押した方向でいちばん近い段を選び、その段の中で横の位置がいちばん近いボタンへ
  //       （段ごとにボタンの数が違う画面（設定など）でも、1つ飛ばして先の段へ行かないように）
  // 左右：同じ段の中で、いちばん近いボタンへ（同じ段にほかのボタンが無ければ動かない）
  // 端まで来たら反対側の端へ回り込む（上下はいちばん遠い段の中で横が近いボタン、左右は同じ段の反対端）
  function move(dir) { // 0上 1右 2下 3左
    if (!ensure()) return;
    const r0 = cur.getBoundingClientRect(), x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
    const fwd = [], back = [];
    for (const el of items()) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - x0, dy = r.top + r.height / 2 - y0;
      const main = [-dy, dx, dy, -dx][dir], side = Math.abs(dir % 2 ? dy : dx);
      if (main > 2) fwd.push({ el, d: main, side });
      else if (main < -2) back.push({ el, d: -main, side });
    }
    const minSide = list => list.reduce((a, c) => (c.side < a.side ? c : a));
    // 段（列）を1つ選ぶ：far=false ならいちばん近い段、true ならいちばん遠い段。高さの多少のずれは同じ段とみなす
    const pickLine = (list, far) => {
      const edge = far ? Math.max(...list.map(c => c.d)) : Math.min(...list.map(c => c.d));
      return minSide(list.filter(c => Math.abs(c.d - edge) <= 8)).el;
    };
    const sameRow = list => list.filter(c => c.side <= r0.height / 2);
    let best = null;
    if (dir % 2) {
      const row = sameRow(fwd);
      if (row.length) best = row.reduce((a, c) => (c.d < a.d ? c : a)).el;
      else if (sameRow(back).length) best = sameRow(back).reduce((a, c) => (c.d > a.d ? c : a)).el;
      // 同じ段にほかのボタンが無いとき（「とじる」だけの段など）は動かない
    } else if (fwd.length) best = pickLine(fwd, false);
    else if (back.length) best = pickLine(back, true);
    if (best) { setCur(best); Snd.play("move"); }
  }
  // 戦闘メッセージの早送り（画面タップと同じ扱い）
  const skip = () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  function activate() {
    const el = ensure();
    if (!el) { skip(); return; }
    if (el.tagName === "INPUT") { const p = overlay() && overlay().querySelector(".sfoot .pri"); if (p) p.click(); return; }
    remember(el);
    el.click();
    // 押したボタンが描き直されて消えたときは、すぐに同じ役割のボタンへ枠を付け直す
    if (!el.isConnected && navMode) setTimeout(() => { if (cur === el) ensure(); }, 0);
  }
  function cancel() {
    const ov = overlay();
    const scope = ov || $("cmd");
    const btns = [...scope.querySelectorAll("button")].filter(visible);
    const b = btns.find(x => x.classList.contains("back")) || btns.find(x => CANCEL_WORDS.includes(x.textContent.trim()))
      || (ov && btns.length === 1 ? btns[0] : null);
    if (b) b.click();
  }
  function helpTab(d) {
    const tabs = [...$("helpOv").querySelectorAll(".htabs button")];
    const i = tabs.findIndex(t => t.classList.contains("on"));
    const n = tabs[(i + d + tabs.length) % tabs.length];
    if (n) { n.click(); Snd.play("move"); }
  }
  function mazeAct(a) { if (inputResolver) inputResolver(a); }
  function mazeA() { mazeAct($("cmd").querySelector('[data-a="tile"]') ? "tile" : "search"); }

  /* 共通の入力（キーボードとゲームパッドの両方から呼ぶ） */
  function press(k, repeat) {
    markActive(); // プレイ時間を数えるための「操作した」印
    setNav(true);
    const h = help();
    if (h) {
      if (k === "left" || k === "right") { if (!repeat) helpTab(k === "right" ? 1 : -1); }
      else if (k === "up" || k === "down") h.querySelector(".hpages").scrollBy(0, k === "down" ? 90 : -90);
      else if (!repeat && ["a", "b", "start", "select"].includes(k)) $("helpClose").click();
      return;
    }
    if (k === "lt" || k === "rt") { if (!repeat) toggleBacklog(); return; }
    // これまでのメッセージを開いているあいだは、上下で読み進める
    const bl = document.querySelector("#ov.on .backlog");
    if (bl && (k === "up" || k === "down")) { bl.closest(".sbody").scrollBy(0, k === "down" ? 90 : -90); return; }
    if (mazePad()) {
      if (repeat && k !== "up") return; // 押しっぱなしで進めるのは前進だけ
      const m = { up: "fwd", down: "back", left: "left", right: "right", lb: "left", rb: "right", x: "map", y: "camp", start: "camp" }[k];
      if (m) mazeAct(m);
      else if (k === "a") mazeA();
      else if (k === "select") $("helpBtn").click();
      return;
    }
    const dir = { up: 0, right: 1, down: 2, left: 3 }[k];
    if (dir !== undefined) move(dir);
    else if (repeat) return;
    else if (k === "a") activate();
    else if (k === "b") cancel();
    else if (k === "select") $("helpBtn").click();
  }

  // 画面が切り替わったら、選択を新しい画面の既定のボタンへ
  const refresh = () => setTimeout(() => { if (cur) cur.classList.remove("gfocus"); cur = null; if (navMode) ensure(); }, 0);
  new MutationObserver(refresh).observe($("cmd"), { childList: true, subtree: true });
  new MutationObserver(refresh).observe($("ov"), { childList: true });
  new MutationObserver(refresh).observe($("helpOv"), { attributes: true, attributeFilter: ["class"] });
  // タップやクリックをしたら枠を消す
  document.addEventListener("pointerdown", e => { if (e.isTrusted && navMode) { setNav(false); if (cur) cur.classList.remove("gfocus"); } }, true);
  // マウスを動かしたら、マウスで操作しているとみなす（キーボード・コントローラのカーソルは消す）
  document.addEventListener("mousemove", e => { if (e.isTrusted && navMode && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) { setNav(false); if (cur) cur.classList.remove("gfocus"); } }, true);

  /* ── キーボード ── */
  document.addEventListener("keydown", e => {
    const inInput = e.target && e.target.tagName === "INPUT";
    if (inInput && !["Enter", "Escape", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    if (e.code === "KeyL" && !inInput && !help()) { if (!e.repeat) { e.preventDefault(); toggleBacklog(); } return; }
    if (mazePad() && !help()) {
      // 迷宮の移動キー（矢印・WASDなど）は explore.js 側で処理している。ここでは決定キーと遊び方だけ
      if (["Enter", " "].includes(e.key)) { e.preventDefault(); setNav(true); mazeA(); }
      return;
    }
    const k = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "a", " ": "a", z: "a", Z: "a",
      Escape: "b", x: "b", X: "b", Backspace: "b" }[e.key];
    if (!k) return;
    if (inInput && k === "b" && e.key !== "Escape") return;
    e.preventDefault();
    press(k, e.repeat);
  });

  /* ── ゲームパッド（標準配置：A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 SELECT=8 START=9 十字キー=12〜15） ── */
  let prev = {}, next = {}, running = false;
  function poll(t) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    if (!pads.length) { running = false; prev = {}; return; }
    const p = pads[0], b = i => !!(p.buttons[i] && p.buttons[i].pressed);
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    const st = { up: b(12) || ay < -0.55, down: b(13) || ay > 0.55, left: b(14) || ax < -0.55, right: b(15) || ax > 0.55,
      a: b(0), b: b(1), x: b(2), y: b(3), lb: b(4), rb: b(5), lt: b(6), rt: b(7), select: b(8), start: b(9) };
    for (const k in st) {
      if (st[k] && !prev[k]) { press(k, false); next[k] = t + 380; }
      else if (st[k] && next[k] && t > next[k] && ["up", "down", "left", "right"].includes(k)) {
        press(k, true); next[k] = t + (mazePad() ? 280 : 140); // 押しっぱなしの連続入力（迷宮では歩く速さ）
      }
    }
    prev = st;
    requestAnimationFrame(poll);
  }
  function start() { if (!running) { running = true; requestAnimationFrame(poll); } }
  window.addEventListener("gamepadconnected", e => {
    start();
    try { logMsg(`🎮 コントローラーを認識しました（${(e.gamepad.id || "").split("(")[0].trim() || "ゲームパッド"}）`); } catch (er) { }
  });
  if (navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) start();

  // 画面の見出しを指定して、次に開いたときのカーソル位置（項目の data-v）を覚えさせる
  function recall(title, v) { memo["ov:" + title.replace(/[0-9０-９,，]+/g, "#")] = { v: String(v) }; }
  return { press, recall };
})();
