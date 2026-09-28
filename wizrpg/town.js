/* 星灯の迷宮 — 鉱山町（酒場・宿屋・商店・聖堂・訓練所・評議会）とキャラクター画面 */
"use strict";

const PLACES = {
  town:   { name: "鉱山町グレイヴン", g: "⛏️", d: "山あいの鉱山町。坑道の底に、十層の封印迷宮が口を開けている。" },
  tavern: { name: "酒場・つるはし亭", g: "🍺", d: "冒険者たちが仲間を探している。" },
  inn:    { name: "坑夫の宿",         g: "🛏️", d: "休めばHPと呪文が回復する。経験を積んでいればレベルも上がる。" },
  shop:   { name: "鉄と灯の商会",     g: "⚖️", d: "「いらっしゃい！迷宮帰りの品も買い取るよ」" },
  temple: { name: "星灯の聖堂",       g: "⛪", d: "死者の蘇生や、麻痺・石化の治療を寄付金と引き換えに行う。" },
  train:  { name: "ギルド訓練所",     g: "⚔️", d: "新しい冒険者の登録や、転職ができる。" },
  castle: { name: "町の評議会",       g: "🏛️", d: "迷宮の報告と、冒険の記録を確認できる。" },
};
function showScene(key, extra) {
  const p = PLACES[key];
  const sc = $("scene");
  sc.className = "on town";
  setSceneBg(key);
  sc.innerHTML = `<div class="plc"><div class="pg">${p.g}</div><div class="pn">${p.name}</div><div class="pd">${esc(extra || p.d)}</div></div>`;
  $("loc").textContent = p.name;
  document.body.dataset.mode = "town";
}

/* ────────── タイトル ────────── */
async function titleScreen() {
  document.body.dataset.mode = "title";
  const sc = $("scene");
  sc.className = "on title";
  setSceneBg("title");
  // 町の背景・宝箱・地下1階の画像を、タイトルを見ている間に裏で読み込んでおく
  ["town", "tavern", "inn", "shop", "temple", "train", "castle", "chest", "wipe"].forEach(preloadBg);
  preloadFloor(1);
  sc.innerHTML = `<div class="ttl"><div class="t1">星灯の迷宮</div><div class="t2">― 十層の封印 ―</div><div class="t3">THE LABYRINTH OF THE STARLIGHT SEAL</div></div>`;
  $("loc").textContent = "";
  clearMsg();
  logMsg("坑道の底の封印迷宮から、要の〈星灯〉が奪われた。");
  logMsg("封印がほどければ、地の底の『星喰い』が目を覚ますという――");
  S = null; renderParty();
  // 記録の枠を選ぶ
  const last = lastSlot();
  const slots = [];
  for (let n = 1; n <= SAVE_SLOTS; n++) slots.push({ n, s: loadGame(n) });
  const slotSub = s => {
    if (!s) return "空き";
    const lv = Math.max(0, ...s.roster.map(c => c.lvl || 0));
    return `${s.rule === "classic" ? "本格" : "救済"}・${s.deepest ? "地下" + s.deepest + "階" : "町"}・最高Lv${lv}${s.cleared ? "・★" : ""}`;
  };
  const n = await choose(slots.map(({ n, s }) => ({ label: `記録${n}`, sub: slotSub(s), value: n, cls: n === last && s ? "pri" : "" })).concat([{ label: "⚙ 設定", value: "opt" }]), { cols: 1 });
  if (n === "opt") {
    await dialog(fontOptHtml() + walkOptHtml() + spellDescOptHtml(), null, { title: "設定", onOpen: b => b.querySelectorAll(".spd button").forEach(bt => bt.onclick = () => { fontOptClick(bt, b) || walkOptClick(bt, b) || spellDescOptClick(bt, b); }) });
    return titleScreen();
  }
  curSlot = n;
  const saved = slots[n - 1].s;
  if (saved) {
    const c = await choose([
      { label: "つづきから", value: "cont", cls: "pri" },
      { label: "はじめから", value: "new" },
    ], { cols: 1, title: `記録${n}`, cancel: true });
    if (!c) return titleScreen();
    if (c === "cont") { S = saved; S.speed = S.speed || 1; try { localStorage.setItem(SLOT_KEY, String(n)); } catch (e) { } return resumeGame(); }
    // うっかり消さないよう、消える記録の中身を見せ、「やめる」を標準の選択にする
    const played = Math.floor((Date.now() - ((saved.stats && saved.stats.startedAt) || Date.now())) / 60000);
    const ok = await dialog(`<p>記録${n}を消して、はじめから遊びますか？</p>
      <div class="rulebox">${esc(slotSub(saved))}<br>冒険者 ${saved.roster.length}人　所持金 ${(saved.gold || 0).toLocaleString()}G　プレイ時間 約${played}分</div>
      <p class="warn">消した記録は元に戻せません。</p>`,
      [{ label: "消してはじめる", value: true, cls: "danger" }, { label: "やめる", value: false, cls: "pri" }], { title: "記録を消す", small: true });
    if (!ok) return titleScreen();
  }
  const rule = await dialog(`<p>パーティが全滅したときの扱いを選んでください。<br>（あとから変更できません）</p>
    <div class="rulebox"><b>本格ルール（コア向け）</b><br>全滅すると遺体は迷宮に残る。別のパーティで回収に行かなければならない。<br>宿屋での回復や魔法の品・薬の値段は、原作寄りの厳しめの設定。</div>
    <div class="rulebox"><b>救済ルール（カジュアル）</b><br>全滅すると町へ運び戻される（所持金は半分に）。死者は聖堂で蘇生。<br>宿屋や品物の値段は安めで、気軽に遊べる。</div>`,
    [{ label: "救済（カジュアル）", value: "easy" }, { label: "本格（コア向け）", value: "classic", cls: "pri" }], { title: "ゲームの難しさ" });
  S = newState(rule);
  S.gold = 0;
  const auto = await dialog(`<p>冒険者は訓練所で自分で作れます。<br>すぐに遊びたい場合は、おすすめの6人を登録します。</p>`,
    [{ label: "自分で作る", value: false }, { label: "おすすめの6人", value: true, cls: "pri" }], { title: "冒険者の登録", small: true });
  if (auto) makeRecommendedParty();
  saveGame(true);
  await tell("鉱山町グレイヴンへようこそ。\n評議会は、奪われた〈星灯〉を取り戻す冒険者を求めている。\nまずは酒場で仲間を集め、坑道の迷宮へ向かおう。" + (auto ? "\n（おすすめの6人はすでに仲間になっています）" : "\n（訓練所で冒険者を作ろう）"));
  return townMain();
}
function makeRecommendedParty() {
  const defs = [
    ["ガルド", "dwarf", "G", "fig", { str: 17, iq: 7, pie: 10, vit: 16, agi: 6, luk: 6 }],
    ["レオン", "human", "G", "fig", { str: 16, iq: 8, pie: 5, vit: 15, agi: 10, luk: 9 }],
    ["ミオ", "hobbit", "N", "thi", { str: 8, iq: 7, pie: 7, vit: 9, agi: 16, luk: 17 }],
    ["セラ", "dwarf", "G", "pri", { str: 12, iq: 7, pie: 16, vit: 13, agi: 5, luk: 6 }],
    ["エリン", "elf", "G", "mag", { str: 7, iq: 17, pie: 10, vit: 8, agi: 10, luk: 6 }],
    ["ノア", "elf", "G", "bis", { str: 7, iq: 14, pie: 15, vit: 8, agi: 9, luk: 6 }],
  ];
  const gear = { fig: ["lsword", "chain", "sshield"], thi: ["ssword", "leather"], pri: ["mace", "leather", "sshield"], mag: ["staff", "robe"], bis: ["staff", "robe"] };
  for (const [n, r, a, cl, st] of defs) {
    const c = makeChar(n, r, a, cl, st);
    for (const id of gear[cl]) { c.items.push({ id, known: true, eq: true }); }
    c.items.push({ id: "potion", known: true, eq: false });
    S.roster.push(c); S.party.push(c.id);
  }
  S.gold = 600;
}

