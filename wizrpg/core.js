/* 星灯の迷宮 — 共通処理（乱数・キャラクター・セーブ・効果音・画面部品） */
"use strict";
const { STATS, STAT_NAMES, RACES, ALIGNS, CLASSES, CLASS_ORDER, CLASS_LETTER, expForLevel, SPELLS, SPELL,
  ITEMS, ITEM, SHOP_BASE, KEYITEMS, MONSTERS, MONSTER, TRAPS, FLOORS, RIDDLES } = WD;
const { DX, DY, E_OPEN, E_WALL, E_DOOR, E_SECRET, E_LOCK, E_RIDDLE } = MAZE;

/* ────────── 小道具 ────────── */
const $ = id => document.getElementById(id);
const rand = n => Math.floor(Math.random() * n);
const rr = (a, b) => a + rand(b - a + 1);
const chance = p => Math.random() < p;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[rand(arr.length)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  .replace(/([―…])(?=[―…])/g, "$1⁠"); // 禁則：「――」「……」の途中で行が分かれないよう、間に改行させない印（ワードジョイナー）を入れる
function dice(str) { // "3d6+2" を振る
  const m = /^(\d+)(?:d(\d+))?([+-]\d+)?$/.exec(String(str).trim());
  if (!m) return 0;
  const n = +m[1], s = m[2] ? +m[2] : 0, b = m[3] ? +m[3] : 0;
  if (!s) return n + b;
  let t = 0; for (let i = 0; i < n; i++) t += 1 + rand(s);
  return t + b;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 演出のアニメーション：T ミリ秒かけて draw(p)（p＝0〜1）を呼ぶ。
   画面の描き替えが止まっていても（見えていない画面・省電力など）、時間が来たら最後の絵を描いて必ず終わる（演出で遊びが止まらないように） */
function animate(T, draw) {
  return new Promise(res => {
    const t0 = performance.now(); let done = false;
    const finish = () => { if (done) return; done = true; try { draw(1); } catch (e) { } res(); };
    const frame = () => { if (done) return; const p = Math.min(1, (performance.now() - t0) / T); draw(p); if (p < 1) requestAnimationFrame(frame); else finish(); };
    requestAnimationFrame(frame);
    setTimeout(finish, T + 400);
  });
}

/* ────────── 効果音 ──────────
   戦闘・呪文・罠などの音は wizrpg/se/ のファイルで鳴らす。決定・取り消し・足音・勝利などの操作の音は、WebAudioでその場で合成する
   （ファイルが要らないので、どこに置いても同じ音が鳴る）。ファイルを読み込めなかった音も、合成した音で代わりにする。
   ミュートの設定は、あそびコレクションのほかのゲームと共通（localStorage の asobi_muted）。 */
// 指で操作する端末（スマホ・タブレット）か。音まわりの軽い設定に使う
const IS_TOUCH = (() => { try { return matchMedia("(pointer:coarse)").matches; } catch (e) { return false; } })();
const Snd = (() => {
  let ctx = null;
  const muted = () => { try { return localStorage.getItem("asobi_muted") === "1"; } catch (e) { return false; } };
  // スマホ・タブレットでは、音の出力の余裕を大きめにとる（"playback"）。BGMの途切れが減る代わりに、効果音がほんの少し遅れる
  function ac() { if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; try { ctx = IS_TOUCH ? new AC({ latencyHint: "playback" }) : new AC(); } catch (e) { try { ctx = new AC(); } catch (e2) { } } } if (ctx && ctx.state === "suspended" && !document.hidden) ctx.resume(); return ctx; }
  // 別のタブに切り替えた・最小化した・スマホでホームに戻ったときは音を一時停止し、戻ったら続きから鳴らす
  document.addEventListener("visibilitychange", () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });
  function tone(freq, dur, type = "square", vol = 0.08, slide = 0, delay = 0) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol = 0.12, hp = 800, delay = 0) {
    const c = ac(); if (!c) return;
    const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = "highpass"; f.frequency.value = hp; g.gain.value = vol;
    s.buffer = b; s.connect(f); f.connect(g); g.connect(c.destination); s.start(c.currentTime + delay);
  }
  const synth = {
    click: () => tone(880, 0.06, "square", 0.05),
    move: () => tone(660, 0.04, "square", 0.03),
    cancel: () => tone(330, 0.08, "square", 0.05),
    walk: () => noise(0.06, 0.05, 1500),
    bump: () => { tone(90, 0.12, "sawtooth", 0.12, -40); noise(0.08, 0.1, 200); },
    door: () => { tone(180, 0.15, "triangle", 0.1, -60); noise(0.12, 0.06, 400); },
    // 水滴が落ちる「ポチャン」（地下水路などの環境音）
    drip: () => { tone(1500, 0.09, "sine", 0.045, -1000); tone(2300, 0.05, "sine", 0.02, -1300, 0.035); },
    // 昇降機が止まったときの「ガチャン」：低い衝撃音に、金属が当たる高い音を重ねる
    clank: () => { noise(0.16, 0.26, 220); tone(130, 0.2, "square", 0.09, -50); tone(1250, 0.07, "square", 0.035, -500, 0.02); tone(780, 0.12, "triangle", 0.05, -220, 0.06); noise(0.05, 0.12, 2500, 0.07); },
    hit: () => { noise(0.1, 0.16, 600); tone(160, 0.08, "square", 0.06, -80); },
    miss: () => tone(1200, 0.06, "sine", 0.03, -600),
    hurt: () => { noise(0.15, 0.2, 300); tone(120, 0.15, "sawtooth", 0.08, -60); },
    crit: () => { noise(0.2, 0.25, 300); tone(80, 0.3, "sawtooth", 0.12, -40); },
    behead: () => { noise(0.2, 0.25, 300); tone(80, 0.3, "sawtooth", 0.12, -40); },
    magic: () => { for (let i = 0; i < 5; i++) tone(500 + i * 180, 0.12, "sine", 0.05, 200, i * 0.04); },
    fire: () => { noise(0.4, 0.2, 200); tone(200, 0.35, "sawtooth", 0.05, -120); },
    cold: () => { for (let i = 0; i < 6; i++) tone(1400 + rand(800), 0.1, "triangle", 0.035, 0, i * 0.05); },
    heal: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "sine", 0.06, 0, i * 0.07)); },
    enc: () => { tone(220, 0.15, "square", 0.08); tone(233, 0.15, "square", 0.08, 0, 0.16); tone(247, 0.3, "square", 0.08, 0, 0.32); },
    win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, "square", 0.05, 0, i * 0.12)); },
    lose: () => { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.35, "triangle", 0.08, 0, i * 0.3)); },
    levelup: () => { [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, "square", 0.05, 0, i * 0.09)); },
    chest: () => { tone(300, 0.1, "square", 0.06); tone(600, 0.2, "square", 0.05, 0, 0.1); },
    trap: () => { noise(0.3, 0.25, 200); tone(100, 0.4, "sawtooth", 0.1, -50); },
    boom: () => { noise(0.6, 0.35, 60); tone(60, 0.5, "sawtooth", 0.15, -30); },
    stairs: () => { [300, 350, 400, 450].forEach((f, i) => tone(f, 0.08, "triangle", 0.06, 0, i * 0.08)); },
    fall: () => tone(800, 0.6, "sine", 0.08, -700),
    tele: () => { for (let i = 0; i < 8; i++) tone(300 + i * 150, 0.08, "sine", 0.05, 0, i * 0.03); },
    buy: () => { tone(1200, 0.08, "square", 0.04); tone(1600, 0.12, "square", 0.04, 0, 0.08); },
    sparkle: () => { for (let i = 0; i < 6; i++) tone(1500 + i * 250, 0.1, "sine", 0.03, 0, i * 0.05); },
  };
  /* 戦闘用の効果音（効果音ラボ）。wizrpg/se/ に入っている。配列は鳴らすたびにランダムで選ぶ。
     古い名前（hit・hurt・fire など）もここで新しい音に振り替える */
  const SE = {
    // 味方の攻撃（武器の種類で鳴らし分け）
    sword: ["sword1", "sword2", "sword3"], katana: ["katana1", "katana2"], axe: ["axe1", "axe2"], blunt: ["blunt1", "blunt2"],
    dagger: ["dagger1", "dagger2"], fist: ["fist1", "fist2"], hit: ["sword1", "sword2", "sword3"],
    miss: ["swing", "swing2"], crit: "behead", axecrit: "behead", kill: "kill",
    // 敵の攻撃
    block: "dodge", hurt: ["hurt1", "hurt2", "hurt3"], ecrit: "behead", death: "death",
    breath_fire: "breath_fire", breath_ice: "breath_ice", breath_gas: "breath_gas",
    poison: "poison", stone: "stone", para: "para", leveldrain: "leveldrain", call: "call", roar_dragon: "roar_dragon", flee: "flee",
    // 呪文
    cast: "cast", fire_s: "fire_s", fire_m: "fire_m", fire_l: "fire_l", ice_s: "ice_s", ice_m: "ice_m", ice_l: "ice_l",
    thunder: "thunder", thunder_l: "thunder_l", nuke: "nuke", fire: "fire_m", cold: "ice_m",
    heal: "heal_s", heal_m: "heal_m", heal_l: "heal_l", raise: "raise", cure_poison: "cure_poison", cure_all: "cure_all",
    buff: "buff", buff_party: "buff_party", shield: "shield", debuff: "debuff", sleep: "sleep", darkspell: "darkspell", holy: "holy",
    drainspell: "drainspell", tele: "warp", light: "light",
    // 罠・迷宮
    stairs: "stairs", door: "door", elevator: "elevator", drip: "drip", clank: "clank",
    potion_l: "heal_l", // 上等な回復薬（呪文の大回復と同じ音を短くして使う）
    encounter: "encounter", chest: "chest", trap_arrow: "trap_arrow", trap_needle: "trap_needle", trap_bomb: "explosion", trap_stun: "trap_stun", land: "land", rumble: "rumble",
  };
  const base = (() => { const s = document.currentScript && document.currentScript.src; return s ? s.replace(/core\.js(\?.*)?$/, "") : "wizrpg/"; })();
  /* 長すぎる音は、この秒数で最後を短くフェードアウトして止める（戦闘のテンポを崩さないため）。
     書いていない音は最後まで鳴らす。 */
  const MAXLEN = {
    rumble: 3.0, heal_l: 1.8, nuke: 2.2, para: 1.4, holy: 1.8, darkspell: 1.8, breath_ice: 1.6, fire_l: 1.8,
    heal_m: 1.5, cast: 0.9, breath_fire: 1.8, fire_m: 1.6, ice_m: 1.5, sleep: 1.3, drainspell: 1.5, thunder_l: 1.7,
    ice_l: 1.6, leveldrain: 1.5, stone: 1.5, behead: 1.4, breath_gas: 1.4, cure_poison: 1.3, ice_s: 1.2, cure_all: 1.3,
    heal_s: 1.3, trap_bomb: 1.5, explosion: 2.0, buff: 1.2, buff_party: 1.2, debuff: 1.2, roar_dragon: 1.6,
  };
  const FADE = 0.35;
  // 鳴らす名前ごとに長さ・フェードを変える [長さ, フェードの長さ]
  const CUT = { potion_l: [1.2, 0.6], stairs: [1.5, 0.6] }; // 大回復の音は6.2秒・階段の足音は5.5秒あるので短くする
  const buf = {}, bad = {}, loading = {};
  // WebAudio用に音を読み込んでおく（読み込み前に鳴らした時は、下のHTMLAudioで代わりに鳴らす）
  const isFile = location.protocol === "file:"; // ファイルを直接開いた時（この時は下のHTMLAudioで鳴らす）
  function load(key) {
    const c = ac();
    if (isFile || !c || buf[key] || loading[key] || bad[key]) return;
    loading[key] = fetch(`${base}se/${key}.mp3`).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(ab => new Promise((ok, ng) => c.decodeAudioData(ab, ok, ng)))
      .then(b => { buf[key] = b; }).catch(() => { loading[key] = null; });
  }
  function preloadAll() { for (const v of Object.values(SE)) for (const k of [].concat(v)) load(k); }
  function playFile(key, vol, cut) {
    if (bad[key]) return false;
    vol = vol || 0.7;
    const max = cut ? cut[0] : MAXLEN[key], fade = cut ? cut[1] : FADE;
    const c = ac();
    if (c && buf[key]) {
      const src = c.createBufferSource(), g = c.createGain(), t0 = c.currentTime;
      src.buffer = buf[key]; src.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(vol, t0);
      if (max && buf[key].duration > max) {
        // 耳に自然なように、音量をなめらかに（指数的に）絞ってから止める
        g.gain.setValueAtTime(vol, t0 + max - fade);
        g.gain.setTargetAtTime(0.0001, t0 + max - fade, fade / 3.5);
        src.start(t0); src.stop(t0 + max + 0.05);
      } else src.start(t0);
      return true;
    }
    load(key);
    // まだ読み込めていない時の代わり（長い音は時間で止める）
    const a = new Audio(`${base}se/${key}.mp3`);
    a.onerror = () => { bad[key] = 1; };
    a.volume = vol;
    const p = a.play(); if (p && p.catch) p.catch(() => { });
    if (max) {
      // ファイルを直接開いたとき用：少しずつ音量を下げてから止める
      setTimeout(() => { const steps = 8; let i = 0; const iv = setInterval(() => { i++; a.volume = Math.max(0, vol * (1 - i / steps)); if (i >= steps) { clearInterval(iv); try { a.pause(); } catch (e) { } } }, fade * 1000 / steps); }, Math.max(0, max - fade) * 1000);
    }
    return true;
  }
  function play(name) {
    if (muted()) return;
    ac();
    const se = SE[name];
    if (se && playFile(Array.isArray(se) ? se[rand(se.length)] : se, 0, CUT[name])) return;
    if (synth[name]) try { synth[name](); } catch (e) { }
  }
  return { play, muted, ac, preloadAll };
})();
/* 道具を使ったときに、呪文とは別の音にしたいもの */
const ITEM_SND = { potion2: "potion_l" };
/* 呪文ごとの効果音（効果音ラボの音に対応するキー） */
const SPELL_SND = {
  firebolt: "fire_s", flamestorm: "fire_m", inferno: "fire_l", firepillar: "fire_m",
  blizzard: "ice_m", deepfreeze: "ice_l", sparkrain: "thunder", judgment: "thunder_l", cataclysm: "nuke",
  sleepcloud: "sleep", darkveil: "debuff", hush: "debuff", smite: "debuff", greatsmite: "debuff",
  airless: "darkspell", annihilate: "darkspell", deathword: "darkspell", unmake: "holy", drainlife: "drainspell",
  magearmor: "buff", phantom: "buff", lightshield: "shield", guardprayer: "buff_party", holyguard: "buff_party", wardprayer: "buff_party",
  mend: "heal", mend2: "heal_m", mend3: "heal_l", fullmend: "heal_l", purify: "cure_poison", awaken: "cure_all",
  revive: "raise", resurrect: "raise", glow: "light", radiance: "light", farsight: "light", trueseeing: "light", trapsense: "light",
  homeward: "tele", phasestep: "tele",
};
/* 武器の種類ごとの打撃音 */
function weaponSnd(wd) {
  if (!wd) return "fist";
  if (["dagger", "dagger1", "shuriken"].includes(wd.id)) return "dagger";
  if (wd.id === "oborozuki") return "katana";
  if (["baxe", "axecur", "holyaxe"].includes(wd.id)) return "axe";
  if (["staff", "mace", "mace1", "mace2", "flamestaff", "sceptre"].includes(wd.id)) return "blunt";
  return "sword";
}
/* 回復量。呪文は術者のレベルに比例して伸び、薬は飲む人の最大HPに対する割合で回復する
   （固定値だと、レベルが上がるほど回復が役に立たなくなるため） */
