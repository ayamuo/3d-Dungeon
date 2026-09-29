/* 星灯の迷宮 — ゲームデータ（種族・職業・呪文・アイテム・モンスター・迷宮構成）
   ブラウザでは window に、Node(テスト)では module.exports に公開する。 */
"use strict";
(function (G) {

const STATS = ["str", "iq", "pie", "vit", "agi", "luk"];
const STAT_NAMES = { str: "力", iq: "知恵", pie: "信仰心", vit: "生命力", agi: "素早さ", luk: "運の強さ" };

const RACES = {
  human:  { name: "人間",     base: { str: 8, iq: 8,  pie: 7,  vit: 8,  agi: 8,  luk: 8 } },
  elf:    { name: "エルフ",   base: { str: 6, iq: 11, pie: 9,  vit: 6,  agi: 9,  luk: 7 } },
  dwarf:  { name: "ドワーフ", base: { str: 11, iq: 6, pie: 9,  vit: 11, agi: 5,  luk: 6 } },
  gnome:  { name: "ノーム",   base: { str: 7, iq: 8,  pie: 11, vit: 7,  agi: 9,  luk: 7 } },
  hobbit: { name: "ホビット", base: { str: 5, iq: 7,  pie: 7,  vit: 7,  agi: 11, luk: 13 } },
};

const ALIGNS = { G: "善", N: "中立", E: "悪" };

/* mage/priest: 呪文を覚え始めるレベル(start)と、次の呪文レベルまでの間隔(step)。full=本職(呪文の回数が増えやすい) */
const CLASSES = {
  fig: { name: "戦士",   ab: "戦", hd: 10, req: { str: 11 }, align: "GNE", swing: true, hit: 1.0,
         desc: "最も頑丈な前衛。重い鎧と武器を使いこなし、レベルが上がると攻撃回数が増える。" },
  mag: { name: "魔術師", ab: "魔", hd: 4, req: { iq: 11 }, align: "GNE", hit: 0.4,
         mage: { start: 1, step: 2, full: true },
         desc: "攻撃呪文の使い手。打たれ弱いので後列に置く。" },
  pri: { name: "僧侶",   ab: "僧", hd: 8, req: { pie: 11 }, align: "GE", hit: 0.6, dispel: true,
         priest: { start: 1, step: 2, full: true },
         desc: "回復と補助の呪文を使う。不死の怪物を退散（ディスペル）させられる。" },
  thi: { name: "盗賊",   ab: "盗", hd: 6, req: { agi: 11 }, align: "NE", hit: 0.6, thief: 1,
         desc: "宝箱の罠を調べ、外すことができる。気配に敏く、仲間にいると敵の不意打ちを受けにくく、逆に先手を取りやすい。" },
  bis: { name: "司教",   ab: "司", hd: 6, req: { iq: 12, pie: 12 }, align: "GE", hit: 0.5, dispel: true, identify: true,
         mage: { start: 1, step: 3 }, priest: { start: 4, step: 3 },
         desc: "魔術と僧侶の両方の呪文を覚える。拾ったアイテムを鑑定できる。成長は遅い。" },
  sam: { name: "侍",     ab: "侍", hd: 10, req: { str: 14, iq: 12, pie: 9, vit: 13, agi: 12 }, align: "GN", swing: true, hit: 1.0, crit: 0.8,
         mage: { start: 4, step: 3 }, bonusHp: 4,
         desc: "戦士並みの剣技に加え、魔術師の呪文も覚える上級職。妖刀・朧月を扱える唯一の職業。" },
  lor: { name: "君主",   ab: "君", hd: 10, req: { str: 14, iq: 11, pie: 14, vit: 14, agi: 12, luk: 13 }, align: "G", swing: true, hit: 1.0, dispel: true,
         priest: { start: 4, step: 3 },
         desc: "戦士の強さと僧侶の呪文を併せ持つ、善の上級職。" },
  nin: { name: "忍者",   ab: "忍", hd: 8, req: { str: 15, iq: 14, pie: 12, vit: 14, agi: 17, luk: 15 }, align: "E", swing: true, hit: 1.0, crit: 1.6, thief: 0.8, ninja: true,
         desc: "一撃で首をはねる技を持つ悪の上級職。素手・裸でも強く、罠外しもこなす。" },
};
const CLASS_ORDER = ["fig", "mag", "pri", "thi", "bis", "sam", "lor", "nin"];
const CLASS_LETTER = { fig: "F", mag: "M", pri: "P", thi: "T", bis: "B", sam: "S", lor: "L", nin: "N" };

/* 次のレベルに必要な経験値の職業係数 */
const EXP_RATE = { thi: 0.85, fig: 1.0, pri: 1.05, mag: 1.1, bis: 1.25, sam: 1.3, lor: 1.4, nin: 1.5 };
function expForLevel(cls, lvl) { // lvl に到達するのに必要な累計経験値
  if (lvl <= 1) return 0;
  const r = EXP_RATE[cls] || 1;
  let e;
  if (lvl <= 13) e = 300 * Math.pow(1.58, lvl - 2);
  else e = 300 * Math.pow(1.58, 11) + (lvl - 13) * 30000; // Lv13以降は一定の増え方（急に重くなって地下6〜8階で伸び悩まないよう、手前の伸びに合わせている）
  return Math.round(e * r);
}

/* ────────── 呪文 ──────────
   tgt: enemy1=敵1体 / group=敵1グループ / all=敵全体 / ally=味方1人 / party=味方全員 / self=自分 / none
   use: b=戦闘中, c=キャンプ中(迷宮) */
const SPELLS = [
  // 魔術師系
  { id: "harita",  name: "火の矢",     sc: "M", lv: 1, tgt: "enemy1", use: "b",  eff: "dmg", dice: "1d8", elem: "fire", desc: "炎の矢を放つ。敵1体に1〜8ダメージ。" },
  { id: "katina",  name: "眠りの雲",   sc: "M", lv: 1, tgt: "group",  use: "b",  eff: "sleep", desc: "敵1グループを眠らせる。眠った敵は攻撃を受けやすい。" },
  { id: "dumapia", name: "透視", sc: "M", lv: 1, tgt: "none",   use: "c",  eff: "reveal", desc: "自分のまわり3×3マスの地形と罠（落とし穴・落とし戸・転移床・回転床）を地図に書き込む。暗闇のマスも書き込めるが、画面の暗闇は晴れない。" },
  { id: "mogria",  name: "魔法の鎧",   sc: "M", lv: 1, tgt: "self",   use: "b",  eff: "ac", val: 2, desc: "戦闘中、自分のACを2下げる。" },
  { id: "dilta",   name: "暗闇",   sc: "M", lv: 2, tgt: "group",  use: "b",  eff: "eac", val: 2, desc: "敵1グループを闇で包み、ACを2上げる（攻撃が当たりやすくなる）。" },
  { id: "sopica",  name: "幻影",     sc: "M", lv: 2, tgt: "self",   use: "b",  eff: "ac", val: 4, desc: "姿をかすませ、戦闘中自分のACを4下げる。" },
  { id: "maharita",name: "火炎",   sc: "M", lv: 3, tgt: "group",  use: "b",  eff: "dmg", dice: "4d6", elem: "fire", desc: "炎の嵐。敵1グループに4〜24ダメージ。" },
  { id: "morita",  name: "雷撃",     sc: "M", lv: 3, tgt: "group",  use: "b",  eff: "dmg", dice: "3d6", elem: "elec", desc: "火花の雨。敵1グループに3〜18ダメージ。" },
  { id: "darta",   name: "吹雪",     sc: "M", lv: 4, tgt: "group",  use: "b",  eff: "dmg", dice: "6d6", elem: "cold", desc: "凍てつく吹雪。敵1グループに6〜36ダメージ。" },
  { id: "laharita",name: "大火炎",   sc: "M", lv: 4, tgt: "group",  use: "b",  eff: "dmg", dice: "6d6", elem: "fire", desc: "猛火。敵1グループに6〜36ダメージ。" },
  { id: "madarta", name: "大吹雪",   sc: "M", lv: 5, tgt: "group",  use: "b",  eff: "dmg", dice: "8d8", elem: "cold", desc: "極寒の嵐。敵1グループに8〜64ダメージ。" },
  { id: "lakanita",name: "窒息",   sc: "M", lv: 5, tgt: "group",  use: "b",  eff: "suffocate", desc: "空気を奪い、敵1グループを窒息死させる。強い敵には効きにくい。" },
  { id: "zilwana", name: "不死払い",   sc: "M", lv: 6, tgt: "enemy1", use: "b",  eff: "undead", dice: "10d20", desc: "不死の怪物1体を崩壊させる。不死以外には効果がない。" },
  { id: "makanita",name: "消滅",   sc: "M", lv: 6, tgt: "all",    use: "b",  eff: "slay", val: 8, desc: "レベル8以下の敵をすべて消し去る。" },
  { id: "tiltwaita",name:"大爆発", sc: "M", lv: 7, tgt: "all", use: "b",  eff: "dmg", dice: "10d15", elem: "nuke", desc: "最強の攻撃呪文。敵全体に10〜150ダメージ。" },
  { id: "malora",  name: "瞬間移動",   sc: "M", lv: 7, tgt: "none",   use: "bc", eff: "teleport", desc: "瞬間移動。迷宮では行き先を指定でき、戦闘中は同じ階のどこかへ逃げる。" },
  // 僧侶系
  { id: "diosa",   name: "回復",   sc: "P", lv: 1, tgt: "ally",   use: "bc", eff: "heal", dice: "1d8", desc: "味方1人のHPを回復する。回復量は術者のレベルに比例（Lv1で約10、Lv10で約30）。" },
  { id: "badiosa", name: "痛撃", sc: "P", lv: 1, tgt: "enemy1", use: "b",  eff: "dmg", dice: "1d8", desc: "敵1体に1〜8ダメージ。" },
  { id: "milwana", name: "灯り",   sc: "P", lv: 1, tgt: "none",   use: "c",  eff: "light", val: 60, desc: "魔法の灯り。しばらく遠くまで見え、隠し扉も見つかる。" },
  { id: "porfica", name: "光の盾", sc: "P", lv: 1, tgt: "self",   use: "b",  eff: "ac", val: 4, desc: "光の盾で、戦闘中自分のACを4下げる。" },
  { id: "matuna",  name: "守りの祈り",     sc: "P", lv: 2, tgt: "party",  use: "b",  eff: "pac", val: 2, desc: "戦闘中、味方全員のACを2下げる。" },
  { id: "calfa",   name: "罠見破り",   sc: "P", lv: 2, tgt: "none",   use: "",   eff: "calfa", desc: "宝箱の罠を見破る（宝箱の前で使う）。" },
  { id: "montina", name: "沈黙", sc: "P", lv: 2, tgt: "group",  use: "b",  eff: "silence", desc: "敵1グループを沈黙させ、呪文を封じる。" },
  { id: "lomilwana",name:"大灯り", sc: "P", lv: 3, tgt: "none",   use: "c",  eff: "light", val: 400, desc: "強い魔法の灯り。長い間効果が続く。" },
  { id: "dialca",  name: "気付け", sc: "P", lv: 3, tgt: "ally",   use: "bc", eff: "cure", cures: ["sleep", "para"], desc: "味方1人の眠り・麻痺を治す。" },
  { id: "latumapica",name:"正体看破",sc: "P", lv: 3, tgt: "none",   use: "bc", eff: "identify", desc: "この探索の間、怪物の正体がすべてわかるようになる。" },
  { id: "bamatuna",name: "聖なる守り",   sc: "P", lv: 3, tgt: "party",  use: "b",  eff: "pac", val: 4, desc: "戦闘中、味方全員のACを4下げる。" },
  { id: "diara",   name: "中回復",   sc: "P", lv: 4, tgt: "ally",   use: "bc", eff: "heal", dice: "3d8", desc: "味方1人のHPを大きく回復する（覚えたてのLv7で約45、Lv12で約60）。" },
  { id: "badiara", name: "大痛撃", sc: "P", lv: 4, tgt: "enemy1", use: "b",  eff: "dmg", dice: "3d8", desc: "敵1体に3〜24ダメージ。" },
  { id: "latumofisa",name:"解毒",sc:"P", lv: 4, tgt: "ally",   use: "bc", eff: "cure", cures: ["poison"], desc: "味方1人の毒を消す。" },
  { id: "diaruma", name: "大回復", sc: "P", lv: 5, tgt: "ally",   use: "bc", eff: "heal", dice: "6d8", desc: "味方1人のHPをほぼ全快させる（覚えたてのLv9で約80、Lv13で約100）。" },
  { id: "badia",   name: "死の宣告",   sc: "P", lv: 5, tgt: "enemy1", use: "b",  eff: "death", desc: "敵1体の心臓を止める。強い敵には効きにくい。" },
  { id: "dia",     name: "蘇生",     sc: "P", lv: 5, tgt: "ally",   use: "c",  eff: "raise", desc: "死んだ仲間を生き返らせる。失敗すると灰になる。" },
  { id: "litocana",name: "火柱",   sc: "P", lv: 5, tgt: "group",  use: "b",  eff: "dmg", dice: "3d8", elem: "fire", desc: "炎の柱。敵1グループに3〜24ダメージ。" },
  { id: "harawa",  name: "魔除けの祈り", sc: "P", lv: 5, tgt: "none",   use: "c",  eff: "ward", val: 150, desc: "しばらくの間（150歩）、怪物に出会う回数がおよそ半分になる。決まった場所の戦いは避けられない。" },
  { id: "madia",   name: "完全回復",   sc: "P", lv: 6, tgt: "ally",   use: "bc", eff: "fullheal", desc: "味方1人のHPを全快し、死以外の状態異常をすべて治す。" },
  { id: "labadia", name: "生命吸収", sc: "P", lv: 6, tgt: "enemy1", use: "b",  eff: "drain", desc: "敵1体の生命力を吸い取り、自分のHPにする。" },
  { id: "loktofeita",name:"帰還",sc:"P", lv: 6, tgt: "none", use: "bc", eff: "escape", desc: "パーティ全員を地上の町へ帰還させる。代償に所持金の半分を失う。" },
  { id: "kadoruta",name: "完全蘇生",   sc: "P", lv: 7, tgt: "ally",   use: "c",  eff: "raise2", desc: "死者や灰になった者を完全に蘇らせる。" },
  { id: "malikta", name: "天罰",   sc: "P", lv: 7, tgt: "all",    use: "b",  eff: "dmg", dice: "12d6", desc: "天の怒り。敵全体に12〜72ダメージ。" },
];
const SPELL = {}; SPELLS.forEach(s => SPELL[s.id] = s);

/* ────────── アイテム ──────────
   t: weapon/armor/shield/helm/gloves/acc/use
   cls: 装備できる職業の頭文字（F戦 M魔 P僧 T盗 B司 S侍 L君 N忍、*は全員）
   tier: 出現する深さの目安(0=店売り基本品 〜 5=最深部の逸品)
   unk: 未鑑定の時の名前 */
const ITEMS = [
  // 武器
  { id: "dagger",   name: "ダガー",             unk: "短剣?",  t: "weapon", cls: "FMTSLN", dmg: "1d4", hit: 0, price: 10, tier: 0 },
  { id: "staff",    name: "スタッフ",           unk: "杖?",    t: "weapon", cls: "*",      dmg: "1d5", hit: 0, price: 10, tier: 0 },
  { id: "ssword",   name: "ショートソード",     unk: "剣?",    t: "weapon", cls: "FTSLN",  dmg: "1d6", hit: 0, price: 15, tier: 0 },
  { id: "lsword",   name: "ロングソード",       unk: "剣?",    t: "weapon", cls: "FSLN",   dmg: "1d8", hit: 0, price: 25, tier: 0 },
  { id: "mace",     name: "メイス",             unk: "鈍器?",  t: "weapon", cls: "FPBSLN", dmg: "2d3", hit: 0, price: 30, tier: 0 },
  { id: "baxe",     name: "バトルアクス",       unk: "斧?",    t: "weapon", cls: "FSLN",   dmg: "2d4", hit: -1, price: 80, tier: 0 },
  { id: "dagger1",  name: "ダガー+1",           unk: "短剣?",  t: "weapon", cls: "FMTSLN", dmg: "1d4+1", hit: 1, price: 400, tier: 1 },
  { id: "ssword1",  name: "ショートソード+1",   unk: "剣?",    t: "weapon", cls: "FTSLN",  dmg: "1d6+1", hit: 1, price: 500, tier: 1 },
  { id: "lsword1",  name: "ロングソード+1",     unk: "剣?",    t: "weapon", cls: "FSLN",   dmg: "1d8+1", hit: 1, price: 650, tier: 1 },
  { id: "mace1",    name: "メイス+1",           unk: "鈍器?",  t: "weapon", cls: "FPBSLN", dmg: "2d3+1", hit: 1, price: 600, tier: 1 },
  { id: "swordcur", name: "血塗られた剣",       unk: "剣?",    t: "weapon", cls: "FSLN",   dmg: "1d8-1", hit: -2, price: 100, tier: 1, cursed: true },
  { id: "ssword2",  name: "ショートソード+2",   unk: "剣?",    t: "weapon", cls: "FTSLN",  dmg: "1d6+2", hit: 2, price: 2000, tier: 2 },
  { id: "lsword2",  name: "ロングソード+2",     unk: "剣?",    t: "weapon", cls: "FSLN",   dmg: "1d8+2", hit: 2, price: 2600, tier: 2 },
  { id: "mace2",    name: "メイス+2",           unk: "鈍器?",  t: "weapon", cls: "FPBSLN", dmg: "2d3+2", hit: 2, price: 2400, tier: 2 },
  { id: "staffhar", name: "火炎の杖",       unk: "杖?",    t: "weapon", cls: "*",      dmg: "1d5", hit: 0, price: 1500, tier: 2, useSpell: "maharita", brk: 0.15 },
  { id: "axecur",   name: "悪霊の斧",           unk: "斧?",    t: "weapon", cls: "FSLN",   dmg: "2d4", hit: -3, price: 300, tier: 2, cursed: true },
  { id: "flame",    name: "炎の剣",             unk: "剣?",    t: "weapon", cls: "FSLN",   dmg: "2d8", hit: 3, price: 6000, tier: 3 },
  { id: "sceptre",  name: "司祭の錫杖",         unk: "鈍器?",  t: "weapon", cls: "PBL",    dmg: "2d4+2", hit: 2, price: 5000, tier: 3, useSpell: "diara", brk: 0.1 },
  { id: "dslayer",  name: "竜殺しの剣",         unk: "剣?",    t: "weapon", cls: "FSLN",   dmg: "1d10+3", hit: 3, price: 8000, tier: 3, slay: "dragon" },
  { id: "holyaxe",  name: "聖なる斧",           unk: "斧?",    t: "weapon", cls: "FSLN",   dmg: "3d4+3", hit: 3, price: 9000, tier: 4, slay: "undead" },
  { id: "cassia",   name: "鍛冶師グラムの剣",     unk: "剣?",    t: "weapon", cls: "FSLN",   dmg: "10d3", hit: 4, price: 15000, tier: 4 },
  { id: "murasama", name: "妖刀・朧月",               unk: "刀?",    t: "weapon", cls: "S",      dmg: "10d5", hit: 6, price: 50000, tier: 5, strUp: 1 },
  { id: "shuriken", name: "手裏剣",             unk: "刃物?",  t: "weapon", cls: "N",      dmg: "3d5", hit: 5, price: 40000, tier: 5, critUp: 0.1 },
  { id: "excal",    name: "聖剣アルヴァイン",   unk: "剣?",    t: "weapon", cls: "L",      dmg: "4d6+4", hit: 5, price: 45000, tier: 5, slay: "demon" },
  // 鎧
  { id: "robe",     name: "ローブ",             unk: "服?",    t: "armor",  cls: "*",       ac: 1, price: 15, tier: 0 },
  { id: "leather",  name: "革の鎧",             unk: "鎧?",    t: "armor",  cls: "FPTBSLN", ac: 2, price: 50, tier: 0 },
  { id: "chain",    name: "鎖かたびら",         unk: "鎧?",    t: "armor",  cls: "FPSLN",   ac: 3, price: 90, tier: 0 },
  { id: "breast",   name: "胸当て",             unk: "鎧?",    t: "armor",  cls: "FPSLN",   ac: 4, price: 200, tier: 0 },
  { id: "plate",    name: "板金鎧",             unk: "鎧?",    t: "armor",  cls: "FPSL",    ac: 5, price: 750, tier: 0 },
  { id: "robe1",    name: "ローブ+1",           unk: "服?",    t: "armor",  cls: "*",       ac: 2, price: 500, tier: 1 },
  { id: "leather1", name: "革の鎧+1",           unk: "鎧?",    t: "armor",  cls: "FPTBSLN", ac: 3, price: 800, tier: 1 },
  { id: "chain1",   name: "鎖かたびら+1",       unk: "鎧?",    t: "armor",  cls: "FPSLN",   ac: 4, price: 1200, tier: 1 },
  { id: "armcur",   name: "錆びついた鎧",       unk: "鎧?",    t: "armor",  cls: "FPTBSLN", ac: -2, price: 100, tier: 1, cursed: true },
  { id: "plate1",   name: "板金鎧+1",           unk: "鎧?",    t: "armor",  cls: "FPSL",    ac: 6, price: 3000, tier: 2 },
  { id: "leather2", name: "革の鎧+2",           unk: "鎧?",    t: "armor",  cls: "FPTBSLN", ac: 4, price: 2500, tier: 2 },
  { id: "chain2",   name: "鎖かたびら+2",       unk: "鎧?",    t: "armor",  cls: "FPSLN",   ac: 5, price: 3500, tier: 2 },
  { id: "plate2",   name: "板金鎧+2",           unk: "鎧?",    t: "armor",  cls: "FPSL",    ac: 7, price: 8000, tier: 3 },
  { id: "mrobe",    name: "賢者のローブ",       unk: "服?",    t: "armor",  cls: "MBP",     ac: 4, price: 7000, tier: 3 },
  { id: "chain3",   name: "ミスリルの鎖かたびら", unk: "鎧?",  t: "armor",  cls: "FPTSLN",  ac: 7, price: 12000, tier: 4 },
  { id: "plate3",   name: "板金鎧+3",           unk: "鎧?",    t: "armor",  cls: "FPSL",    ac: 9, price: 20000, tier: 4 },
  { id: "lordgarb", name: "聖騎士の法衣",         unk: "鎧?",    t: "armor",  cls: "L",       ac: 10, price: 60000, tier: 5, regen: 1 },
  // 盾
  { id: "sshield",  name: "小さな盾",           unk: "盾?",    t: "shield", cls: "FPTSLN",  ac: 2, price: 20, tier: 0 },
  { id: "lshield",  name: "大きな盾",           unk: "盾?",    t: "shield", cls: "FPSL",    ac: 3, price: 40, tier: 0 },
  { id: "shield1",  name: "盾+1",               unk: "盾?",    t: "shield", cls: "FPTSLN",  ac: 3, price: 900, tier: 1 },
  { id: "shieldcur",name: "重すぎる盾",         unk: "盾?",    t: "shield", cls: "FPTSLN",  ac: -1, price: 100, tier: 1, cursed: true },
  { id: "shield2",  name: "盾+2",               unk: "盾?",    t: "shield", cls: "FPTSLN",  ac: 4, price: 3500, tier: 2 },
  { id: "shield3",  name: "盾+3",               unk: "盾?",    t: "shield", cls: "FPTSLN",  ac: 5, price: 10000, tier: 3 },
  { id: "shieldev", name: "邪悪なる盾",         unk: "盾?",    t: "shield", cls: "FPTSLN",  ac: 6, price: 16000, tier: 4, align: "E" },
  // 兜
  { id: "helm",     name: "兜",                 unk: "兜?",    t: "helm",   cls: "FPSLN",   ac: 1, price: 100, tier: 0 },
  { id: "helm1",    name: "兜+1",               unk: "兜?",    t: "helm",   cls: "FPSLN",   ac: 2, price: 1500, tier: 2 },
  { id: "helmcur",  name: "呪いの面頬",         unk: "兜?",    t: "helm",   cls: "FPSLN",   ac: -2, price: 100, tier: 2, cursed: true },
  { id: "helmwis",  name: "英知の兜",           unk: "兜?",    t: "helm",   cls: "*",       ac: 3, price: 12000, tier: 4 },
  // 小手
  { id: "gloves",   name: "革の小手",           unk: "小手?",  t: "gloves", cls: "FPTSLN",  ac: 1, price: 60, tier: 0 },
  { id: "gloves1",  name: "銅の小手",           unk: "小手?",  t: "gloves", cls: "FPSLN",   ac: 2, price: 1600, tier: 2 },
  { id: "gloves2",  name: "銀の小手",           unk: "小手?",  t: "gloves", cls: "FPSLN",   ac: 3, price: 7000, tier: 3 },
  // 装飾品
  { id: "ringprot", name: "守りの指輪",         unk: "指輪?",  t: "acc",    cls: "*",       ac: 1, price: 2000, tier: 2 },
  { id: "ringheal", name: "癒しの指輪",         unk: "指輪?",  t: "acc",    cls: "*",       ac: 0, price: 8000, tier: 3, regen: 1 },
  { id: "ringdeath",name: "死の指輪",           unk: "指輪?",  t: "acc",    cls: "*",       ac: 0, price: 500, tier: 3, cursed: true, drainHp: 1 },
  { id: "amuletgem",name: "宝玉の首飾り",       unk: "首飾り?", t: "acc",   cls: "*",       ac: 3, price: 15000, tier: 4 },
  { id: "ringmovr", name: "移動の指輪",         unk: "指輪?",  t: "acc",    cls: "*",       ac: 0, price: 20000, tier: 5, useSpell: "malora", brk: 0.25 },
  // 消耗品・道具
  { id: "potion",   name: "回復の薬",           unk: "薬?",    t: "use",    cls: "*", price: 40,   tier: 0, useSpell: "diosa", consume: true },
  { id: "antidote", name: "毒消し",             unk: "薬?",    t: "use",    cls: "*", price: 30,   tier: 0, useSpell: "latumofisa", consume: true },
  { id: "sc_light", name: "灯りの巻物",         unk: "巻物?",  t: "use",    cls: "*", price: 40,   tier: 0, useSpell: "milwana", consume: true },
  { id: "sc_fire",  name: "炎の巻物",           unk: "巻物?",  t: "use",    cls: "*", price: 60,   tier: 0, useSpell: "harita", consume: true },
  { id: "sc_sleep", name: "眠りの巻物",         unk: "巻物?",  t: "use",    cls: "*", price: 80,   tier: 1, useSpell: "katina", consume: true },
  { id: "potion2",  name: "上等な回復薬",       unk: "薬?",    t: "use",    cls: "*", price: 400,  tier: 2, useSpell: "diaruma", consume: true },
  { id: "sc_ice",   name: "吹雪の巻物",         unk: "巻物?",  t: "use",    cls: "*", price: 900,  tier: 2, useSpell: "darta", consume: true },
  { id: "sc_escape",name: "帰還の巻物",         unk: "巻物?",  t: "use",    cls: "*", price: 2500, tier: 3, useSpell: "loktofeita", consume: true },
  { id: "potion3",  name: "霊薬",               unk: "薬?",    t: "use",    cls: "*", price: 3000, tier: 3, useSpell: "madia", consume: true },
  { id: "rodfire",  name: "爆炎の笏",           unk: "杖?",    t: "use",    cls: "*", price: 10000, tier: 4, useSpell: "laharita", brk: 0.1 },
  { id: "rodholy",  name: "天罰の宝珠",         unk: "宝珠?",  t: "use",    cls: "*", price: 25000, tier: 5, useSpell: "malikta", brk: 0.2 },
];
const ITEM = {}; ITEMS.forEach(i => ITEM[i.id] = i);
const SHOP_BASE = ["dagger", "staff", "ssword", "lsword", "mace", "baxe", "robe", "leather", "chain", "breast", "plate",
  "sshield", "lshield", "helm", "gloves", "potion", "antidote", "sc_light", "sc_fire"];

/* 大事なもの（パーティ共有・売れない） */
const KEYITEMS = {
  key_watch:  { name: "見張り番の鍵",   desc: "ならず者の頭が持っていた、太い鉄の鍵。" },
  key_rust:   { name: "錆びた鍵束",     desc: "コボルドの王が首から下げていた、錆びた鍵の束。王冠をかぶったコボルドの紋が刻まれている。" },
  shard1:     { name: "封印の欠片・壱", desc: "最深部の封印の扉を開くのに必要な欠片のひとつ。" },
  windcharm:  { name: "風の護符",       desc: "刃尾の狐の長が守っていた護符。握ると、風が指のあいだをすり抜けていく。" },
  shard2:     { name: "封印の欠片・弐", desc: "最深部の封印の扉を開くのに必要な欠片のひとつ。" },
  sluicekey:  { name: "水門の鍵",       desc: "石像の広間に落ちていた大きな鍵。ぬめった藻がこびりついている。" },
  shard3:     { name: "封印の欠片・参", desc: "最深部の封印の扉を開くのに必要な欠片のひとつ。かすかに脈打つように光っている。" },
  starlamp:   { name: "星灯",           desc: "封印の要。祭壇に戻せば、星喰いの封印は結び直される。" },
};

/* ────────── モンスター ──────────
   hp: ダイス / ac / atk: 攻撃ごとのダメージ / grp: 1グループの数 / fl: 出現階
   特殊: poison 毒, para 麻痺, stone 石化, drain レベル吸収, crit 首はね, sleepAtk 眠り
   breath: ブレス(火fire/冷cold/毒gas) / spells: {M:使える魔術レベル, P:僧侶レベル} / call: 仲間を呼ぶ確率
   mr: 呪文無効化率(%) / res: 効きにくい属性 / flee: 逃走しやすさ / friendly: 友好的な確率 */
const MONSTERS = [
  { id: "slime",    name: "泡スライム", unk: "ぬめぬめした物体", g: "🟢", col: "#3a7",  lv: 1, hp: "1d5",  ac: 9, atk: ["1d2"], grp: [2, 6], fl: [1, 2], type: "slime" },
  { id: "rat",      name: "大ネズミ",       unk: "小さな動物",   g: "🐀", col: "#876", lv: 1, hp: "1d4",  ac: 8, atk: ["1d3"], grp: [3, 7], fl: [1, 2], type: "animal", friendly: 0.05 },
  { id: "kobold",   name: "コボルド",       unk: "小柄な人影",   g: "👺", col: "#a64", lv: 1, hp: "1d6+1", ac: 8, atk: ["1d4"], grp: [2, 6], fl: [1, 2], type: "human" },
  { id: "orc",      name: "オーク",         unk: "人型の生き物", g: "👹", col: "#6a4", lv: 1, hp: "1d8",  ac: 10, atk: ["1d6"], grp: [2, 6], fl: [1, 2], type: "human", friendly: 0.08 },
  { id: "bat",      name: "大コウモリ",     unk: "飛ぶもの",     g: "🦇", col: "#555", lv: 1, hp: "1d5",  ac: 7, atk: ["1d2"], grp: [3, 8], fl: [1, 2], type: "animal" },
  { id: "acolyte",  name: "見習い僧侶",     unk: "ローブの男",   g: "🙏", col: "#98c", lv: 1, hp: "1d8",  ac: 8, atk: ["1d4"], grp: [1, 4], fl: [1, 2], type: "human", spells: { P: 1 }, friendly: 0.15 },
  { id: "apprent",  name: "見習い魔術師",   unk: "ローブの男",   g: "🧙", col: "#86c", lv: 1, hp: "1d6",  ac: 9, atk: ["1d3"], grp: [1, 4], fl: [1, 2], type: "human", spells: { M: 1 }, friendly: 0.1 },
  { id: "bushwack", name: "ならず者",       unk: "怪しい男",     g: "🧔", col: "#a86", lv: 2, hp: "2d6",  ac: 8, atk: ["1d6"], grp: [1, 4], fl: [1, 3], type: "human" },
  { id: "skeleton", name: "骸骨戦士",       unk: "動く骨",       g: "💀", col: "#ccb", lv: 2, hp: "2d6",  ac: 7, atk: ["1d6"], grp: [2, 5], fl: [1, 3], type: "undead", res: ["sleep"] },
  { id: "minerghost",name:"さまよう坑夫の霊", unk: "青白い影", g: "👻", col: "#8ac", lv: 3, hp: "3d8", ac: 6, atk: ["1d4"], grp: [1, 2], fl: [2, 3], type: "undead", res: ["sleep"] },
  { id: "banditboss",name:"ならず者のかしら", unk: "大柄な男",    g: "🧔", col: "#c64", lv: 3, hp: "3d8+6", ac: 6, atk: ["1d8", "1d4"], grp: [1, 1], fl: [0, 0], type: "human", exp: 180 },
  { id: "zombie",   name: "ゾンビ",         unk: "腐った人影",   g: "🧟", col: "#6a6", lv: 2, hp: "2d8",  ac: 8, atk: ["1d6"], grp: [2, 5], fl: [2, 3], type: "undead", res: ["sleep"] },
  { id: "highway",  name: "追い剥ぎ",       unk: "怪しい男",     g: "🗡️", col: "#a75", lv: 2, hp: "2d8",  ac: 7, atk: ["1d8"], grp: [2, 5], fl: [2, 3], type: "human" },
  { id: "leech",    name: "巨大ヒル",       unk: "ぬめぬめした物体", g: "🐛", col: "#b66", lv: 2, hp: "2d6", ac: 8, atk: ["1d4"], poison: 0.3, grp: [2, 5], fl: [2, 3], type: "animal" },
  { id: "hound",    name: "狂犬",           unk: "四つ足の獣",   g: "🐕", col: "#975", lv: 2, hp: "2d6",  ac: 7, atk: ["1d4", "1d4"], grp: [2, 6], fl: [2, 3], type: "animal" },
  { id: "dwarfwar", name: "ドワーフの戦士", unk: "小柄な戦士",   g: "⛏️", col: "#a96", lv: 3, hp: "3d8",  ac: 5, atk: ["1d8"], grp: [2, 4], fl: [2, 4], type: "human", friendly: 0.12 },
  { id: "priestess",name: "女司祭",         unk: "ローブの女",   g: "🙏", col: "#c9c", lv: 3, hp: "3d6",  ac: 7, atk: ["1d6"], grp: [1, 4], fl: [2, 4], type: "human", spells: { P: 2 }, friendly: 0.12 },
  { id: "gascloud", name: "ガス雲",         unk: "漂うもや",     g: "☁️", col: "#9b9", lv: 3, hp: "2d8",  ac: 6, atk: [], breath: "gas", grp: [1, 3], fl: [2, 4], type: "other", res: ["sleep"] },
  { id: "koboldking",name:"コボルドの王",   unk: "小柄な人影",   g: "👑", col: "#c83", lv: 4, hp: "4d8+6", ac: 5, atk: ["1d8", "1d6"], grp: [1, 1], fl: [0, 0], type: "human", exp: 320 },
  { id: "coins",    name: "這いずる金貨", unk: "光る小山",  g: "💰", col: "#db3", lv: 2, hp: "1d6",  ac: 5, atk: ["1d2"], breath: "cold", grp: [5, 9], fl: [3, 4], type: "other", gold: 4 },
  { id: "beetle",   name: "穴掘り甲虫",     unk: "大きな虫",     g: "🐞", col: "#584", lv: 3, hp: "3d8",  ac: 4, atk: ["2d4"], grp: [2, 5], fl: [3, 4], type: "insect" },
  { id: "wererat",  name: "ワーラット",     unk: "人型の獣",     g: "🐀", col: "#865", lv: 3, hp: "3d8",  ac: 6, atk: ["1d6", "1d4"], para: 0.1, grp: [2, 4], fl: [3, 4], type: "animal" },
  { id: "vbat",     name: "吸血コウモリ",   unk: "飛ぶもの",     g: "🦇", col: "#833", lv: 3, hp: "2d8",  ac: 6, atk: ["1d6"], poison: 0.2, grp: [3, 7], fl: [3, 4], type: "animal" },
  { id: "ninjaapp", name: "見習い忍者",     unk: "黒装束の男",   g: "🥷", col: "#446", lv: 4, hp: "3d8",  ac: 4, atk: ["1d6", "1d6"], crit: 0.03, grp: [1, 4], fl: [3, 5], type: "human" },
  { id: "mage",     name: "魔術師",         unk: "ローブの男",   g: "🧙", col: "#64c", lv: 4, hp: "3d6",  ac: 8, atk: ["1d4"], grp: [1, 4], fl: [3, 5], type: "human", spells: { M: 3 }, friendly: 0.1 },
  { id: "hellhound",name: "ヘルハウンド",   unk: "四つ足の獣",   g: "🐺", col: "#c42", lv: 4, hp: "4d8",  ac: 5, atk: ["1d8"], breath: "fire", grp: [2, 4], fl: [3, 5], type: "animal", res: ["fire"] },
  { id: "bonelord", name: "骸骨の騎士",     unk: "動く骨",       g: "💀", col: "#dcb", lv: 5, hp: "5d8+8", ac: 3, atk: ["1d10", "1d6"], grp: [1, 1], fl: [0, 0], type: "undead", exp: 600, res: ["sleep"] },
  { id: "gargoyle", name: "ガーゴイル",     unk: "石の怪物",     g: "🗿", col: "#889", lv: 4, hp: "4d8",  ac: 3, atk: ["1d6", "1d6", "1d4"], grp: [1, 4], fl: [4, 5], type: "other", res: ["sleep"] },
  { id: "werewolf", name: "ワーウルフ",     unk: "人型の獣",     g: "🐺", col: "#776", lv: 5, hp: "5d8",  ac: 5, atk: ["1d8"], para: 0.15, grp: [2, 4], fl: [4, 6], type: "animal" },
  { id: "ogre",     name: "オーガ",         unk: "大きな人影",   g: "👹", col: "#a73", lv: 5, hp: "6d8",  ac: 5, atk: ["2d6"], grp: [1, 4], fl: [4, 6], type: "human" },
  { id: "dpuppy",   name: "幼竜", unk: "小さな竜",     g: "🐲", col: "#4a6", lv: 5, hp: "5d8",  ac: 3, atk: ["1d6", "1d6"], breath: "fire", grp: [1, 3], fl: [4, 6], type: "dragon", res: ["fire"] },
  { id: "knight",   name: "騎士",           unk: "鎧の戦士",     g: "🛡️", col: "#99a", lv: 5, hp: "5d8",  ac: 2, atk: ["1d10"], grp: [2, 4], fl: [4, 6], type: "human", friendly: 0.1 },
  { id: "guard",    name: "詰所の番兵", unk: "鎧の戦士",     g: "💂", col: "#77a", lv: 5, hp: "5d8+4", ac: 3, atk: ["1d8", "1d6"], grp: [2, 5], fl: [0, 0], type: "human" },
  { id: "watcher",  name: "番兵長",         unk: "兜の大男",     g: "🛡️", col: "#c5c", lv: 8, hp: "8d8+20", ac: 2, atk: ["2d6", "1d8"], grp: [1, 1], fl: [0, 0], type: "human", spells: { M: 4 }, exp: 1800, mr: 20 },
  { id: "bladefox", name: "刃尾ギツネ",     unk: "小さな獣",     g: "🦊", col: "#d93", lv: 5, hp: "4d6",  ac: 3, atk: ["1d4"], crit: 0.08, grp: [2, 6], fl: [5, 6], type: "animal" },
  { id: "harpy",    name: "ハーピー",       unk: "翼ある女",     g: "🦅", col: "#a86", lv: 5, hp: "4d8",  ac: 5, atk: ["1d6", "1d6"], sleepAtk: 0.1, grp: [2, 5], fl: [5, 6], type: "animal" },
  { id: "wight",    name: "ワイト",         unk: "不気味な影",   g: "👤", col: "#557", lv: 6, hp: "5d8",  ac: 4, atk: ["1d6"], drain: 0.07, grp: [1, 4], fl: [5, 7], type: "undead", res: ["sleep"] },
  { id: "hmage",    name: "上位魔術師",     unk: "ローブの男",   g: "🧙", col: "#74d", lv: 6, hp: "5d6",  ac: 6, atk: ["1d6"], grp: [1, 3], fl: [5, 7], type: "human", spells: { M: 4 }, mr: 10 },
  { id: "foxlord",  name: "刃尾ギツネの長", unk: "小さな獣",     g: "🦊", col: "#fc6", lv: 7, hp: "6d8+10", ac: 1, atk: ["1d6", "1d6"], crit: 0.15, grp: [1, 1], fl: [0, 0], type: "animal", exp: 1500 },
  { id: "golem",    name: "クレイゴーレム", unk: "巨大な人形",   g: "🗿", col: "#a85", lv: 7, hp: "8d8",  ac: 2, atk: ["3d6"], grp: [1, 3], fl: [6, 7], type: "other", res: ["sleep"], mr: 20 },
  { id: "troll",    name: "トロル",         unk: "大きな人影",   g: "🦍", col: "#686", lv: 7, hp: "7d8",  ac: 4, atk: ["1d8", "1d8", "2d6"], regen: 3, grp: [1, 4], fl: [6, 8], type: "human" },
  { id: "medusa",   name: "メデューサ",     unk: "蛇髪の女",     g: "🐍", col: "#5a5", lv: 7, hp: "6d8",  ac: 5, atk: ["1d6"], stone: 0.12, grp: [1, 3], fl: [6, 7], type: "other" },
  { id: "chimera",  name: "キマイラ",       unk: "合成獣",       g: "🦁", col: "#c93", lv: 8, hp: "8d8",  ac: 3, atk: ["2d4", "2d4", "1d8"], breath: "fire", grp: [1, 3], fl: [6, 8], type: "animal", res: ["fire"] },
  { id: "ninja",    name: "忍者",           unk: "黒装束の男",   g: "🥷", col: "#223", lv: 8, hp: "7d8",  ac: 1, atk: ["2d6", "2d6"], crit: 0.06, grp: [1, 4], fl: [6, 8], type: "human" },
  { id: "hpriest",  name: "高司祭",         unk: "ローブの男",   g: "🙏", col: "#dac", lv: 8, hp: "7d6",  ac: 4, atk: ["1d8"], grp: [1, 3], fl: [6, 8], type: "human", spells: { P: 5 }, mr: 15 },
  { id: "vampire",  name: "バンパイア",     unk: "青白い男",     g: "🧛", col: "#a24", lv: 9, hp: "8d8",  ac: 1, atk: ["1d10"], drain: 0.1, grp: [1, 4], fl: [7, 9], type: "undead", spells: { M: 3 }, res: ["sleep"], mr: 20 },
  { id: "poisongiant",name:"毒の巨人",      unk: "巨人",         g: "☠️", col: "#5a3", lv: 9, hp: "10d8", ac: 2, atk: ["3d8"], breath: "gas", grp: [1, 3], fl: [7, 9], type: "human" },
  { id: "succubus", name: "サキュバス",     unk: "妖艶な女",     g: "😈", col: "#c3a", lv: 9, hp: "8d8",  ac: 1, atk: ["1d8"], drain: 0.08, grp: [1, 3], fl: [7, 9], type: "demon", spells: { M: 4 }, mr: 30 },
  { id: "wraith",   name: "レイス",         unk: "不気味な影",   g: "👻", col: "#446", lv: 9, hp: "8d8",  ac: 2, atk: ["1d10"], drain: 0.08, para: 0.08, grp: [1, 4], fl: [7, 9], type: "undead", res: ["sleep"] },
  { id: "wyvern",   name: "ワイバーン",     unk: "竜",           g: "🐉", col: "#686", lv: 9, hp: "9d8",  ac: 3, atk: ["2d6", "1d8"], poison: 0.3, grp: [1, 3], fl: [7, 9], type: "dragon" },
  { id: "swampking",name: "沼の主",         unk: "巨大な影",     g: "🐊", col: "#474", lv: 10, hp: "12d8+20", ac: 1, atk: ["3d8", "2d6"], poison: 0.4, grp: [1, 1], fl: [0, 0], type: "animal", exp: 5000, breath: "gas" },
  { id: "firegiant",name: "炎の巨人",       unk: "巨人",         g: "🔥", col: "#e52", lv: 10, hp: "12d8", ac: 1, atk: ["4d8"], breath: "fire", grp: [1, 3], fl: [8, 10], type: "human", res: ["fire"] },
  { id: "gdemon",   name: "上級悪魔", unk: "魔物",     g: "😈", col: "#b22", lv: 11, hp: "11d8", ac: -3, atk: ["4d4", "4d4"], grp: [1, 3], fl: [8, 10], type: "demon", spells: { M: 5 }, call: 0.25, mr: 50, res: ["sleep"] },
  { id: "frostgiant",name:"氷の巨人",       unk: "巨人",         g: "🧊", col: "#8cf", lv: 11, hp: "13d8", ac: 0, atk: ["4d10"], breath: "cold", grp: [1, 3], fl: [9, 10], type: "human", res: ["cold"] },
  { id: "reddragon",name: "レッドドラゴン", unk: "竜",           g: "🐉", col: "#d33", lv: 12, hp: "12d8+10", ac: -1, atk: ["3d8", "3d8"], breath: "fire", grp: [1, 2], fl: [9, 10], type: "dragon", res: ["fire", "sleep"], mr: 20 },
  { id: "mninja",   name: "上忍",           unk: "黒装束の男",   g: "🥷", col: "#112", lv: 12, hp: "10d8", ac: -3, atk: ["3d6", "3d6"], crit: 0.1, grp: [1, 3], fl: [9, 10], type: "human" },
  { id: "archmage", name: "大魔術師",       unk: "ローブの男",   g: "🧙", col: "#62f", lv: 12, hp: "9d6",  ac: 2, atk: ["1d8"], grp: [1, 2], fl: [9, 10], type: "human", spells: { M: 6 }, mr: 40 },
  { id: "firekeeper",name:"宝物庫の番人",     unk: "巨人",         g: "🔥", col: "#f63", lv: 11, hp: "14d8+20", ac: -1, atk: ["4d8", "2d8"], breath: "fire", grp: [1, 1], fl: [0, 0], type: "human", res: ["fire"], exp: 9000 },
  { id: "sphinx",   name: "謎かけのスフィンクス", unk: "獅子の像", g: "🦁", col: "#ca6", lv: 12, hp: "14d8", ac: -2, atk: ["3d6", "3d6"], grp: [1, 1], fl: [0, 0], type: "other", spells: { P: 6 }, mr: 40, exp: 12000 },
  { id: "demonlord",name: "星喰いの眷属",   unk: "魔物",         g: "👿", col: "#80f", lv: 13, hp: "14d8", ac: -5, atk: ["4d6", "4d6"], grp: [1, 2], fl: [10, 10], type: "demon", spells: { M: 7 }, call: 0.15, mr: 65, res: ["sleep"] },
  { id: "royalguard",name:"灰の親衛兵",     unk: "鎧の戦士",     g: "⚔️", col: "#aab", lv: 10, hp: "10d8+10", ac: -2, atk: ["2d8", "2d8"], grp: [3, 5], fl: [0, 0], type: "human", res: ["sleep"] },
  { id: "vlord",    name: "ヴァンパイアロード", unk: "青白い男", g: "🧛", col: "#c03", lv: 13, hp: "13d8+20", ac: -4, atk: ["2d10"], drain: 0.15, grp: [1, 1], fl: [0, 0], type: "undead", spells: { M: 6 }, mr: 50, res: ["sleep"], exp: 12000 },
  { id: "morvan",   name: "灰の司祭モルヴァン", unk: "灰色の法衣の男", g: "🧙‍♂️", col: "#f0c", lv: 16, hp: "480", ac: -8, atk: ["3d8", "2d8"], regen: 12, grp: [1, 1], fl: [0, 0], type: "human", spells: { M: 7, P: 6 }, mr: 60, res: ["sleep"], exp: 50000, boss: true },
];
const MONSTER = {}; MONSTERS.forEach(m => MONSTER[m.id] = m);

/* 宝箱の罠 */
const TRAPS = [
  { id: "none",     name: "罠はない",           min: 1 },
  { id: "needle",   name: "毒針",               min: 1 },
  { id: "arrow",    name: "石弓の矢",           min: 1 },
  { id: "gas",      name: "ガス爆弾",           min: 2 },
  { id: "stunner",  name: "痺れ針",             min: 2 }, // 刺さると麻痺する
  { id: "bomb",     name: "爆弾",               min: 3 },
  { id: "teleport", name: "テレポーター",       min: 3 },
  { id: "alarm",    name: "警報",               min: 2 },
  { id: "mblast",   name: "魔術師殺し",         min: 5 },
  { id: "pblast",   name: "僧侶殺し",           min: 5 },
];

/* ────────── 迷宮（地下1〜10階） ──────────
   座標は(0,0)が南西の角、xが東、yが北。
   sections: 区画（矩形, [x0,y0,x1,y1]）。区画内は自動生成の迷路。
   hidden: 隠しアイテム（そのマスで「調べる」と見つかる）。{ at:[x,y], gold } か { at:[x,y], item }
   links: 区画どうしの接続。type: door扉 / open通路 / secret隠し扉 / oneway一方通行(a→bのみ) / lock鍵(req=必要なもの)
   ev: 固定イベント。 zones: dark暗闇 / anti魔法封じ / swamp毒沼 */
const FLOORS = [
  null,
  { // B1
    name: "旧坑道", seed: 1101, loops: 0.12, encRate: 0.05,
    sections: { A: [0, 0, 9, 19], B: [10, 0, 19, 9], C: [10, 10, 19, 19] },
    links: [ { a: "A", b: "B", type: "door", at: [9, 4, "E"] }, { a: "A", b: "C", type: "lock", req: "key_watch", at: [9, 14, "E"] } ],
    rooms: [ { id: "miner", r: [2, 13, 4, 15] }, { id: "bandit", r: [14, 2, 16, 4] }, { r: [4, 3, 6, 5] }, { r: [14, 14, 16, 16] } ],
    up: [0, 0], down: [19, 19], elev: [11, 18],
    hidden: [{ at: [7, 19], gold: 110 }, { at: [12, 6], item: "potion" }, { at: [1, 11], item: "mace1" }, { at: [17, 2], gold: 60 }],
    zones: [ { t: "dark", r: [6, 8, 7, 9] } ],
    ev: [
      { at: [0, 1], t: "msg", text: "坑道の壁に、古い文字が刻まれている。\n『十の層の底に、星を喰らうもの眠る。\n　灯を絶やすなかれ』" },
      { at: [3, 14], t: "gift", once: "b1npc", reward: { item: "potion", gold: 100 },
        text: "崩れた坑道の奥で、年老いた坑夫が休んでいた。\n「おう、封印を直しに来た連中か。\n　鉄格子の鍵は、奥のならず者どもが持ってるぜ。これも持っていけ」" },
      { at: [15, 3], t: "fight", mons: [["banditboss", 1], ["bushwack", 3]], once: "b1boss", reward: { key: "key_watch" }, text: "坑道を根城にするならず者たちだ。\n「ここは俺たちの縄張りだ！」" },
      { at: [9, 14], t: "msg", text: "頑丈な鉄格子の扉だ。鍵がかかっている。\n扉の脇に、ナイフで字が刻まれている。\n『鍵がほしけりゃ、南東のねぐらまで来な ― ならず者の頭』", dir: "E", noStep: true },
      { at: [18, 19], t: "msg", text: "壁に走り書きがある。\n『坑道の昇降機は、一度たどり着いた階なら止まってくれる』" },
    ],
  },
  { // B2
    name: "地下水路", seed: 2202, loops: 0.1, encRate: 0.05,
    sections: { A: [10, 10, 19, 19], B: [0, 10, 9, 19], C: [0, 0, 9, 9], D: [10, 0, 19, 9] },
    links: [ { a: "A", b: "B", type: "door", at: [10, 15, "W"] }, { a: "B", b: "C", type: "secret", at: [4, 10, "S"] },
             { a: "C", b: "D", type: "door", at: [9, 3, "E"] }, { a: "D", b: "A", type: "oneway", at: [16, 9, "N"] } ],
    rooms: [ { id: "king", r: [2, 2, 4, 4] }, { r: [13, 13, 15, 15] }, { r: [3, 15, 5, 17] }, { r: [14, 3, 16, 5] } ],
    up: [19, 19], down: [19, 0], elev: [12, 18],
    hidden: [{ at: [14, 18], gold: 260 }, { at: [3, 5], item: "potion" }, { at: [10, 10], item: "chain1" }, { at: [19, 5], gold: 130 }],
    zones: [ { t: "dark", r: [5, 12, 8, 15] } ],
    ev: [
      { at: [4, 9], t: "msg", once: "b2kinghint", text: "隠し通路の先には、獣の臭いがこもっている。\n南の奥から、コボルドたちの騒ぐ声が聞こえる。\n「王さま、下の扉の鍵は王さまの首に……」" },
      { at: [4, 10], t: "msg", text: "足元から冷たい風が吹き上げてくる。\n南の壁の向こうに、空間があるようだ……" },
      { at: [3, 3], t: "fight", mons: [["koboldking", 1], ["kobold", 5], ["kobold", 4]], once: "b2boss", reward: { key: "key_rust", gold: 400 }, text: "水路の奥の広間で、骨の玉座に座る大きなコボルドがこちらを睨んだ！" },
      { at: [16, 9], t: "msg", text: "この扉は北側からは開かないようだ。", noStep: true, dir: "N" },
      { at: [14, 14], t: "treasure", once: "b2t1", item: "potion", gold: 150 },
    ],
  },
  { // B3
    name: "石板の回廊", seed: 3303, loops: 0.14, encRate: 0.05,
    sections: { A: [10, 0, 19, 9], B: [10, 10, 19, 19], C: [0, 10, 9, 19], D: [0, 0, 9, 9] },
    links: [ { a: "A", b: "B", type: "door", at: [13, 9, "N"] }, { a: "B", b: "C", type: "door", at: [10, 16, "W"] },
             { a: "C", b: "D", type: "lock", req: "key_rust", at: [5, 10, "S"] }, { a: "D", b: "A", type: "oneway", at: [9, 2, "E"] } ],
    rooms: [ { id: "bone", r: [1, 1, 3, 3] }, { r: [14, 14, 17, 17] }, { r: [3, 14, 5, 16] }, { r: [14, 4, 16, 6] } ],
    up: [19, 0], down: [0, 0], elev: [12, 2],
    hidden: [{ at: [6, 15], gold: 510 }, { at: [10, 2], item: "sc_sleep" }, { at: [15, 12], item: "ringprot" }, { at: [18, 4], item: "potion" }],
    spin: [[14, 12], [17, 15], [12, 17], [6, 17], [2, 12], [8, 13], [15, 15], [4, 18]],
    zones: [ { t: "dark", r: [0, 16, 2, 19] } ],
    ev: [
      { at: [13, 10], t: "msg", text: "床の石板に、渦を巻くような古い紋様が刻まれている。" },
      { at: [2, 2], t: "fight", mons: [["bonelord", 1], ["skeleton", 5]], once: "b3boss", reward: { item: "lsword1", gold: 600 }, text: "骸骨の騎士が、朽ちた剣を掲げて立ち上がった！" },
      { at: [5, 10], t: "msg", text: "錆びついた錠前の扉だ。鍵がかかっている。\n扉には、へたくそな字の札が打ちつけてある。\n『ここから　コボルドの王さまの　なわばり。\n　かぎは　ひとつ上の階の　王さまが　もってる』", noStep: true, dir: "S" },
      { at: [16, 16], t: "treasure", once: "b3t1", item: "sc_sleep", gold: 300 },
    ],
  },
  { // B4
    name: "番兵の詰所", seed: 4404, loops: 0.1, encRate: 0.05,
    sections: { A: [0, 0, 9, 9], B: [0, 10, 9, 19], C: [10, 10, 19, 19], D: [10, 0, 19, 9] },
    links: [ { a: "A", b: "B", type: "door", at: [5, 9, "N"] }, { a: "B", b: "C", type: "door", at: [9, 12, "E"] },
             { a: "C", b: "D", type: "door", at: [17, 10, "S"] }, { a: "A", b: "D", type: "secret", at: [9, 6, "E"] } ],
    rooms: [ { id: "g1", r: [11, 11, 13, 13] }, { id: "g2", r: [16, 11, 18, 13] }, { id: "g3", r: [11, 16, 13, 18] }, { id: "g4", r: [16, 16, 18, 18] }, { r: [3, 3, 5, 5] } ],
    up: [0, 0], down: [19, 19], elev: [15, 4],
    hidden: [{ at: [4, 16], gold: 860 }, { at: [7, 1], item: "sc_sleep" }, { at: [16, 9], item: "leather2" }, { at: [2, 5], item: "antidote" }],
    ev: [
      { at: [10, 12], t: "msg", text: "扉の上に古い刻印がある。\n『封印の番兵詰所 ― 許しなき者は通さぬ』" },
      { at: [12, 12], t: "fight", mons: [["guard", 4], ["mage", 2]], once: "b4g1", text: "詰所の番兵たちが槍を構えた！" },
      { at: [17, 12], t: "fight", mons: [["gargoyle", 3], ["guard", 3]], once: "b4g2", reward: { gold: 1200 } },
      { at: [12, 17], t: "fight", mons: [["ogre", 3], ["werewolf", 3]], once: "b4g3", reward: { item: "helm1" } },
      { at: [17, 17], t: "fight", mons: [["watcher", 1], ["guard", 4], ["hellhound", 3]], once: "b4boss", reward: { key: "shard1", gold: 2000 }, text: "兜の大男が大剣を抜いた。\n「封印の欠片は誰にも渡さん。灰の司祭にも、お前たちにもな」" },
      { at: [14, 14], t: "alarm" }, { at: [15, 15], t: "alarm" }, { at: [11, 15], t: "alarm" },
    ],
  },
  { // B5
    name: "蒼き紋の迷宮", seed: 5505, loops: 0.12, encRate: 0.05,
    sections: { A: [5, 5, 14, 14], B: [0, 0, 19, 4], C: [0, 15, 19, 19], D: [0, 5, 4, 14], E: [15, 5, 19, 14] },
    links: [ { a: "A", b: "B", type: "door", at: [9, 5, "S"] }, { a: "A", b: "D", type: "door", at: [5, 9, "W"] },
             { a: "D", b: "C", type: "door", at: [2, 14, "N"] }, { a: "B", b: "D", type: "door", at: [1, 4, "N"] } ],
    rooms: [ { id: "fox", r: [8, 16, 11, 18] }, { r: [8, 8, 11, 11] }, { r: [15, 1, 17, 3] } ],
    up: [19, 19], down: [19, 9], elev: [10, 10],
    hidden: [{ at: [17, 4], gold: 1310 }, { at: [5, 5], item: "potion2" }, { at: [12, 2], item: "sceptre" }, { at: [15, 16], item: "sc_ice" }],
    tele: [ { at: [18, 17], to: [17, 6] }, { at: [3, 12], to: [18, 2] }, { at: [16, 2], to: [6, 13] }, { at: [13, 17], to: [1, 1] }, { at: [6, 6], to: [16, 18] }, { at: [15, 13], to: [7, 7] } ],
    ev: [
      { at: [9, 17], t: "fight", mons: [["foxlord", 1], ["bladefox", 6]], once: "b5boss", reward: { key: "windcharm", gold: 1500 }, text: "尾が刃のように光る狐たちが、音もなくこちらを取り囲んだ！" },
      { at: [18, 16], t: "msg", text: "壁の青白い紋様が、かすかに脈打っている。" },
      { at: [17, 7], t: "msg", text: "奇妙な転移の感覚があった。東側の隔絶された区画のようだ。" },
      { at: [9, 9], t: "treasure", once: "b5t1", item: "potion2", gold: 800 },
    ],
  },
  { // B6
    name: "石像の広間", seed: 6606, loops: 0.12, encRate: 0.05,
    sections: { A: [15, 0, 19, 19], B: [5, 0, 14, 19], C: [0, 0, 4, 19] },
    links: [ { a: "A", b: "B", type: "door", at: [15, 9, "W"] }, { a: "A", b: "B", type: "door", at: [15, 17, "W"] },
             { a: "B", b: "C", type: "lock", req: "windcharm", at: [5, 10, "W"] } ],
    rooms: [ { id: "medusa", r: [1, 15, 3, 17] }, { r: [8, 8, 11, 12] }, { r: [16, 2, 18, 4] } ],
    up: [19, 9], down: [0, 19], elev: [10, 3],
    hidden: [{ at: [17, 1], gold: 1860 }, { at: [4, 15], item: "potion2" }, { at: [12, 17], item: "shield3" }, { at: [13, 9], item: "sc_ice" }],
    zones: [ { t: "anti", r: [7, 13, 12, 18] } ],
    ev: [
      { at: [9, 10], t: "msg", text: "広間には無数の石像が並んでいる。\nどれも恐怖に歪んだ顔をしている……。" },
      { at: [5, 10], t: "msg", text: "激しい突風の壁が道を塞いでいる。\n台座に、護符をはめ込むくぼみがある。\n台座の銘：『風を鎮める護符は、ひとつ上の層、刃の尾を持つ狐の長に預ける』", noStep: true, dir: "W" },
      { at: [2, 16], t: "fight", mons: [["medusa", 3], ["golem", 2]], once: "b6boss", reward: { key: ["shard2", "sluicekey"], gold: 2500 }, text: "蛇の髪を持つ女たちが、一斉にこちらを振り向いた！" },
      { at: [10, 15], t: "msg", text: "空気が澱んでいる。ここでは呪文が使えないようだ。" },
      { at: [17, 3], t: "treasure", once: "b6t1", item: "ringprot", gold: 1000 },
    ],
  },
  { // B7
    name: "泥濘の底", seed: 7707, loops: 0.12, encRate: 0.05,
    sections: { A: [0, 10, 9, 19], B: [0, 0, 9, 9], C: [10, 0, 19, 19] },
    links: [ { a: "A", b: "B", type: "door", at: [4, 10, "S"] }, { a: "B", b: "C", type: "lock", req: "sluicekey", at: [9, 5, "E"] } ],
    rooms: [ { id: "swamp", r: [14, 14, 17, 17] }, { r: [2, 14, 4, 16] }, { r: [12, 3, 14, 5] } ],
    up: [0, 19], down: [19, 0], elev: [12, 10],
    hidden: [{ at: [16, 19], gold: 2510 }, { at: [6, 12], item: "sc_escape" }, { at: [14, 13], item: "plate3" }, { at: [0, 10], item: "potion2" }],
    zones: [ { t: "swamp", r: [0, 0, 8, 8] }, { t: "swamp", r: [11, 11, 13, 17] } ],
    ev: [
      { at: [3, 15], t: "fountain", text: "澄んだ泉が湧いている。" },
      { at: [4, 9], t: "msg", text: "足元がぬかるむ。\n黒い泥が、靴にねっとりとまとわりつく……" },
      { at: [9, 5], t: "msg", text: "錆びた水門だ。鍵がかかっている。\n水門の柱に、震える字の走り書きが残っている。\n『鍵を持ったまま、ひとつ上の石像の広間へ逃げてしまった。\n　あの女たちの目を見てはいけない……』", noStep: true, dir: "E" },
      { at: [15, 15], t: "fight", mons: [["swampking", 1], ["wyvern", 2]], once: "b7boss", reward: { item: "plate2", gold: 4000 }, text: "沼の底から、巨大な影が浮かび上がった！" },
      { at: [13, 4], t: "treasure", once: "b7t1", item: "potion3", gold: 2000 },
    ],
  },
  { // B8
    name: "ひび割れた深層", seed: 8808, loops: 0.15, encRate: 0.05,
    sections: { A: [0, 0, 19, 15], B: [0, 16, 19, 19] },
    links: [ { a: "A", b: "B", type: "lock", req: "shard3", at: [10, 15, "N"] } ],
    rooms: [ { id: "vault", r: [1, 1, 3, 3] }, { r: [8, 6, 11, 9] }, { r: [15, 10, 17, 12] } ],
    up: [19, 0], down: [0, 19], elev: [15, 5],
    hidden: [{ at: [8, 10], gold: 3260 }, { at: [14, 11], item: "potion3" }, { at: [1, 10], item: "shieldev" }, { at: [12, 6], item: "sc_ice" }],
    pits: [[12, 3], [6, 6], [16, 8], [3, 10], [9, 13], [14, 13], [4, 4]],
    chutes: [[10, 12], [4, 14]],
    ev: [
      { at: [18, 0], t: "msg", text: "足元の岩盤に、無数のひびが走っている。" },
      { at: [2, 2], t: "fight", mons: [["firekeeper", 1], ["firegiant", 2], ["hellhound", 4]], once: "b8boss", reward: { key: "shard3", gold: 5000 }, text: "宝物庫の前に、炎をまとった巨人が立ちはだかる！" },
      { at: [10, 15], t: "msg", text: "欠けた紋章が刻まれた大扉だ。\n紋章にぴったり合う何かが必要らしい。\n扉の銘：『第三の欠片は、この層の南西、宝物庫にて火守りが守る』", noStep: true, dir: "N" },
      { at: [16, 11], t: "treasure", once: "b8t1", item: "gloves2", gold: 3000 },
    ],
  },
  { // B9
    name: "黒曜の回廊", seed: 9909, loops: 0.13, encRate: 0.05,
    sections: { A: [0, 10, 19, 19], B: [0, 0, 19, 9] },
    links: [ { a: "A", b: "B", type: "riddle", at: [15, 10, "S"] } ],
    rooms: [ { id: "sphinx", r: [13, 12, 17, 15] }, { r: [3, 4, 5, 6] }, { r: [10, 2, 12, 4] } ],
    up: [0, 19], down: [19, 0], elev: [5, 15],
    hidden: [{ at: [3, 19], gold: 4110 }, { at: [18, 15], item: "potion3" }, { at: [9, 8], item: "chain3" }, { at: [0, 9], item: "sc_escape" }],
    spin: [[8, 16], [12, 18], [3, 12], [17, 18]],
    zones: [ { t: "dark", r: [0, 10, 9, 14] }, { t: "dark", r: [6, 0, 13, 7] } ],
    ev: [
      { at: [15, 13], t: "fight", mons: [["sphinx", 1]], once: "b9sph", text: "獅子の体を持つ怪物が道を塞いでいる。\n「我が問いに答えよ。さもなくば力を示せ」" },
      { at: [15, 11], t: "msg", text: "南の扉には口のような彫刻がある。\n謎に答えれば扉は開くという。" },
      { at: [4, 5], t: "treasure", once: "b9t1", item: "amuletgem", gold: 5000 },
    ],
  },
  { // B10
    name: "封印の間", seed: 10110, loops: 0.08, encRate: 0.04, noTele: true,
    sections: { A: [12, 0, 19, 7], B: [0, 0, 11, 7], C: [0, 8, 19, 13], D: [0, 14, 19, 19] },
    links: [ { a: "A", b: "B", type: "door", at: [12, 4, "W"] }, { a: "B", b: "C", type: "door", at: [3, 7, "N"] },
             { a: "C", b: "D", type: "lock", req: "shards", at: [16, 13, "N"] } ],
    rooms: [ { id: "r1", r: [4, 2, 7, 5] }, { id: "r2", r: [14, 9, 18, 12] }, { id: "altar", r: [7, 15, 12, 18] } ],
    up: [19, 0], down: null, elev: null,
    hidden: [{ at: [7, 9], gold: 5060 }, { at: [12, 14], item: "potion3" }, { at: [10, 0], item: "amuletgem" }, { at: [18, 18], item: "potion3" }],
    zones: [ { t: "anti", r: [13, 14, 19, 19] } ],
    ev: [
      { at: [19, 1], t: "msg", text: "空気が張りつめている。\nここが封印の最深部――星喰いの眠る場所だ。" },
      { at: [5, 3], t: "fight", mons: [["royalguard", 4], ["archmage", 2]], once: "b10a", reward: { gold: 8000 }, text: "灰色の鎧の兵士たちが整列している。\n「司祭様の儀式を邪魔させるな！」" },
      { at: [16, 10], t: "fight", mons: [["vlord", 1], ["vampire", 4]], once: "b10c", reward: { gold: 10000, item: "murasama" }, text: "闇の中から、優雅な身なりの男が現れた。\n「司祭殿に雇われた身でね。悪いが、ここは通せない」" },
      { at: [16, 13], t: "msg", text: "三つの紋章が刻まれた、封印の扉だ。\n扉の銘：『三つの欠片は、四・六・八の層の番人に守らせる』\n封印の欠片を三つそろえれば開くだろう。", noStep: true, dir: "N" },
      { at: [16, 14], t: "msg", text: "この一帯には、呪文を封じる結界が張られている！\n祭壇の間は西の方角だ……。" },
      { at: [9, 16], t: "boss", mons: [["morvan", 1], ["demonlord", 2], ["royalguard", 4]], once: "b10boss", reward: { key: "starlamp" } },
    ],
  },
];

/* 謎かけ（地下9階） */
const RIDDLES = [
  { q: "朝は四本、昼は二本、夕べは三本の足で歩くもの。\nそれは何か？", a: ["にんげん", "人間", "ひと", "人", "ニンゲン", "ヒト"] },
];

const DATA = { STATS, STAT_NAMES, RACES, ALIGNS, CLASSES, CLASS_ORDER, CLASS_LETTER, expForLevel, SPELLS, SPELL,
  ITEMS, ITEM, SHOP_BASE, KEYITEMS, MONSTERS, MONSTER, TRAPS, FLOORS, RIDDLES };
if (typeof module !== "undefined" && module.exports) module.exports = DATA; else G.WD = DATA;
})(typeof window !== "undefined" ? window : globalThis);