function resumeGame() {
  fixRockPositions();
  if (S.inMaze && S.pos && partyChars().length) return enterMaze(true);
  S.inMaze = false;
  return townMain();
}

/* ────────── 町のメニュー ────────── */
async function townMain() {
  S.inMaze = false; saveGame();
  partyTapHandler = c => charSheet(c, "town");
  Bgm.play("town");
  while (true) {
    showScene("town");
    renderParty();
    const pc = partyChars();
    const hasAble = pc.some(c => c.status === "ok");
    const k = await choose([
      { label: "🍺 酒場", value: "tavern", sub: "仲間の編成" },
      { label: "🛏️ 宿屋", value: "inn", sub: "回復・Lvアップ" },
      { label: "⚖️ 商店", value: "shop", sub: "売買・鑑定" },
      { label: "⛪ 聖堂", value: "temple", sub: "蘇生・治療" },
      { label: "⚔️ 訓練所", value: "train", sub: "作成・転職" },
      { label: "🏛️ 評議会", value: "castle", sub: "報告・記録" },
      { label: "🎒 冒険者", value: "members", sub: "装備・呪文", disabled: !S.roster.length },
      { label: "迷宮へ入る", value: "maze", cls: "pri span2", disabled: !hasAble, sub: hasAble ? "地下1階へ" : "仲間が必要" },
    ], { cols: 3 });
    if (k === "tavern") await tavern();
    else if (k === "inn") await inn();
    else if (k === "shop") await shop();
    else if (k === "temple") await temple();
    else if (k === "train") await training();
    else if (k === "castle") await castle();
    else if (k === "members") await membersView();
    else if (k === "maze") { return startExpedition(); }
  }
}

/* ────────── 酒場 ────────── */
/* テスト用：true の間は、善と悪を同じパーティに入れられる（本番に戻すときは false にする） */
const ALLOW_MIXED_ALIGN = false;
const mixedAlign = list => list.some(c => c.align === "G") && list.some(c => c.align === "E");
function alignConflict(list) { return !ALLOW_MIXED_ALIGN && mixedAlign(list); }
/* 性格が変わって善悪が混ざったパーティから外すと、もう戻せなくなることがある。そのときは確認する */
async function confirmMixedRemove(c) {
  if (ALLOW_MIXED_ALIGN) return true;
  const rest = partyChars().filter(x => x.id !== c.id);
  const opp = c.align === "G" ? "E" : c.align === "E" ? "G" : null;
  if (!opp || !rest.some(x => x.align === opp)) return true;
  return confirmBox(`${c.name}（${ALIGNS[c.align]}）を外すと、${ALIGNS[opp]}の仲間がいるため、もう一度このパーティに加えることはできません。\n外しますか？`, "外す", "やめる");
}
async function tavern() {
  while (true) {
    showScene("tavern");
    renderParty();
    const k = await choose([
      { label: "仲間に加える", value: "add", disabled: S.party.length >= 6 },
      { label: "仲間から外す", value: "rem", disabled: !S.party.length },
      { label: "並び替える", value: "order", disabled: S.party.length < 2 },
      { label: "全員外す", value: "remall", disabled: !S.party.length },
      { label: "名簿を見る", value: "roster" },
    ], { cancel: true, cancelLabel: "町へ戻る" });
    if (!k) return;
    if (k === "add") {
      while (S.party.length < 6) {
        const cand = S.roster.filter(c => !S.party.includes(c.id));
        const items = cand.map(c => ({
          html: `${c.honor ? '<i class="hon">★</i>' : ""}${esc(c.name)} <small>Lv${c.lvl} ${clsLabel(c)}</small>`,
          right: c.where === "lost" ? "迷宮で行方不明" : statusLabel(c) || RACES[c.race].name,
          value: c.id, disabled: c.where === "lost",
        }));
        const id = await listPick("誰を仲間に加える？", items, { empty: "待っている冒険者はいない。訓練所で作成しよう。", right: `${S.party.length}/6人` });
        if (!id) break;
        const c = charById(id);
        if (alignConflict([...partyChars(), c])) { await alertBox("善と悪の者は、同じパーティに入れない！"); continue; }
        S.party.push(id); Snd.play("click"); renderParty(); saveGame();
      }
    } else if (k === "rem") {
      const c = await pickMember("誰を外す？");
      if (c && await confirmMixedRemove(c)) { S.party = S.party.filter(i => i !== c.id); renderParty(); saveGame(); }
    } else if (k === "remall") {
      if (!ALLOW_MIXED_ALIGN && mixedAlign(partyChars()) && !(await confirmBox("善と悪の仲間が混ざっています。全員外すと、善と悪の者は二度と同じパーティに組めなくなります。\n全員外しますか？", "外す", "やめる"))) continue;
      S.party = []; renderParty(); saveGame();
    }
    else if (k === "order") await reorderParty();
    else if (k === "roster") await rosterView();
  }
}
async function reorderParty() {
  const list = partyChars();
  const order = [];
  while (order.length < list.length) {
    const items = list.filter(c => !order.includes(c.id)).map(c => ({ label: c.name, right: `${clsLabel(c)} ${statusLabel(c)}`, value: c.id }));
    const id = await listPick(`${order.length + 1}番目は誰？（前の3人が前列）`, items, { cancelLabel: "やめる" });
    if (!id) return;
    order.push(id);
  }
  S.party = order; renderParty(); saveGame();
}
// 町で冒険者を選んで、装備の変更・呪文・持ち物の整理をする（仲間でない冒険者も選べる）
async function membersView() {
  while (true) {
    const inParty = c => S.party.includes(c.id);
    const list = partyChars().concat(S.roster.filter(c => !inParty(c) && c.where !== "lost"));
    const items = list.map(c => ({ html: `${c.honor ? '<i class="hon">★</i>' : ""}${esc(c.name)} <small>Lv${c.lvl} ${clsLabel(c)}</small>`, right: (inParty(c) ? "仲間 " : "") + statusLabel(c), value: c.id }));
    const id = await listPick("誰の持ち物を見る？", items, { empty: "まだ誰も登録されていない。" });
    if (!id) return;
    await charSheet(charById(id), "town");
    renderParty();
  }
}
async function rosterView() {
  while (true) {
    const items = S.roster.map(c => ({ html: `${c.honor ? '<i class="hon">★</i>' : ""}${esc(c.name)} <small>Lv${c.lvl} ${clsLabel(c)}</small>`, right: (S.party.includes(c.id) ? "仲間 " : "") + (c.where === "lost" ? "行方不明" : statusLabel(c)), value: c.id }));
    const id = await listPick("冒険者名簿", items, { empty: "まだ誰も登録されていない。" });
    if (!id) return;
    const c = charById(id);
    await charSheet(c, c.where === "lost" ? "view" : "town");
  }
}