// cap：回復量の上限（レベルが上がるほど上限まで回復することが多くなる。小・中・大の差が縮まらないように）
const HEAL_SPELL = { mend: { dice: "1d8+4", per: 2, cap: 40 }, mend2: { dice: "3d8+10", per: 3, cap: 90 }, mend3: { dice: "6d8+20", per: 4, cap: 150 } };
const HEAL_ITEM = { potion: { dice: "2d8+6", pct: 0.3, cap: 40 }, potion2: { dice: "6d8+20", pct: 0.6, cap: 150 } };
function healAmount(sp, caster, target, itemId) {
  const it = itemId && HEAL_ITEM[itemId];
  if (it) return Math.min(it.cap, Math.max(dice(it.dice), Math.round(target.maxhp * it.pct)));
  const h = HEAL_SPELL[sp.id];
  if (!h) return dice(sp.dice || "1d8");
  return Math.min(h.cap, dice(h.dice) + h.per * caster.lvl); // 魔力の宿った道具（錫杖など）は使う人のレベルで計算
}
/* ────────── BGM ──────────
   WebAudioで再生し、曲の中の「ループ開始〜ループ終了」だけを継ぎ目なく繰り返す。
   （頭のイントロは最初の1回だけ流れる。MP3の先頭の無音や、曲の終わり方でループが途切れない）
   MP3は曲の中の「ループ開始〜ループ終了」、MIDIは曲の中のループの印から終わりまでを繰り返す。 */