/* ────────── 宿屋 ────────── */
async function inn() {
  while (true) {
    showScene("inn");
    renderParty();
    const members = partyChars().filter(c => isAlive(c) && c.status !== "stone");
    if (!members.length) { await tell("宿の主人「お泊まりになる方がいないようですな」"); return; }
    const ROOMS = innRooms();
    const k = await choose(ROOMS.map((r, i) => ({ label: r.name, sub: r.d, value: i + 1, disabled: r.cost * members.length > S.gold })), { cancel: true, cancelLabel: "町へ戻る" });
    if (!k) return;
    const r = ROOMS[k - 1];
    S.gold -= r.cost * members.length;
    const msgs = [];
    for (const c of members) {
      if (r.heal) c.hp = Math.min(c.maxhp, c.hp + Math.max(1, Math.ceil(c.maxhp * r.heal)));
      if (c.status === "sleep") c.status = "ok";
      const lv = tryLevelUp(c);
      restoreMP(c);
      if (lv.length) msgs.push(...lv);
      else if (c.exp < nextExp(c)) msgs.push(`${c.name}：次のレベルまで あと${(nextExp(c) - c.exp).toLocaleString()}`);
    }
    renderParty(); saveGame();
    Snd.play(msgs.some(m => m.includes("レベル")) ? "levelup" : "heal");
    await dialog(`<p>${esc(r.name)}で一晩休んだ。</p><ul class="lvlist">${msgs.map(m => `<li class="${m.includes("になった") ? "up" : m.includes("呪文") ? "sp" : ""}">${esc(m)}</li>`).join("")}</ul>`, [{ label: "OK", value: true, cls: "pri" }], { title: "朝になった" });
  }
}

/* ────────── 商店 ────────── */
function shopStock() {
  const list = SHOP_BASE.map(id => ({ id, n: Infinity }));
  for (const id in S.shop) if (S.shop[id] > 0 && !SHOP_BASE.includes(id)) list.push({ id, n: S.shop[id] });
  list.sort((a, b) => ITEMS.indexOf(ITEM[a.id]) - ITEMS.indexOf(ITEM[b.id]));
  return list;
}
const TYPE_NAME = { weapon: "武器", armor: "鎧", shield: "盾", helm: "兜", gloves: "小手", acc: "装飾", use: "道具" };
function itemDetail(d) {
  const a = [];
  if (d.dmg) a.push(`攻撃 ${diceRange(d.dmg)}`); if (d.hit) a.push(`命中${d.hit > 0 ? "+" : ""}${d.hit}`);
  if (d.ac) a.push(`AC${d.ac > 0 ? "-" : "+"}${Math.abs(d.ac)}`);
  if (d.useSpell) a.push(`使うと「${SPELL[d.useSpell].name}」`);
  if (d.regen) a.push("HP自然回復"); if (d.slay) a.push({ dragon: "竜に強い", undead: "不死に強い", demon: "悪魔に強い" }[d.slay]);
  if (d.cursed) a.push("呪い");
  return a.join(" ");
}
/* 持ち物の説明：種類・能力・装備できる職業。未鑑定の品は能力を伏せる（原作どおり） */
function itemInfo(it) {
  const d = ITEM[it.id], parts = [TYPE_NAME[d.t]];
  if (!it.known) { parts.push("未鑑定"); return parts.join(" / "); }
  const det = itemDetail(d); if (det) parts.push(det);
  if (d.t !== "use") parts.push("装備:" + clsMarks(d));
  return parts.join(" / ");
}
/* 一覧の1行：その人が装備できない品には ✕ を付ける */
function itemRowHtml(c, it) {
  const d = ITEM[it.id], ng = c && d.t !== "use" && !canEquip(c, it.id);
  return `${ng ? '<i class="ng">✕</i>' : ""}${it.eq ? "⚔︎ " : ""}${esc(itemName(it))}<br><small>${esc(itemInfo(it))}</small>`;
}
/* 装備画面：今の装備と比べてどう変わるか */
function compareText(c, it) {
  const d = ITEM[it.id];
  if (it.eq || d.t === "use" || !canEquip(c, it.id)) return "";
  const cur = c.items.find(x => x.eq && ITEM[x.id].t === d.t);
  if (!it.known) return "未鑑定";
  if (d.t === "weapon") {
    const avg = str => { const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(str || ""); return m ? m[1] * (+m[2] + 1) / 2 + (+m[3] || 0) : 1.5; };
    const now = cur ? avg(ITEM[cur.id].dmg) : 1.5, next = avg(d.dmg);
    return `攻撃 ${now}→${next}${next > now ? " ↑" : next < now ? " ↓" : ""}`;
  }
  const now = computeAC(c), next = now - (d.ac || 0) + (cur ? (ITEM[cur.id].ac || 0) : 0);
  return `AC ${now}→${next}${next < now ? " ↑" : next > now ? " ↓" : ""}`;
}
function clsMarks(d) { if (d.cls === "*") return "全職業"; return d.cls.split("").map(l => CLASSES[Object.keys(CLASS_LETTER).find(k => CLASS_LETTER[k] === l)].ab).join(""); }
async function shop() {
  while (true) {
    showScene("shop");
    renderParty();
    const k = await choose([
      { label: "買う", value: "buy" }, { label: "売る", value: "sell" },
      { label: "鑑定してもらう", value: "ident" }, { label: "呪いを解く", value: "uncurse" },
    ], { cancel: true, cancelLabel: "町へ戻る" });
    if (!k) return;
    if (!S.party.length) { await tell("「まずはお仲間を連れてきな」（酒場でパーティを編成しよう）"); continue; }
    if (k === "buy") await shopBuy();
    else if (k === "sell") await shopSell();
    else if (k === "ident") await shopIdent();
    else if (k === "uncurse") await shopUncurse();
  }
}
const SHOP_CATS = ["weapon", "shield", "armor", "helm", "gloves", "acc", "use"];
async function shopBuy() {
  let buyer;
  while ((buyer = await pickMember("誰が買う？", c => isAlive(c)))) {
    let cat;
    while (true) {
      const stock = shopStock();
      const cats = SHOP_CATS.map(t => ({ label: TYPE_NAME[t] === "装飾" ? "装飾品" : TYPE_NAME[t], right: `${stock.filter(s => ITEM[s.id].t === t).length}品`, value: t, disabled: !stock.some(s => ITEM[s.id].t === t) }));
      cat = await listPick(`${buyer.name}の買い物`, cats, { right: `所持金 ${S.gold.toLocaleString()}G` });
      if (!cat) break;
      await shopBuyCat(buyer, cat);
    }
  }
}
async function shopBuyCat(buyer, cat) {
  while (true) {
    const items = shopStock().filter(s => ITEM[s.id].t === cat).map(s => {
      const d = ITEM[s.id]; const ok = d.t === "use" || canEquip(buyer, s.id);
      return { html: `${ok ? "" : '<i class="ng">✕</i>'}${esc(d.name)} <small>${TYPE_NAME[d.t]} ${esc(itemDetail(d))}${d.t !== "use" ? " / " + clsMarks(d) : ""}</small>`,
        right: `${priceOf(s.id).toLocaleString()}G${s.n !== Infinity ? ` (${s.n})` : ""}`, value: s.id, disabled: priceOf(s.id) > S.gold };
    });
    const id = await listPick(`${buyer.name}の買い物（${TYPE_NAME[cat] === "装飾" ? "装飾品" : TYPE_NAME[cat]}）`, items, { right: `所持金 ${S.gold.toLocaleString()}G`, note: `持ち物 ${buyer.items.length}/8`, empty: "品切れだ。" });
    if (!id) return;
    const d = ITEM[id];
    if (buyer.items.length >= 8) { await alertBox("これ以上持てない！"); continue; }
    if (d.t !== "use" && !canEquip(buyer, id) && !(await confirmBox(`${buyer.name}には装備できません。それでも買いますか？`))) continue;
    S.gold -= priceOf(id);
    if (!SHOP_BASE.includes(id)) S.shop[id]--;
    addItem(buyer, id, true);
    Snd.play("buy"); renderParty(); saveGame();
    if (d.t !== "use" && canEquip(buyer, id) && await confirmBox(`${d.name}を買った。\nすぐに装備する？`, "装備する", "あとで")) {
      await equipItem(buyer, buyer.items.length - 1);
    }
  }
}
async function shopSell() {
  let who;
  while ((who = await pickMember("誰の持ち物を売る？"))) await shopSellOf(who);
}
async function shopSellOf(who) {
  while (true) {
    const items = who.items.map((it, i) => {
      const d = ITEM[it.id];
      const p = it.known ? Math.floor(priceOf(it.id) / 2) : 1;
      return { html: itemRowHtml(who, it), right: `${p.toLocaleString()}G`, value: i + 1, disabled: it.eq && d.cursed };
    });
    const i = await listPick(`${who.name}の持ち物を売る`, items, { empty: "持ち物がない。" });
    if (!i) return;
    const it = who.items[i - 1], d = ITEM[it.id];
    const p = it.known ? Math.floor(priceOf(it.id) / 2) : 1;
    if (!(await confirmBox(`${itemName(it)}を${p}Gで売る？`))) continue;
    who.items.splice(i - 1, 1);
    S.gold += p;
    if (!SHOP_BASE.includes(it.id)) S.shop[it.id] = (S.shop[it.id] || 0) + 1;
    Snd.play("buy"); renderParty(); saveGame();
  }
}
async function shopIdent() {
  let who;
  while ((who = await pickMember("誰の持ち物を鑑定する？"))) await shopIdentOf(who);
}
async function shopIdentOf(who) {
  while (true) {
    const items = who.items.map((it, i) => ({ html: itemRowHtml(who, it), right: it.known ? "鑑定済" : `${Math.floor(priceOf(it.id) / 2).toLocaleString()}G`, value: i + 1, disabled: it.known || Math.floor(priceOf(it.id) / 2) > S.gold }));
    const i = await listPick("鑑定する品を選ぶ", items, { right: `所持金 ${S.gold.toLocaleString()}G`, empty: "持ち物がない。" });
    if (!i) return;
    const it = who.items[i - 1];
    S.gold -= Math.floor(priceOf(it.id) / 2);
    it.known = true;
    Snd.play("sparkle"); renderParty(); saveGame();
    await alertBox(`「こいつは${ITEM[it.id].name}だな」\n${itemInfo(it)}`);
  }
}
async function shopUncurse() {
  let who;
  while ((who = await pickMember("誰の呪いを解く？"))) await shopUncurseOf(who);
}
async function shopUncurseOf(who) {
  const cur = who.items.map((it, i) => ({ it, i })).filter(o => o.it.eq && ITEM[o.it.id].cursed);
  if (!cur.length) { await alertBox("「呪われた品は身につけていないようだ」"); return; }
  const items = cur.map(o => ({ label: ITEM[o.it.id].name, right: `${Math.floor(priceOf(o.it.id) / 2)}G`, value: o.i + 1, disabled: Math.floor(priceOf(o.it.id) / 2) > S.gold }));
  const i = await listPick("呪いを解く品（品物は失われる）", items);
  if (!i) return;
  const it = who.items[i - 1];
  S.gold -= Math.floor(priceOf(it.id) / 2);
  who.items.splice(i - 1, 1);
  Snd.play("sparkle"); renderParty(); saveGame();
  await alertBox(`呪いは解けた。${ITEM[it.id].name}は崩れ落ちた。`);
}