const BGM_LIST = {
  // すべて魔王魂のMIDI。曲の中のループの印（CC111）から曲の終わりまでを繰り返す（とても軽い）
  // vol は曲ごとの音の大きさの差をならすための値（静かな曲は少し大きめ）
  battle: { midi: "maou_game_battle19.mid", vol: 0.4 },     // 戦闘：とても速く激しい（テンポ280・歪んだギター）
  boss: { midi: "maou_game_battle18.mid", vol: 0.4 },       // 各階の番人との戦い：短調で激しい
  lastboss: { midi: "maou_game_battle20.mid", vol: 0.4 },   // 最後の戦い（灰の司祭モルヴァン）：音数が最も多い
  wipe: { midi: "maou_game_event38.mid", vol: 0.45 },      // 全滅したとき
  town: { midi: "maou_game_town25b.mid", vol: 0.42 },       // 町：ゆったりした長調・ピチカートと鉄琴
  dangeon01: { midi: "maou_game_dangeon01.mid", vol: 0.46 }, // 高い音域・ハープと合唱：神秘的
  dangeon02: { midi: "maou_game_dangeon02.mid", vol: 0.42 }, // 中くらいの速さ・歪んだギター：重苦しい
  dangeon03: { midi: "maou_game_dangeon03.mid", vol: 0.6 },  // 打楽器ほぼ無し・ギター：落ち着いた歩み
  dangeon04: { midi: "maou_game_dangeon04.mid", vol: 0.42 }, // 速い・ピチカートと打楽器：緊張・行進
  dangeon05: { midi: "maou_game_dangeon05.mid", vol: 0.42 }, // 遅く力強い・金管：重厚
  dangeon06: { midi: "maou_game_dangeon06.mid", vol: 0.4 },  // 速く音が多い・歪んだギター：激しい
  dangeon09: { midi: "maou_game_dangeon09.mid", vol: 0.42 }, // 音がまばらで調がはっきりしない：不思議
  dangeon10: { midi: "maou_game_dangeon10.mid", vol: 0.42 }, // 低音が多い・合唱：暗く不穏
  dangeon13: { midi: "maou_game_dangeon13.mid", vol: 0.5 },  // 柔らかく細かい音：流れるよう
  dangeon23: { midi: "maou_game_dangeon23.mid", vol: 0.85 }, // テンポが揺れる・打楽器無し：荘厳・物悲しい
};
// 階ごとの迷宮BGM（各階のテーマと曲の雰囲気を合わせている）
const FLOOR_BGM = [null,
  "dangeon03", // 地下1階 旧坑道：冒険の始まり。落ち着いた歩み
  "dangeon13", // 地下2階 地下水路：水の流れ
  "dangeon09", // 地下3階 石板の回廊：方向を見失う不思議さ
  "dangeon04", // 地下4階 番兵の詰所：見回りの緊張感
  "dangeon01", // 地下5階 蒼き紋の迷宮：魔法の空間
  "dangeon05", // 地下6階 石像の広間：重く静まり返った広間
  "dangeon02", // 地下7階 泥濘の底：まとわりつく重苦しさ
  "dangeon06", // 地下8階 ひび割れた深層：落下の危険と激しさ
  "dangeon10", // 地下9階 黒曜の回廊：暗く不穏
  "dangeon23", // 地下10階 封印の間：聖域の荘厳さ
];
const floorBgm = f => FLOOR_BGM[f] || "dangeon03";
const Bgm = (() => {
  const data = {}, loading = {};
  let cur = null; // { key, src, gain } または { key, midi }
  const muted = () => Snd.muted() || (S && S.bgmOff);
  function load(key) {
    const c = Snd.ac(), d = BGM_LIST[key];
    if (!c || !d) return Promise.resolve(null);
    if (data[key]) return Promise.resolve(data[key]);
    const embedded = d.midi && window.BGM_DATA && window.BGM_DATA[d.midi];
    const getBytes = embedded
      ? Promise.resolve(Uint8Array.from(atob(embedded), ch => ch.charCodeAt(0)).buffer)
      : fetch(`wizrpg/bgm/${d.midi || d.file}`).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); });
    if (!loading[key]) loading[key] = getBytes
      .then(ab => d.midi ? MidiPlayer.parse(ab) : new Promise((ok, ng) => c.decodeAudioData(ab, ok, ng)))
      .then(x => (data[key] = x)).catch(() => { loading[key] = null; return null; });
    return loading[key];
  }
  async function play(key) {
    if (cur && cur.key === key) return;
    stop(0.5);
    const d = BGM_LIST[key];
    const token = cur = { key };
    const x = await load(key);
    const c = Snd.ac();
    if (!x || !c || cur !== token) return; // 読み込み中に止められた・別の曲に変わった
    const vol = muted() ? 0.0001 : d.vol;
    if (d.midi) {
      token.midi = MidiPlayer.create(c, x, c.destination, 0.35, IS_TOUCH);
      token.midi.start(0.4, vol);
      return;
    }
    const src = c.createBufferSource(), gain = c.createGain();
    src.buffer = x; src.loop = true;
    src.loopStart = d.loopStart; src.loopEnd = Math.min(d.loopEnd, x.duration);
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.linearRampToValueAtTime(vol, c.currentTime + 0.25);
    src.connect(gain); gain.connect(c.destination);
    src.start();
    token.src = src; token.gain = gain;
  }
  function stop(fade = 0.6) {
    const t = cur; cur = null;
    if (!t) return;
    if (t.midi) { t.midi.stop(fade); return; }
    if (!t.src) return;
    const c = Snd.ac(), g = t.gain.gain;
    g.cancelScheduledValues(c.currentTime); g.setValueAtTime(g.value, c.currentTime);
    g.linearRampToValueAtTime(0.0001, c.currentTime + fade);
    t.src.stop(c.currentTime + fade + 0.05);
  }
  // ミュートの切り替えを反映
  function sync() {
    if (!cur) return;
    const v = muted() ? 0.0001 : BGM_LIST[cur.key].vol;
    if (cur.midi) { cur.midi.volume(v); return; }
    if (!cur.gain) return;
    const c = Snd.ac(), g = cur.gain.gain;
    g.cancelScheduledValues(c.currentTime); g.setValueAtTime(g.value, c.currentTime);
    g.linearRampToValueAtTime(v, c.currentTime + 0.2);
  }
  return { play, stop, sync, load, current: () => cur && cur.key };
})();

/* 蘇生の儀式の演出。4つの言葉を1行ずつ唱え、最後に結果を見せる（画面タップで早送り）
   result: "ok"＝生き返った / "ash"＝灰になった / "lost"＝消え去った */
async function ritual(name, result) {
  const st = $("stage"), fx = document.createElement("div");
  fx.className = "ritual"; st.appendChild(fx);
  let fast = false; const skip = () => { fast = true; };
  document.addEventListener("pointerdown", skip, true);
  const wait = ms => sleep(fast ? 120 : ms);
  const lines = ["灯をかざし……", "祈りを捧げ……", "聖句を唱え……", "魂よ、還れ！"];
  try {
    for (let i = 0; i < lines.length; i++) {
      const d = document.createElement("div");
      d.className = "rl" + (i === lines.length - 1 ? " last" : "");
      d.textContent = lines[i]; fx.appendChild(d);
      Snd.play(i < lines.length - 1 ? "light" : "holy");
      await wait(i < lines.length - 1 ? 850 : 1200);
    }
    const r = document.createElement("div");
    r.className = "rres " + result;
    r.textContent = result === "ok" ? `${name}は生き返った！` : result === "ash" ? `${name}は灰になった……` : `${name}は消え去った……`;
    fx.classList.add(result === "ok" ? "win" : "fail");
    fx.appendChild(r);
    Snd.play(result === "ok" ? "raise" : "lose");
    vibrate(result === "ok" ? 60 : 250);
    await wait(1500);
  } finally {
    document.removeEventListener("pointerdown", skip, true);
    fx.remove();
  }
}

/* 難易度による料金。本格（コア向け）は高めの値段、救済（カジュアル）は安め */
const isCore = () => !!(S && S.rule === "classic");
function priceOf(id) {
  const d = ITEM[id];
  if (isCore()) { if (d.t === "use") return d.price * 3; if (d.tier >= 1) return d.price * 4; }
  return d.price;
}
/* 駆け出しの支援（救済ルールだけ）：仲間の平均レベルが ROOKIE_LV 以下の間は、宿屋と聖堂が無料になり、
   仲間になった人は回復の薬を3つもらえる。序盤でお金が尽きて詰まないようにするため */
const ROOKIE_LV = 5;
function rookieHelp() {
  if (!S || isCore()) return false;
  const pc = partyChars(); if (!pc.length) return false;
  return pc.reduce((a, c) => a + c.lvl, 0) / pc.length <= ROOKIE_LV;
}
/* 宿屋の部屋。本格は1Gあたりの回復が少ない（何度も泊まる必要がある） */
function innRooms() {
  if (rookieHelp()) return [
    { name: "馬小屋", cost: 0, heal: 0, d: "無料。呪文の回数だけ回復" },
    { name: "簡易寝台", cost: 0, heal: 0.25, d: "無料。HPが1/4回復" },
    { name: "エコノミー", cost: 0, heal: 0.5, d: "無料。HPが半分回復" },
    { name: "スイート", cost: 0, heal: 1, d: "無料。HPが全回復" },
  ];
  if (isCore()) return [
    { name: "馬小屋", cost: 0, heal: 0, d: "無料。呪文の回数だけ回復" },
    { name: "簡易寝台", cost: 10, heal: 0.05, d: "1人10G。HPが少し回復" },
    { name: "エコノミー", cost: 50, heal: 0.15, d: "1人50G。HPが15%回復" },
    { name: "商人の部屋", cost: 200, heal: 0.4, d: "1人200G。HPが40%回復" },
    { name: "貴賓室", cost: 500, heal: 1, d: "1人500G。HPが全回復" },
  ];
  return [
    { name: "馬小屋", cost: 0, heal: 0, d: "無料。呪文の回数だけ回復" },
    { name: "簡易寝台", cost: 10, heal: 0.25, d: "1人10G。HPが1/4回復" },
    { name: "エコノミー", cost: 50, heal: 0.5, d: "1人50G。HPが半分回復" },
    { name: "スイート", cost: 200, heal: 1, d: "1人200G。HPが全回復" },
  ];
}

/* 文字の種類：ドット文字（DotGothic16）か、端末の標準の文字か。見づらい人向けの設定 */
const FONT_KEY = "wizrpg_font";
function uiFont() { try { return localStorage.getItem(FONT_KEY) === "std" ? "std" : "dot"; } catch (e) { return "dot"; } }
function applyFont(v) {
  try { localStorage.setItem(FONT_KEY, v); } catch (e) { }
  document.documentElement.classList.toggle("stdfont", v === "std");
  if (v === "dot" && window.loadDotFont) window.loadDotFont();
  if (document.body.dataset.mode === "maze" && typeof drawView === "function") drawView();
}
const canvasFont = () => uiFont() === "std" ? "sans-serif" : '"DotGothic16", sans-serif';
const fontOptHtml = () => `<h4>文字</h4><div class="spd"><button data-font="dot" class="${uiFont() === "dot" ? "pri" : ""}">ドット</button><button data-font="std" class="${uiFont() === "std" ? "pri" : ""}">標準</button></div>`;
// 設定画面の「文字」ボタンの処理。処理したら true
function fontOptClick(bt, box) {
  if (!bt.dataset.font) return false;
  applyFont(bt.dataset.font);
  box.querySelectorAll("[data-font]").forEach(x => x.classList.toggle("pri", x === bt));
  Snd.play("click");
  return true;
}
/* 迷宮で歩くときの動き：なし／はやい／ふつう（端末ごとに覚える） */
const WALK_KEY = "wizrpg_walk";
function walkSpeed() { try { const v = localStorage.getItem(WALK_KEY); return v === "off" || v === "normal" ? v : "fast"; } catch (e) { return "fast"; } }
const walkOptHtml = () => `<h4>歩く動き</h4><div class="spd">${[["off", "なし"], ["fast", "はやい"], ["normal", "ふつう"]].map(([v, l]) => `<button data-walk="${v}" class="${walkSpeed() === v ? "pri" : ""}">${l}</button>`).join("")}</div>`;
function walkOptClick(bt, box) {
  if (!bt.dataset.walk) return false;
  try { localStorage.setItem(WALK_KEY, bt.dataset.walk); } catch (e) { }
  box.querySelectorAll("[data-walk]").forEach(x => x.classList.toggle("pri", x === bt));
  Snd.play("click");
  return true;
}
/* 呪文の一覧に説明を出すか（出さないと2列の短い一覧になる。端末ごとに覚える） */
const SPELLDESC_KEY = "wizrpg_spelldesc";
function spellDescOn() { try { return localStorage.getItem(SPELLDESC_KEY) !== "off"; } catch (e) { return true; } }
const spellRowHtml = s => `<b>${s.name}</b> <small>${s.sc === "M" ? "魔術" : "僧侶"}Lv${s.lv}${spellDescOn() ? "　" + esc(s.desc) : ""}</small>`;
const spellListOpt = () => spellDescOn() ? {} : { grid2: true };
const spellDescOptHtml = () => `<h4>呪文の説明</h4><div class="spd"><button data-sdesc="on" class="${spellDescOn() ? "pri" : ""}">表示する</button><button data-sdesc="off" class="${spellDescOn() ? "" : "pri"}">表示しない</button></div>`;
function spellDescOptClick(bt, box) {
  if (!bt.dataset.sdesc) return false;
  try { localStorage.setItem(SPELLDESC_KEY, bt.dataset.sdesc); } catch (e) { }
  box.querySelectorAll("[data-sdesc]").forEach(x => x.classList.toggle("pri", x === bt));
  Snd.play("click");
  return true;
}
/* 設定の項目（メッセージ速度・BGM・文字・歩く動き・呪文の説明）。評議会とキャンプの設定で共通に使う。
   settingsHtml() の中身を置いたら、settingsBind(その入れ物) でボタンを働かせる */
function settingsHtml() {
  return `<h4>メッセージ速度</h4><div class="spd">${[0.6, 1, 1.6, 2.5].map(v => `<button data-v="${v}" class="${S.speed === v ? "pri" : ""}">${{ 0.6: "ゆっくり", 1: "ふつう", 1.6: "はやい", 2.5: "最速" }[v]}</button>`).join("")}</div>
    <h4>BGM</h4><div class="spd"><button data-bgm="1" class="${!S.bgmOff ? "pri" : ""}">オン</button><button data-bgm="0" class="${S.bgmOff ? "pri" : ""}">オフ</button></div>${fontOptHtml()}${walkOptHtml()}${spellDescOptHtml()}`;
}
function settingsBind(b) {
  b.querySelectorAll(".spd button").forEach(bt => bt.onclick = () => {
    if (fontOptClick(bt, b) || walkOptClick(bt, b) || spellDescOptClick(bt, b)) return;
    if (bt.dataset.bgm) { S.bgmOff = bt.dataset.bgm === "0"; saveGame(); Bgm.sync(); b.querySelectorAll("[data-bgm]").forEach(x => x.classList.toggle("pri", x === bt)); Snd.play("click"); return; }
    S.speed = +bt.dataset.v; saveGame(); b.querySelectorAll(".spd button[data-v]").forEach(x => x.classList.toggle("pri", x === bt)); Snd.play("click");
  });
}
/* "2d3" や "1d8+2" を「2〜6」「3〜10」の形にする（画面の表示用） */
function diceRange(s) {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(String(s)); if (!m) return String(s);
  const n = +m[1], f = +m[2], b = m[3] ? +m[3] : 0;
  return `${n + b}〜${n * f + b}`;
}
function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