/* ────────── 聖堂 ────────── */
function templeFee(c) {
  return { para: 100, stone: 200, dead: 250, ash: 500 }[c.status] * c.lvl;
}
async function temple() {
  while (true) {
    showScene("temple");
    renderParty();
    const needy = S.roster.filter(c => ["para", "stone", "dead", "ash"].includes(c.status) && c.where !== "lost");
    const items = needy.map(c => ({ html: `${esc(c.name)} <small>Lv${c.lvl} ${clsLabel(c)}</small>`, right: `${STATUS_NAME[c.status]} ${templeFee(c).toLocaleString()}G`, value: c.id, disabled: templeFee(c) > S.gold }));
    const id = await listPick("寄付をして治療を受ける", items, { right: `所持金 ${S.gold.toLocaleString()}G`, empty: "治療が必要な者はいない。", cancelLabel: "町へ戻る" });
    if (!id) return;
    const c = charById(id); const fee = templeFee(c);
    if (!(await confirmBox(`${c.name}の治療に${fee.toLocaleString()}Gを寄付しますか？`))) continue;
    S.gold -= fee;
    let msg;
    if (c.status === "para" || c.status === "stone") {
      await tell("僧侶たちが祈りを捧げている……");
      c.status = "ok"; msg = `${c.name}は治った！`; Snd.play("heal");
    } else {
      const ash = c.status === "ash";
      const p = clamp(45 + c.st.vit * 3 - (ash ? 15 : 0), 40, 95) / 100;
      let result;
      if (chance(p)) { c.status = "ok"; c.hp = ash ? c.maxhp : 1; c.st.vit = Math.max(3, c.st.vit - 1); result = "ok"; msg = `${c.name}は生き返った！`; }
      else if (ash) { c.status = "lost"; result = "lost"; msg = `${c.name}は……永遠に失われた。`; }
      else { c.status = "ash"; result = "ash"; msg = `${c.name}は灰になってしまった……`; }
      clearMsg(); $("cmd").innerHTML = "";
      await ritual(c.name, result);
    }
    if (c.status === "lost") { S.roster = S.roster.filter(x => x.id !== c.id); S.party = S.party.filter(i => i !== c.id); }
    renderParty(); saveGame();
    await alertBox(msg);
  }
}

/* ────────── 訓練所 ────────── */
async function training() {
  while (true) {
    showScene("train");
    renderParty();
    const k = await choose([
      { label: "冒険者を作る", value: "make", cls: "pri", disabled: S.roster.length >= 20 },
      { label: "転職する", value: "change" },
      { label: "名前を変える", value: "rename" },
      { label: "登録を消す", value: "del" },
    ], { cancel: true, cancelLabel: "町へ戻る" });
    if (!k) return;
    if (k === "make") await createChar();
    else if (k === "change") await classChange();
    else if (k === "rename") {
      const c = await pickFromRoster("誰の名前を変える？");
      if (c) { const n = await inputName(c.name); if (n) { c.name = n; renderParty(); saveGame(); } }
    } else if (k === "del") {
      const c = await pickFromRoster("誰の登録を消す？", c => !S.party.includes(c.id));
      if (c && await confirmBox(`${c.name}の登録を消します。\n持ち物もすべて失われます。よろしいですか？`, "消す", "やめる")) {
        S.roster = S.roster.filter(x => x.id !== c.id); saveGame();
      }
    }
  }
}
function pickFromRoster(title, filter) {
  const items = S.roster.map(c => ({ html: `${esc(c.name)} <small>Lv${c.lvl} ${clsLabel(c)}</small>`, right: S.party.includes(c.id) ? "仲間" : (c.where === "lost" ? "行方不明" : ""), value: c.id, disabled: (filter && !filter(c)) || c.where === "lost" }));
  return listPick(title, items, { empty: "登録されている冒険者はいない。" }).then(id => id ? charById(id) : null);
}
function inputName(def) {
  return dialog(`<p>名前を入力（8文字まで）</p><input id="nameIn" maxlength="8" value="${esc(def || "")}" autocomplete="off">`,
    [{ label: "やめる", value: null }, { label: "決定", cls: "pri", value: body => {
      const v = body.querySelector("#nameIn").value.trim();
      if (!v) return false;
      if (S.roster.some(c => c.name === v && c.name !== def)) { body.querySelector("p").textContent = "その名前はもう使われている。"; return false; }
      return v;
    } }], { small: true, title: "名前", onOpen: b => setTimeout(() => b.querySelector("#nameIn").focus(), 50) });
}
function rollBonus() {
  const r = Math.random();
  if (r < 0.7) return rr(5, 9);
  if (r < 0.9) return rr(10, 14);
  if (r < 0.98) return rr(15, 19);
  return rr(20, 29);
}
function eligibleClasses(st, align) {
  return CLASS_ORDER.filter(k => {
    const c = CLASSES[k];
    if (!c.align.includes(align)) return false;
    for (const s in c.req) if (st[s] < c.req[s]) return false;
    return true;
  });
}
async function createChar() {
  const name = await inputName("");
  if (!name) return;
  const race = await listPick("種族を選ぶ", Object.keys(RACES).map(k => {
    const b = RACES[k].base;
    return { html: `<b>${RACES[k].name}</b>`, rhtml: `<small>力${b.str} 知${b.iq} 信${b.pie} 生${b.vit} 素${b.agi} 運${b.luk}</small>`, value: k };
  }));
  if (!race) return;
  const align = await listPick("性格を選ぶ", [
    { html: "<b>善</b> <small>僧侶・司教・侍・君主になれる</small>", value: "G" },
    { html: "<b>中立</b> <small>盗賊・侍になれる</small>", value: "N" },
    { html: "<b>悪</b> <small>僧侶・盗賊・司教・忍者になれる</small>", value: "E" },
  ]);
  if (!align) return;
  // ボーナスポイントの割り振り
  const base = RACES[race].base;
  let bonus = rollBonus(), left = bonus;
  const st = { ...base };
  const res = await dialog(`<div id="bpBox"></div>`, [
    { label: "やめる", value: null },
    { label: "振り直す", value: body => { bonus = rollBonus(); left = bonus; Object.assign(st, base); draw(body); Snd.play("move"); return false; } },
    { label: "決定", cls: "pri", value: body => {
      const el = eligibleClasses(st, align);
      if (!el.length) { body.querySelector(".bpwarn").textContent = "なれる職業がまだない。ポイントを割り振ろう。"; return false; }
      return true;
    } },
  ], { title: `${name}（${RACES[race].name}・${ALIGNS[align]}）`, onOpen: b => draw(b) });
  function draw(body) {
    const el = eligibleClasses(st, align);
    body.querySelector("#bpBox").innerHTML =
      `<div class="bpleft">ボーナス <b>${left}</b> / ${bonus}${bonus >= 15 ? ' <span class="lucky">大当たり！</span>' : ""}</div>` +
      STATS.map(k => `<div class="bprow"><span>${STAT_NAMES[k]}</span><button data-k="${k}" data-d="-1">－</button><b>${st[k]}</b><button data-k="${k}" data-d="1">＋</button></div>`).join("") +
      `<div class="bpcls">${CLASS_ORDER.map(k => `<span class="${el.includes(k) ? "ok" : ""}">${CLASSES[k].name}</span>`).join("")}</div><div class="bpwarn"></div>`;
    body.querySelectorAll(".bprow button").forEach(b => b.onclick = () => {
      const k = b.dataset.k, d = +b.dataset.d;
      if (d > 0 && (left <= 0 || st[k] >= 18)) return;
      if (d < 0 && st[k] <= base[k]) return;
      st[k] += d; left -= d; Snd.play("move"); draw(body);
    });
  }
  if (!res) return;
  const el = eligibleClasses(st, align);
  const cls = await listPick("職業を選ぶ", el.map(k => ({ html: `<b>${CLASSES[k].name}</b><br><small>${CLASSES[k].desc}</small>`, value: k })), { note: left ? `※ 残りのボーナス${left}点は失われる。` : "" });
  if (!cls) return;
  const c = makeChar(name, race, align, cls, st);
  S.roster.push(c);
  const g = rr(90, 190); S.gold += g;
  saveGame(); renderParty(); Snd.play("levelup");
  await alertBox(`${name}（${clsLabel(c)}）が冒険者として登録された！\nHP ${c.maxhp}${c.known.length ? "\n呪文：" + c.known.map(s => SPELL[s].name).join("、") : ""}\n（支度金 ${g}G を受け取った）`);
  if (S.party.length < 6 && !alignConflict([...partyChars(), c]) && await confirmBox(`${name}をすぐに仲間に加えますか？`)) { S.party.push(c.id); renderParty(); saveGame(); }
}
async function classChange() {
  const c = await pickFromRoster("誰が転職する？");
  if (!c) return;
  const el = eligibleClasses(c.st, c.align).filter(k => k !== c.cls);
  if (!el.length) { await alertBox(`${c.name}がなれる職業はない。\n（能力値か性格が条件を満たしていない）`); return; }
  const cls = await listPick(`${c.name}の新しい職業`, el.map(k => ({ html: `<b>${CLASSES[k].name}</b><br><small>${CLASSES[k].desc}</small>`, value: k })),
    { note: "転職するとレベル1・種族の初期能力値に戻る。" });
  if (!cls) return;
  if (!(await confirmBox(`${c.name}を${CLASSES[cls].name}に転職させますか？`))) return;
  c.keepM = maxSlots(c, "M"); c.keepP = maxSlots(c, "P");
  c.cls = cls; c.lvl = 1; c.exp = 0; c.st = { ...RACES[c.race].base };
  c.items.forEach(it => { if (!(it.eq && ITEM[it.id].cursed)) it.eq = false; });
  c.age += 3;
  learnSpells(c); restoreMP(c);
  saveGame(); renderParty(); Snd.play("levelup");
  await alertBox(`${c.name}は${CLASSES[cls].name}になった！`);
}

/* ────────── 評議会 ────────── */
async function castle() {
  showScene("castle");
  const keys = Object.keys(S.keys).filter(k => S.keys[k]).map(k => KEYITEMS[k].name);
  const played = Math.floor((Date.now() - S.stats.startedAt) / 60000);
  const msg = S.cleared
    ? "議長「封印は結び直された。君たちはグレイヴンの恩人だ。坑道にはまだ魔物が残っている。存分に腕を磨くといい」"
    : S.deepest >= 5 ? "議長「地下深くまで進んだそうだな。モルヴァンは最深部の封印の間にいるはずだ。封印の扉は、三つの欠片がそろえば開くと伝わっている」"
    : "議長「星灯を奪ったのは、かつて封印の守り人だった灰の司祭モルヴァンだ。奴は地下十階の封印の間で、星喰いを目覚めさせようとしている。どうか星灯を取り戻し、祭壇へ戻してくれ」";
  await dialog(`<p class="king">${esc(msg)}</p>
    <h4>大事なもの</h4><p>${keys.length ? keys.map(esc).join("、") : "なし"}</p>
    <h4>冒険の記録</h4><p>最深到達：${S.deepest ? "地下" + S.deepest + "階" : "―"}<br>戦闘回数：${S.stats.battles}　倒した怪物：${S.stats.kills}<br>死者：${S.stats.deaths}人　歩数：${S.stats.steps}<br>難しさ：${S.rule === "classic" ? "本格（コア向け）" : "救済（カジュアル）"}　プレイ時間：約${played}分</p>
    <h4>メッセージ速度</h4><div class="spd">${[0.6, 1, 1.6, 2.5].map(v => `<button data-v="${v}" class="${S.speed === v ? "pri" : ""}">${{ 0.6: "ゆっくり", 1: "ふつう", 1.6: "はやい", 2.5: "最速" }[v]}</button>`).join("")}</div>
    <h4>BGM</h4><div class="spd"><button data-bgm="1" class="${!S.bgmOff ? "pri" : ""}">オン</button><button data-bgm="0" class="${S.bgmOff ? "pri" : ""}">オフ</button></div>${fontOptHtml()}${walkOptHtml()}${spellDescOptHtml()}`,
    [{ label: "もどる", value: true, cls: "pri" }], { title: "評議会", onOpen: b => b.querySelectorAll(".spd button").forEach(bt => bt.onclick = () => {
      if (fontOptClick(bt, b) || walkOptClick(bt, b) || spellDescOptClick(bt, b)) return;
      if (bt.dataset.bgm) { S.bgmOff = bt.dataset.bgm === "0"; saveGame(); Bgm.sync(); b.querySelectorAll("[data-bgm]").forEach(x => x.classList.toggle("pri", x === bt)); Snd.play("click"); return; } S.speed = +bt.dataset.v; saveGame(); b.querySelectorAll(".spd button[data-v]").forEach(x => x.classList.toggle("pri", x === bt)); Snd.play("click"); }) });
}
/* 最深部で星灯を取り戻した直後に呼ばれる */
async function ending() {
  S.cleared = true;
  for (const c of partyChars()) if (isAlive(c)) c.honor = 1;
  saveGame(true);
  Snd.play("win");
  const sc = $("scene");
  sc.className = "on title";
  setSceneBg("ending");
  sc.innerHTML = `<div class="ttl"><div class="t1">✨</div><div class="t2">封印は結び直された</div></div>`;
  await tell("パーティは星灯を祭壇に掲げた。\n青白い光が封印の間を満たし、地の底の鼓動が静まっていく……。");
  await tell("十層の封印は、ふたたび結び直された。");
  await tell("町へ戻ると、評議会の議長が待っていた。\n「よくやってくれた！ 君たちはグレイヴンの恩人だ」");
  await tell("生き残った冒険者たちは『封印の守り手』の称号（★）を授けられた。\nその名は、永く町で語り継がれるだろう。");
  const names = partyChars().map(c => `${c.name}（Lv${c.lvl} ${CLASSES[c.cls].name}）`).join("<br>");
  const played = Math.floor((Date.now() - S.stats.startedAt) / 60000);
  await dialog(`<div class="end"><p class="big">🏆 CONGRATULATIONS 🏆</p><p>${names}</p><p>戦闘 ${S.stats.battles}回 / 倒した怪物 ${S.stats.kills}体<br>死者 ${S.stats.deaths}人 / 歩数 ${S.stats.steps}<br>プレイ時間 約${played}分</p><p class="thx">― 遊んでくれてありがとう ―<br><small>このあとも冒険を続けられます。</small></p></div>`,
    [{ label: "町へ", value: true, cls: "pri" }], { title: "エンディング" });
}