/* ────────── ゲーム状態 ────────── */
/* 記録は3枠。枠1は以前からの保存場所をそのまま使う（枠を増やす前の記録がそのまま枠1になる） */
const SAVE_BASE = "wizrpg_save_v2"; // 物語・迷宮の作り直しに合わせて v2 に変更（v1の記録は引き継がない）
const SAVE_SLOTS = 3;
const SLOT_KEY = "wizrpg_slot"; // 最後に遊んだ枠
const saveKeyOf = n => n === 1 ? SAVE_BASE : SAVE_BASE + "_" + n;
let curSlot = 1;
let S = null; // セーブされる全状態
function newState(rule) {
  return {
    ver: 1, roster: [], party: [], gold: 0, nextId: 1,
    shop: {}, keys: {}, flags: {}, bodies: [], elev: {}, explored: {}, secretsFound: {}, unlocked: {},
    inMaze: false, pos: null, light: 0, identAll: false, deepest: 0, hiddenFound: {}, hiddenSeen: {},
    rule: rule || "classic", cleared: false, book: {}, stats: { battles: 0, kills: 0, deaths: 0, steps: 0, startedAt: Date.now() },
    speed: 1,
  };
}
let saveTimer = null;
function saveGame(now) {
  if (!S) return;
  const doSave = () => { saveTimer = null; try { localStorage.setItem(saveKeyOf(curSlot), JSON.stringify(S)); localStorage.setItem(SLOT_KEY, String(curSlot)); } catch (e) { } };
  if (now) { if (saveTimer) clearTimeout(saveTimer); doSave(); return; }
  if (!saveTimer) saveTimer = setTimeout(doSave, 250);
}
function loadGame(n = curSlot) {
  try { const s = JSON.parse(localStorage.getItem(saveKeyOf(n))); if (s && s.ver === 1) { migrateIds(s); return s; } } catch (e) { }
  return null;
}
/* 古い版の記録に残っている呪文・品物の名前を、今の名前に書き換える。
   古い名前はソースに残さず、名前から計算した番号（idHash）で照合する。今ある名前はそのまま */
const OLD_IDS = { 163997031: "blizzard", 164257137: "darkveil", 164262485: "mend", 164268986: "mend2", 165923830: "alvain", 174513605: "fullmend", 175689162: "deathword", 176746348: "trapsense", 193404649: "revive", 344389585: "annihilate", 359974896: "oborozuki", 383757294: "flamestorm", 400052324: "holyguard", 711561654: "firepillar", 763806932: "glow", 791979446: "resurrect", 1057837394: "judgment", 1067063371: "deepfreeze", 1125889607: "awaken", 1143607995: "hush", 1282327529: "homeward", 1355755471: "inferno", 1463705721: "phasestep", 1464543591: "guardprayer", 1465772410: "magearmor", 1466721129: "sparkrain", 1513080670: "trueseeing", 1524411158: "purify", 1537897839: "gramblade", 1541856624: "airless", 1586562114: "firebolt", 1586570665: "wardprayer", 1851019069: "sleepcloud", 2018126602: "cataclysm", 2170063234: "phantom", 2346929526: "smite", 2346939929: "greatsmite", 2599621573: "lightshield", 2785799223: "radiance", 2795249922: "mend3", 2972873667: "unmake", 3268869216: "farsight", 3357634086: "paladinrobe", 3720433720: "flamestaff", 4222343655: "drainlife" };
const idHash = s => { let x = 5381; for (const c of s) x = ((x * 33) ^ c.charCodeAt(0)) >>> 0; return x; };
function migrateIds(s) {
  const fix = id => (typeof id !== "string" || SPELL[id] || ITEM[id]) ? id : (OLD_IDS[idHash(id)] || id);
  for (const c of s.roster || []) {
    if (c.known) c.known = c.known.map(fix);
    for (const it of c.items || []) it.id = fix(it.id);
  }
  if (s.shop) for (const k of Object.keys(s.shop)) { const n = fix(k); if (n !== k) { s.shop[n] = (s.shop[n] || 0) + s.shop[k]; delete s.shop[k]; } }
}
function lastSlot() {
  try { const n = +localStorage.getItem(SLOT_KEY); if (n >= 1 && n <= SAVE_SLOTS) return n; } catch (e) { }
  return 1;
}

/* ────────── キャラクター ────────── */
const charById = id => S.roster.find(c => c.id === id);
const partyChars = () => S.party.map(charById).filter(Boolean);
const isAlive = c => !["dead", "ash", "lost"].includes(c.status);
const isDisabled = c => ["dead", "ash", "lost", "stone", "para"].includes(c.status);
const STATUS_NAME = { ok: "正常", sleep: "眠り", para: "麻痺", stone: "石化", dead: "死亡", ash: "灰", lost: "消失" };
function statusLabel(c) {
  if (c.status !== "ok") return STATUS_NAME[c.status];
  if (c.poison) return "毒";
  return "";
}
const clsInfo = c => CLASSES[c.cls];
const clsLabel = c => ALIGNS[c.align][0] + "-" + CLASSES[c.cls].ab;

function equipped(c, t) { const it = c.items.find(i => i.eq && ITEM[i.id].t === t); return it || null; }
function computeAC(c, battle) {
  let ac = 10;
  for (const it of c.items) if (it.eq) ac -= (ITEM[it.id].ac || 0);
  if (c.cls === "nin" && !equipped(c, "armor") && !equipped(c, "shield")) ac -= Math.floor(c.lvl / 3) + 2;
  if (battle) ac -= (c.bac || 0);
  return ac;
}
function canEquip(c, itemId) {
  const d = ITEM[itemId];
  if (d.t === "use") return false;
  if (d.align && d.align !== c.align) return false;
  return d.cls === "*" || d.cls.includes(CLASS_LETTER[c.cls]);
}
// 18を超えた分は、2ごとに1ずつ効きが増える（種族のいちばん得意な能力は20まで伸びる）
const over18 = v => v > 18 ? Math.floor((v - 18) / 2) : 0;
const strDmg = s => s >= 18 ? 3 + over18(s) : s >= 17 ? 2 : s >= 16 ? 1 : s <= 5 ? -1 : 0;
const strHit = s => s >= 18 ? 2 + over18(s) : s >= 16 ? 1 : s <= 5 ? -1 : 0;
const agiBonus = a => a >= 18 ? 3 + over18(a) : a >= 16 ? 2 : a >= 14 ? 1 : a <= 5 ? -1 : 0;
const vitHp = v => v >= 18 ? 3 + over18(v) : v >= 17 ? 2 : v >= 16 ? 1 : v <= 5 ? -1 : 0;
/* 種族ごとの決まり */
const raceOf = c => RACES[c.race] || RACES.human;
const statCap = (c, k) => (raceOf(c).top || []).includes(k) ? 20 : 18; // 能力値の上限（どの種族も18。いちばん得意な能力だけ20）
const expNeed = (c, lvl) => Math.round(expForLevel(c.cls, lvl) * (raceOf(c).exp || 1)); // そのレベルに必要な経験値
const raceResist = (c, kind) => !!(raceOf(c).resist && raceOf(c).resist.includes(kind) && chance(0.5)); // かかりにくい異常を、半分の確率ではねのける
function swings(c) {
  const ci = clsInfo(c);
  let n = ci.swing ? 1 + Math.floor(c.lvl / 5) : 1;
  return Math.min(n, 5);
}
function hitSkill(c) {
  const ci = clsInfo(c); const w = equipped(c, "weapon");
  return Math.floor(c.lvl * ci.hit) + strHit(c.st.str) + (w ? ITEM[w.id].hit : 0) + (ci.swing ? 1 : 0);
}