/* ────────── キャラクター画面（町・キャンプ共通） ────────── */
async function charSheet(c, ctx) {
  if (!c) return;
  while (true) {
    sortItems(c);
    const ci = clsInfo(c);
    const mx = { M: maxSlots(c, "M"), P: maxSlots(c, "P") };
    const slotStr = sc => { const cur = sc === "M" ? c.mpM : c.mpP; return mx[sc].some(v => v) ? mx[sc].map((v, i) => `${cur[i] || 0}`).join("/") : "―"; };
    const itemsHtml = c.items.length ? c.items.map((it, i) => {
      const d = ITEM[it.id];
      return `<div class="itm${it.eq ? " eq" : ""}${it.known && d.cursed && it.eq ? " cur" : ""}" data-i="${i}"><span>${d.t !== "use" && !canEquip(c, it.id) ? '<i class="ng">✕</i>' : ""}${it.eq ? "⚔︎ " : ""}${esc(itemName(it))}</span><small>${esc(itemInfo(it))}</small></div>`;
    }).join("") : `<div class="empty">持ち物なし</div>`;
    const spellsHtml = c.known.length ? ["M", "P"].map(sc => {
      const ks = SPELLS.filter(s => s.sc === sc && c.known.includes(s.id));
      if (!ks.length) return "";
      return `<div class="spl"><b>${sc === "M" ? "魔術" : "僧侶"}</b> ${ks.map(s => `<span title="${esc(s.desc)}">${s.lv}:${s.name}</span>`).join(" ")}</div>`;
    }).join("") : "";
    const inMaze = ctx === "camp";
    const acts = [];
    if (ctx !== "view" && c.items.length) { acts.push({ label: "装備", value: "equip" }); acts.push({ label: "使う", value: "use" }); acts.push({ label: "渡す", value: "give" }); acts.push({ label: "捨てる", value: "drop" }); }
    if (ctx !== "view" && ci.identify && c.items.some(i => !i.known)) acts.push({ label: "鑑定", value: "ident" });
    if ((inMaze || ctx === "town") && c.known.some(s => castableHere(SPELL[s]))) acts.push({ label: "呪文", value: "spell", cls: "pri" });
    acts.push({ label: "とじる", value: null });
    const ageStr = c.age ? `${c.age}歳` : "";
    const html = `<div class="cs">
      <div class="cshead"><div><b class="nm">${c.honor ? '<i class="hon">★</i>' : ""}${esc(c.name)}</b><span>${ALIGNS[c.align]}・${RACES[c.race].name}・${ci.name}　${ageStr}</span></div><div class="lv">Lv<b>${c.lvl}</b></div></div>
      <div class="csgrid">
        <div>HP <b>${c.hp}</b>/${c.maxhp}</div><div>AC <b>${computeAC(c)}</b></div><div>状態 <b>${statusLabel(c) || "正常"}</b></div>
        <div class="w2">経験値 ${c.exp.toLocaleString()}<br><small>${c.exp >= nextExp(c) ? '<b style="color:#fcd34d">宿屋で休むとレベルアップ！</b>' : "次のLvまで " + (nextExp(c) - c.exp).toLocaleString()}</small></div><div>攻撃回数 ${swings(c)}</div>
      </div>
      <div class="csst">${STATS.map(k => `<div><small>${STAT_NAMES[k]}</small><b>${c.st[k]}</b></div>`).join("")}</div>
      <div class="csmp">魔術 ${slotStr("M")}<br>僧侶 ${slotStr("P")}</div>
      ${spellsHtml}
      <div class="csit"><div class="csh">持ち物 ${c.items.length}/8</div>${itemsHtml}</div>
      <div class="csdesc">${esc(ci.desc)}</div>
    </div>`;
    const a = await dialog(html, acts, { title: "キャラクター" });
    if (!a) return;
    if (a === "equip") await equipMenu(c);
    else if (a === "use") await useMenu(c, ctx);
    else if (a === "give") await giveMenu(c);
    else if (a === "drop") await dropMenu(c);
    else if (a === "ident") await bishopIdent(c);
    else if (a === "spell") await campCast(c);
    renderParty(); saveGame();
  }
}
async function equipItem(c, i) {
  const it = c.items[i], d = ITEM[it.id];
  if (!canEquip(c, it.id)) { await alertBox(`${c.name}には装備できない。`); return false; }
  if (it.eq) {
    if (d.cursed) { it.known = true; await alertBox("呪われていて外せない！\n（商店で呪いを解いてもらおう）"); return false; }
    it.eq = false; return true;
  }
  const cur = c.items.find(x => x.eq && ITEM[x.id].t === d.t);
  if (cur) {
    if (ITEM[cur.id].cursed) { cur.known = true; await alertBox(`${itemName(cur)}が呪われていて外せない！`); return false; }
    cur.eq = false;
  }
  it.eq = true;
  if (d.cursed) { it.known = true; Snd.play("trap"); await alertBox(`しまった！ ${d.name}は呪われている！\n外すことができない……`); }
  else Snd.play("click");
  return true;
}
async function equipMenu(c) {
  while (true) {
    sortItems(c);
    const items = c.items.map((it, i) => ({ html: itemRowHtml(c, it), right: it.eq ? "装備中" : compareText(c, it), value: i + 1, disabled: ITEM[it.id].t === "use" || !canEquip(c, it.id) }));
    const i = await listPick(`${c.name}の装備（タップで付け外し）`, items, { right: `AC ${computeAC(c)}` });
    if (!i) return;
    await equipItem(c, i - 1);
    renderParty();
  }
}
async function dropMenu(c) {
  const items = c.items.map((it, i) => ({ html: itemRowHtml(c, it), right: it.eq ? "装備中" : "", value: i + 1, disabled: it.eq && ITEM[it.id].cursed }));
  const i = await listPick("何を捨てる？", items);
  if (!i) return;
  if (await confirmBox(`${itemName(c.items[i - 1])}を捨てますか？`)) c.items.splice(i - 1, 1);
}
// 渡す：渡す相手の一覧に、それぞれの持ち物も並べる。渡したあとも続けて渡せる
async function giveMenu(c) {
  while (c.items.length) {
    sortItems(c);
    const items = c.items.map((it, i) => ({ html: itemRowHtml(c, it), right: it.eq ? "装備中" : "", value: i + 1, disabled: it.eq && ITEM[it.id].cursed }));
    const i = await listPick(`${c.name}の持ち物 ${c.items.length}/8　何を渡す？`, items);
    if (!i) return;
    const it0 = c.items[i - 1];
    const rows = partyChars().filter(x => x.id !== c.id).map(x => {
      sortItems(x);
      const ng = it0.known && ITEM[it0.id].t !== "use" && !canEquip(x, it0.id);
      const inv = x.items.length ? x.items.map(v => (v.eq ? "⚔︎" : "") + esc(itemName(v))).join("・") : "持ち物なし";
      return { html: `${ng ? '<i class="ng">✕</i>' : ""}<b>${esc(x.name)}</b> <small>${clsLabel(x)}</small><div class="gvl">${inv}</div>`,
        right: `${x.items.length}/8`, value: x.id, disabled: x.items.length >= 8 };
    });
    const toId = await listPick(`「${itemName(it0)}」を誰に渡す？`, rows);
    if (!toId) continue;
    const to = charById(toId);
    const [it] = c.items.splice(i - 1, 1); it.eq = false; to.items.push(it);
    Snd.play("click"); renderParty(); saveGame();
  }
}
const identRate = c => clamp(15 + c.lvl * 5 + (c.st.iq - 10) * 2, 10, 95);
async function bishopIdent(c) {
  const items = c.items.map((it, i) => ({ html: itemRowHtml(c, it), right: it.known ? "鑑定済" : "", value: i + 1, disabled: it.known }));
  const i = await listPick(`${c.name}が鑑定する`, items, { note: `成功率 約${identRate(c)}%` });
  if (!i) return;
  await identOne(c, c, i - 1);
}
/* 鑑定の本体。idr＝鑑定する人、owner＝品を持っている人。失敗すると、呪いの品は持ち主が身につけてしまうことがある */
async function identOne(idr, owner, idx) {
  const it = owner.items[idx], d = ITEM[it.id];
  if (chance(identRate(idr) / 100)) {
    it.known = true; Snd.play("sparkle");
    await alertBox(`鑑定に成功した！\nそれは「${d.name}」だった。\n${itemInfo(it)}`);
    idr.exp += 20 * (d.tier + 1);
  } else if (d.cursed && canEquip(owner, it.id) && chance(0.35)) {
    const cur = owner.items.find(x => x.eq && ITEM[x.id].t === d.t && !ITEM[x.id].cursed); if (cur) cur.eq = false;
    it.eq = true; it.known = true; Snd.play("trap");
    await alertBox(`鑑定に失敗した！\n${owner.name}は${d.name}の呪いに取り憑かれ、身につけてしまった！`);
  } else { Snd.play("cancel"); await alertBox("鑑定に失敗した。"); }
  renderParty(); saveGame();
}
/* キャンプの「鑑定」：鑑定できる仲間（並びの上の人が優先）が、パーティ全員の未鑑定の品をまとめて鑑定する */
const partyIdentifier = () => partyChars().find(c => CLASSES[c.cls].identify && c.status === "ok");
const canPartyIdent = () => !!partyIdentifier() && partyChars().some(c => c.items.some(it => !it.known));
async function partyIdent() {
  const idr = partyIdentifier(); if (!idr) return;
  while (true) {
    const rows = [];
    for (const o of partyChars()) o.items.forEach((it, i) => { if (!it.known) rows.push({ html: `<small>${esc(o.name)}</small> ${itemRowHtml(o, it)}`, value: `${o.id}:${i}` }); });
    const v = await listPick(`${idr.name}が鑑定する`, rows, { note: `成功率 約${identRate(idr)}%`, empty: "鑑定していない品はない。" });
    if (!v) return;
    const [oid, i] = v.split(":");
    await identOne(idr, charById(+oid), +i);
  }
}
async function useMenu(c, ctx) {
  const items = c.items.map((it, i) => ({ html: itemRowHtml(c, it), right: ITEM[it.id].useSpell && it.known ? SPELL[ITEM[it.id].useSpell].name : "", value: i + 1, disabled: !ITEM[it.id].useSpell }));
  const i = await listPick("何を使う？", items);
  if (!i) return;
  const it = c.items[i - 1], d = ITEM[it.id], sp = SPELL[d.useSpell];
  if (ctx === "town" && !["heal", "cure", "fullheal"].includes(sp.eff)) { await alertBox("町の中では使えない。"); return; }
  if (!sp.use.includes("c") && ctx !== "battle") { await alertBox("今は使えない。（戦闘中に使う品だ）"); return; }
  it.known = true;
  const ok = await castOutside(c, sp, it.id);
  if (ok) {
    if (d.consume) c.items.splice(c.items.indexOf(it), 1);
    else if (d.brk && chance(d.brk)) { c.items.splice(c.items.indexOf(it), 1); await alertBox(`${d.name}は砕け散った。`); }
  }
}