/* 呪文の回数（呪文レベルごと） */
function maxSlots(c, school) {
  const p = clsInfo(c)[school === "M" ? "mage" : "priest"];
  const keep = (school === "M" ? c.keepM : c.keepP) || [0, 0, 0, 0, 0, 0, 0];
  const out = [];
  for (let L = 1; L <= 7; L++) {
    let v = 0;
    if (p && c.lvl >= p.start + p.step * (L - 1)) {
      const since = c.lvl - (p.start + p.step * (L - 1));
      v = Math.min(9, 1 + Math.floor(since * (p.full ? 0.8 : 0.45)));
      const bonus = (school === "M" ? c.st.iq : c.st.pie) >= 17 && L <= 3 ? 1 : 0;
      v = Math.min(9, v + bonus);
    }
    out.push(Math.max(v, keep[L - 1] || 0));
  }
  return out;
}
function learnSpells(c) { // 使えるレベルの呪文を覚える。新しく覚えた呪文名を返す
  const learned = [];
  for (const sc of ["M", "P"]) {
    const mx = maxSlots(c, sc);
    for (const sp of SPELLS) if (sp.sc === sc && mx[sp.lv - 1] > 0 && !c.known.includes(sp.id)) { c.known.push(sp.id); learned.push(sp.name); }
  }
  return learned;
}
function restoreMP(c) { c.mpM = maxSlots(c, "M"); c.mpP = maxSlots(c, "P"); }

function makeChar(name, race, align, cls, st) {
  const ci = CLASSES[cls];
  const c = { id: S.nextId++, name, race, align, cls, lvl: 1, exp: 0, st: { ...st }, hp: 0, maxhp: 0, status: "ok", poison: 0,
    items: [], known: [], mpM: [], mpP: [], keepM: null, keepP: null, honor: 0, age: 16 + rand(4), where: "town", born: Date.now(), kills: 0 };
  c.maxhp = Math.max(2, ci.hd + vitHp(st.vit) + (ci.bonusHp || 0) + rand(3) + 4); // 初期HPは少し多め（序盤の即死を減らす）
  c.hp = c.maxhp;
  learnSpells(c); restoreMP(c);
  return c;
}
function nextExp(c) { return expNeed(c, c.lvl + 1); }

/* 宿屋でのレベルアップ判定。メッセージの配列を返す */
function tryLevelUp(c) {
  const msgs = [];
  while (c.exp >= nextExp(c) && c.lvl < 99) {
    c.lvl++;
    const ci = clsInfo(c);
    let gain = Math.max(1, rr(1, ci.hd) + vitHp(c.st.vit));
    if (ci.bonusHp) gain += 1;
    c.maxhp += gain; c.hp += gain;
    const ch = [];
    for (const k of STATS) {
      const r = Math.random();
      if (r < 0.35 && c.st[k] < statCap(c, k)) { c.st[k]++; ch.push(STAT_NAMES[k] + "+1"); }
      else if (r > 0.95 && c.st[k] > 3 && c.lvl > 3) { c.st[k]--; ch.push(STAT_NAMES[k] + "-1"); }
    }
    msgs.push(`${c.name}はレベル${c.lvl}になった！ (最大HP+${gain}${ch.length ? "、" + ch.join("、") : ""})`);
    const sp = learnSpells(c);
    if (sp.length) msgs.push(`新しい呪文を覚えた：${sp.join("、")}`);
  }
  return msgs;
}
function drainLevel(c) {
  if (c.lvl <= 1) { c.status = "lost"; return true; }
  c.lvl--; c.exp = expNeed(c, c.lvl);
  const loss = Math.max(1, Math.round(c.maxhp / (c.lvl + 1)));
  c.maxhp = Math.max(1, c.maxhp - loss); c.hp = Math.min(c.hp, c.maxhp);
  c.mpM = c.mpM.map((v, i) => Math.min(v, maxSlots(c, "M")[i])); c.mpP = c.mpP.map((v, i) => Math.min(v, maxSlots(c, "P")[i]));
  return false;
}
/* 持ち物の並び替え：装備中の品を上に（武器→盾→鎧→兜→小手→装飾品の順）、装備していない品は手に入れた順のまま */
const EQUIP_ORDER = { weapon: 0, shield: 1, armor: 2, helm: 3, gloves: 4, acc: 5 };
function sortItems(c) {
  if (!c || !c.items) return;
  const eq = c.items.filter(it => it.eq).sort((a, b) => (EQUIP_ORDER[ITEM[a.id].t] ?? 9) - (EQUIP_ORDER[ITEM[b.id].t] ?? 9));
  const rest = c.items.filter(it => !it.eq);
  const sorted = eq.concat(rest);
  if (sorted.some((it, i) => it !== c.items[i])) c.items.splice(0, c.items.length, ...sorted);
}
function itemName(inv) { const d = ITEM[inv.id]; return inv.known ? d.name : d.unk; }
function addItem(c, id, known) { if (c.items.length >= 8) return false; c.items.push({ id, known: !!known, eq: false }); return true; }
function giveItemToParty(id, known) { // 空きのある仲間に渡す。受け取った人を返す
  for (const c of partyChars()) if (isAlive(c) && c.items.length < 8) { addItem(c, id, known); return c; }
  for (const c of partyChars()) if (c.items.length < 8) { addItem(c, id, known); return c; }
  return null;
}
function hasKey(req) {
  if (!req) return true;
  if (req.startsWith("flag:")) return !!S.flags[req.slice(5)];
  if (req === "shards") return !!(S.keys.shard1 && S.keys.shard2 && S.keys.shard3); // 封印の扉は欠片3つ
  return !!S.keys[req];
}

/* 能力値の目安表示 */

/* ────────── 画面部品（すべて Promise で待てる） ────────── */
const UI = {};
UI.fast = false;
/* ────────── バックログ（メッセージの履歴） ──────────
   メッセージ欄は4行しか出ないので、流れたメッセージをここに残し、📜ボタンで読み返せるようにする */
const BACKLOG = [];
const BACKLOG_MAX = 300;
function pushLog(text, kind) {
  for (const line of String(text).split("\n")) if (line.trim()) BACKLOG.push({ t: line, k: kind || "" });
  while (BACKLOG.length > BACKLOG_MAX) BACKLOG.shift();
}
// 仲間がやられたことが分かる行は赤くする
const BAD_LINE = /死んだ|首をはねられた|石になった|麻痺した|眠ってしまった|毒に冒された|吸い取られ|消滅|窒息した|心臓が止まった|灰になっ|失われ|沈黙させられた/;
function showBacklog() {
  const rows = BACKLOG.map(e => e.k === "sep"
    ? `<div class="blsep">${esc(e.t)}</div>`
    : `<div class="bl${BAD_LINE.test(e.t) ? " bad" : ""}">${esc(e.t)}</div>`).join("");
  dialog(`<div class="backlog">${rows || '<div class="empty">まだメッセージはない。</div>'}</div>`, [{ label: "とじる", value: null }],
    { title: "これまでのメッセージ", onOpen: b => { const box = b.closest(".sheet").querySelector(".sbody"); box.scrollTop = box.scrollHeight; } });
}
// キーボードの L・コントローラーの LT／RT 用：開いていれば閉じ、ほかの窓が出ていなければ開く
function toggleBacklog() {
  const ov = $("ov");
  if (!ov.classList.contains("on")) { showBacklog(); return; }
  if (ov.querySelector(".backlog")) { const b = ov.querySelector(".sfoot button, button"); if (b) b.click(); }
}

function logMsg(text) { // メッセージ欄に1行足す（古い行は消える）
  pushLog(text);
  const box = $("msg");
  const div = document.createElement("div");
  div.className = "ln";
  div.innerHTML = esc(text).replace(/\n/g, "<br>");
  box.appendChild(div);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}
function clearMsg() { $("msg").innerHTML = ""; }
/* タップで次へ進むメッセージ */
function tell(text, opt = {}) {
  pushLog(text);
  return new Promise(res => {
    clearMsg();
    const box = $("msg");
    box.innerHTML = `<div class="ln">${esc(text).replace(/\n/g, "<br>")}</div><span class="more">▼</span>`;
    const cmd = $("cmd");
    cmd.innerHTML = `<button class="wide next">${opt.btn || "つぎへ"}</button>`;
    const done = () => { box.onclick = null; cmd.innerHTML = ""; const m = box.querySelector(".more"); if (m) m.remove(); Snd.play("move"); res(); };
    cmd.querySelector("button").onclick = done;
    box.onclick = done;
  });
}
/* メッセージをしばらく表示（戦闘用）。画面タップで早送り */
async function flash(text, ms) {
  logMsg(text);
  const wait = (ms || 650) / (S && S.speed ? S.speed : 1);
  await new Promise(res => {
    let t = setTimeout(fin, UI.fast ? wait * 0.3 : wait);
    function fin() { clearTimeout(t); document.removeEventListener("pointerdown", skip, true); res(); }
    function skip(e) { if (e.target.closest("header") || e.target.closest("#ov") || e.target.closest("#helpOv")) return; fin(); }
    document.addEventListener("pointerdown", skip, true);
  });
}
/* コマンド欄のボタンから1つ選ぶ。opts: [{label, value, disabled, cls, sub}]。cancel=trueで「もどる」付き */
function choose(opts, o = {}) {
  return new Promise(res => {
    const cmd = $("cmd");
    cmd.innerHTML = "";
    if (o.title) { const t = document.createElement("div"); t.className = "ctitle"; t.textContent = o.title; cmd.appendChild(t); }
    const grid = document.createElement("div");
    grid.className = "cgrid c" + (o.cols || 2);
    opts.forEach(op => {
      if (!op) return;
      const b = document.createElement("button");
      b.innerHTML = esc(op.label) + (op.subHtml ? `<small>${op.subHtml}</small>` : op.sub ? `<small>${esc(op.sub)}</small>` : "");
      if (op.cls) b.className = op.cls;
      if (op.disabled) b.disabled = true;
      // 選んだら古いボタンは消す（戦闘メッセージ中に押しても反応しない古いボタンが残らないように）
      b.onclick = () => { Snd.play("click"); cmd.innerHTML = ""; res(op.value !== undefined ? op.value : op.label); };
      grid.appendChild(b);
    });
    if (o.cancel) {
      const b = document.createElement("button");
      b.className = "back"; b.textContent = o.cancelLabel || "もどる";
      b.onclick = () => { Snd.play("cancel"); cmd.innerHTML = ""; res(null); };
      grid.appendChild(b);
    }
    cmd.appendChild(grid);
  });
}
/* 全画面のリスト選択（ショップ・名簿など、項目が多いとき） */
function listPick(title, items, o = {}) {
  return new Promise(res => {
    const ov = $("ov");
    ov.innerHTML = "";
    const box = document.createElement("div"); box.className = "sheet" + (o.cls ? " " + o.cls : "");
    box.innerHTML = `<div class="shead"><b>${esc(title)}</b>${o.right ? `<span>${o.right}</span>` : ""}</div>`;
    if (o.note) { const n = document.createElement("div"); n.className = "snote"; n.innerHTML = o.note; box.appendChild(n); }
    const list = document.createElement("div"); list.className = "slist" + (o.grid2 ? " g2" : "");
    if (!items.length) list.innerHTML = `<div class="empty">${esc(o.empty || "なにもない")}</div>`;
    items.forEach(it => {
      const b = document.createElement("button");
      b.className = "srow" + (it.cls ? " " + it.cls : "");
      if (it.value !== undefined) b.dataset.v = String(it.value); // カーソル位置を覚えるときの目印
      b.innerHTML = `<span class="l">${it.html || esc(it.label)}</span><span class="r">${it.rhtml || esc(it.right || "")}</span>`;
      if (it.disabled) b.disabled = true;
      b.onclick = () => { Snd.play("click"); close(it.value); };
      list.appendChild(b);
    });
    box.appendChild(list);
    const f = document.createElement("div"); f.className = "sfoot";
    const cb = document.createElement("button"); cb.textContent = o.cancelLabel || "とじる"; cb.onclick = () => { Snd.play("cancel"); close(null); };
    f.appendChild(cb); box.appendChild(f);
    ov.appendChild(box); ov.classList.add("on");
    function close(v) { ov.classList.remove("on"); ov.innerHTML = ""; res(v); }
  });
}
/* 自由な内容のダイアログ。buttons: [{label,value,cls}] */
function dialog(html, buttons, o = {}) {
  return new Promise(res => {
    const ov = $("ov");
    ov.innerHTML = "";
    const box = document.createElement("div"); box.className = "sheet" + (o.small ? " small" : "") + (o.cls ? " " + o.cls : "");
    if (o.title) box.innerHTML = `<div class="shead"><b>${esc(o.title)}</b></div>`;
    const body = document.createElement("div"); body.className = "sbody"; body.innerHTML = html;
    box.appendChild(body);
    const f = document.createElement("div"); f.className = "sfoot";
    (buttons || [{ label: "とじる", value: null }]).forEach(bt => {
      const b = document.createElement("button"); b.textContent = bt.label; if (bt.cls) b.className = bt.cls;
      b.onclick = () => { Snd.play(bt.value === null ? "cancel" : "click"); const isFn = typeof bt.value === "function"; const v = isFn ? bt.value(body) : bt.value; if (isFn && v === false) return; close(v); };
      f.appendChild(b);
    });
    box.appendChild(f);
    ov.appendChild(box); ov.classList.add("on");
    if (o.onOpen) o.onOpen(body);
    function close(v) { ov.classList.remove("on"); ov.innerHTML = ""; res(v); }
  });
}
const confirmBox = (text, yes = "はい", no = "いいえ") => dialog(`<p>${esc(text).replace(/\n/g, "<br>")}</p>`, [{ label: no, value: false }, { label: yes, value: true, cls: "pri" }], { small: true });
const alertBox = (text, title) => dialog(`<p>${esc(text).replace(/\n/g, "<br>")}</p>`, [{ label: "OK", value: true, cls: "pri" }], { small: true, title });

/* 仲間を1人選ぶ（パーティ表をタップ） */
/* HPの表示（大きめの数字＋残りの割合のバー。減るほど黄→赤） */
function hpHtml(c) {
  const p = c.maxhp ? c.hp / c.maxhp : 0, col = p < 0.25 ? "#f87171" : p < 0.5 ? "#fbbf24" : "#e8e8ee";
  return `<span class="hpv"><b style="color:${col}">${c.hp}</b><small>/${c.maxhp}</small><i class="hpbar"><i style="width:${Math.round(clamp(p, 0, 1) * 100)}%;background:${col}"></i></i></span>`;
}
function pickMember(title, filter) {
  const list = partyChars();
  const items = list.map(c => { const st = statusLabel(c); return { html: `<b>${esc(c.name)}</b> <small>${clsLabel(c)}</small>${st ? ` <em class="pst">${st}</em>` : ""}`, rhtml: hpHtml(c), value: c.id, disabled: filter && !filter(c) }; });
  return listPick(title, items).then(id => id ? charById(id) : null);
}

/* ────────── 背景画像 ──────────
   wizrpg/bg/キー.jpg があれば表示窓の背景にする。無ければ今までどおりのグラデーション＋絵文字。
   キー: title town tavern inn shop temple train castle chest wipe ending wanderer */
const BG_STATE = {}; // キー -> "ok" | "ng" | "loading"
function setSceneBg(key) {
  const sc = $("scene");
  sc.dataset.bg = key || "";
  const apply = () => {
    if (sc.dataset.bg !== key) return; // 読み込み中に別の画面へ移っていたら何もしない
    // タイトルとエンディングは中央に文字が重なるので、中央を少し暗くして読みやすくする
    const shade = key.startsWith("title")
      ? "linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.15) 38%,rgba(0,0,0,.15) 55%,rgba(0,0,0,.8))" // タイトル：上の文字と下のボタンのあたりを暗く
      : key === "ending"
      ? "radial-gradient(ellipse 70% 45% at 50% 48%,rgba(0,0,0,.6),rgba(0,0,0,.15) 75%)"
      : "linear-gradient(rgba(0,0,0,.15),rgba(0,0,0,.55))";
    sc.style.backgroundImage = `${shade},url(wizrpg/bg/${key}.jpg)`;
    sc.classList.add("hasbg");
  };
  sc.style.backgroundImage = "";
  if (!key || BG_STATE[key] === "ng") { sc.classList.remove("hasbg"); return; }
  // 読み込み中も絵がある前提の並びにしておき、仮の絵文字は出さない（読み込めなかったときだけ仮の絵に戻す）
  sc.classList.add("hasbg");
  preloadBg(key, apply, () => { if (sc.dataset.bg === key) sc.classList.remove("hasbg"); });
}
const BG_WAIT = {}; // キー -> 読み込み待ちの処理
function preloadBg(key, ok, ng) {
  if (BG_STATE[key] === "ok") { if (ok) ok(); return; }
  if (BG_STATE[key] === "ng") { if (ng) ng(); return; }
  const w = BG_WAIT[key] = BG_WAIT[key] || [];
  if (ok || ng) w.push([ok, ng]);
  if (BG_STATE[key] === "loading") return;
  BG_STATE[key] = "loading";
  const img = new Image();
  img.onload = () => { BG_STATE[key] = "ok"; w.splice(0).forEach(([f]) => f && f()); };
  img.onerror = () => { BG_STATE[key] = "ng"; w.splice(0).forEach(([, f]) => f && f()); };
  img.src = `wizrpg/bg/${key}.jpg`;
}

/* 呪文の使用回数を1つ減らす。星喰いの瞳を装備していれば、半分の確率で減らない */
function spendSlot(c, sp) {
  const eye = c.items.find(it => it.eq && ITEM[it.id].spellSave);
  if (eye && chance(ITEM[eye.id].spellSave)) { logMsg(`${ITEM[eye.id].name}が輝き、${c.name}の呪文の力は失われなかった！`); return; }
  (sp.sc === "M" ? c.mpM : c.mpP)[sp.lv - 1]--;
}
/* 称号の印：クリアで白い★、星喰いを倒すと金色の★（2つ並べると名前の欄が狭くなるので、色で区別する） */
const honorMark = c => c.honor ? `<i class="hon${c.honor >= 2 ? " hon2" : ""}">★</i>` : "";

/* ────────── パーティ表 ────────── */
let partyTapHandler = null;
let partyHighlight = null;
/* 戦闘で選んだ行動（その人が動くまで、HPの欄にHPと2秒ごとに入れ替えて出す） */
function actLabel(a) {
  const ic = { fight: "⚔️", parry: "🛡️", dispel: "☩", spell: "✨", use: "🎒" }[a.t] || "";
  const tx = a.t === "spell" || a.t === "use" ? (SPELL[a.sp] || {}).name || "" : { fight: "たたかう", parry: "身を守る", dispel: "ディスペル" }[a.t] || "";
  return `<i class="pact"><span class="pic">${ic}</span>${esc(tx)}</i>`;
}
// 戦闘中は2秒ごとに、HPの欄を「行動」と「HP」で切り替える（ふわっと入れ替える。速さの調整は下の2000）
setInterval(() => { const p = $("party"); if (!p) return; if (window.BT) p.classList.toggle("showhp"); else p.classList.remove("showhp"); }, 2000);
function renderParty() {
  const el = $("party");
  const list = S ? partyChars() : [];
  list.forEach(sortItems);
  let h = `<div class="prow phead"><span class="pn">なまえ</span><span class="pc">職業</span><span class="pa">AC</span><span class="ph">HP</span><span class="ps">状態</span></div>`;
  for (let i = 0; i < 6; i++) {
    const c = list[i];
    if (!c) { h += `<div class="prow empty"><span class="pn">―</span></div>`; continue; }
    const st = statusLabel(c);
    const cls = ["prow"];
    if (!isAlive(c)) cls.push("dead"); else if (c.status !== "ok") cls.push("bad"); else if (c.poison) cls.push("poi");
    if (partyHighlight === c.id) cls.push("cur");
    if (i === 3) cls.push("back1");
    const hpPct = c.maxhp ? c.hp / c.maxhp : 0;
    const act = window.BT && c._act && !c._act.done && c.status === "ok" ? actLabel(c._act) : "";
    h += `<div class="${cls.join(" ")}" data-id="${c.id}"><span class="pn">${S && S.inMaze ? `<i class="plv">Lv${c.lvl}</i>` : ""}${honorMark(c)}${esc(c.name)}</span><span class="pc">${clsLabel(c)}</span><span class="pa">${computeAC(c, !!window.BT)}${window.BT && c.bac > 0 ? `<i class="acup">↑</i>` : ""}</span>` +
      `<span class="ph${act ? " hasact" : ""}">${act}<span class="hpv"><b style="color:${hpPct < 0.25 ? "#f87171" : hpPct < 0.5 ? "#fbbf24" : "#e8e8ee"}">${c.hp}</b><small>/${c.maxhp}</small></span></span><span class="ps">${st || "&nbsp;"}</span></div>`;
  }
  el.innerHTML = h;
  el.querySelectorAll(".prow[data-id]").forEach(r => r.onclick = () => { if (partyTapHandler) partyTapHandler(charById(+r.dataset.id)); });
  $("goldTag").textContent = S ? S.gold.toLocaleString() + " G" : "";
}

/* ────────── 文ごとの改行 ──────────
   「。」「！」「？」のあとに次の文が続くときは、そこで行を改める。
   文の途中で折り返すより読みやすいため。ボタンやリストの行は高さが変わると使いにくいので対象外。
   画面に文章が足されるたびに自動でかける（描画の前に処理されるので、ちらつかない） */
// （「後ろを見る」正規表現は古い iPhone のブラウザが読めず、このファイルごと動かなくなるので使わない）
const SENT_END = /([。！？])(?=[^\s。！？」』）〉】…―、])/g;
const sentSplit = s => s.replace(SENT_END, "$1\u0000").split("\u0000");
const SENT_SKIP = "button,.srow,.nobr,input,textarea,script,style";
function sentenceBreak(node) {
  const texts = [];
  if (node.nodeType === 3) texts.push(node);
  else if (node.nodeType === 1) {
    if (node.closest(SENT_SKIP)) return;
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) texts.push(w.currentNode);
  }
  for (const t of texts) {
    const p = t.parentElement;
    if (!p || p.closest(SENT_SKIP)) continue;
    // 文が終わってすぐ次の文が太字などで始まるとき（「〜休む。<b>酒場</b>で〜」）も改行する
    const nx = t.nextSibling;
    if (/[。！？]$/.test(t.data) && nx && nx.nodeType === 1 && !/^(BR|DIV|P|UL|OL|LI|TABLE|H\d)$/.test(nx.tagName) && /^[^\s。！？」』）〉】…―、]/.test(nx.textContent)) t.after(document.createElement("br"));
    const parts = sentSplit(t.data);
    if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    parts.forEach((s, i) => { if (i) frag.appendChild(document.createElement("br")); frag.appendChild(document.createTextNode(s)); });
    t.replaceWith(frag);
  }
}
sentenceBreak(document.body);
new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(sentenceBreak); }).observe(document.body, { childList: true, subtree: true });

/* ────────── 横長の画面の拡大 ──────────
   パソコンなどの横長の画面では、画面の高さに合わせて全体を拡大する（画面が広くなっても文字が小さいままにならないように）。
   横幅が足りないときは、2列が収まる倍率までにとどめる。--vh は拡大前の単位での画面の高さ（表示窓の大きさの計算に使う） */
const WIDE_MQ = matchMedia("(min-width:760px) and (orientation:landscape)");
let uiZoom = 1;
function fitWide() {
  uiZoom = WIDE_MQ.matches ? clamp(Math.min(innerHeight / 760, innerWidth / 1100), 1, 1.8) : 1;
  const b = document.body;
  b.style.zoom = uiZoom === 1 ? "" : uiZoom;
  b.style.height = b.style.minHeight = uiZoom === 1 ? "" : innerHeight / uiZoom + "px";
  document.documentElement.style.setProperty("--vh", innerHeight / uiZoom + "px");
}
fitWide();
window.addEventListener("resize", fitWide);

/* ────────── プレイ時間 ──────────
   画面を開いていて、最後に操作してから3分以内の間だけ数える（S.stats.playMs）。
   前の版の記録には無いので、歩いた歩数と戦闘回数からおおよその時間を出して始める（始めてからの経過時間は超えない） */
let lastActive = Date.now(), playTick = Date.now();
function markActive() { lastActive = Date.now(); }
document.addEventListener("pointerdown", markActive, true);
document.addEventListener("keydown", markActive, true);
function estimatePlayMs(s) {
  const st = s.stats || {};
  return Math.min((st.steps || 0) * 1500 + (st.battles || 0) * 40000, Date.now() - (st.startedAt || Date.now()));
}
function playMinutes(s) {
  const st = s.stats || (s.stats = {});
  return Math.floor((st.playMs != null ? st.playMs : estimatePlayMs(s)) / 60000);
}
setInterval(() => {
  const now = Date.now(), dt = now - playTick; playTick = now;
  if (!S || document.hidden || now - lastActive > 180000 || dt > 60000) return;
  if (S.stats.playMs == null) S.stats.playMs = estimatePlayMs(S);
  S.stats.playMs += dt;
}, 5000);
