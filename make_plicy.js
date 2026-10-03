/* PLiCy に上げるためのフォルダ（plicy/）を作る。
   使い方：このフォルダで  node make_plicy.js  を実行する（ゲームを直したら、そのたびに作り直す）。アップロード用の plicy.zip も一緒にできる。
   ・入口は plicy/index.html（wizrpg.html をもとに、PLiCy 向けに少し変えたもの）
   ・ゲームが実際に読み込むファイルだけを入れる（説明書き・作成用のスクリプト・使っていない素材は入れない）
   ・版の表記は下の VERSION を書き換える */
"use strict";
const fs = require("fs"), path = require("path");
const VERSION = "先行版 v0.9";
const SRC = __dirname, OUT = path.join(SRC, "plicy");

// 作り直すたびに空にする（plicy フォルダの中だけを消す）
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "wizrpg"), { recursive: true });

let n = 0, bytes = 0;
function copy(rel) {
  const from = path.join(SRC, rel), to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to); n++; bytes += fs.statSync(from).size;
}
function copyDir(rel, test) {
  for (const f of fs.readdirSync(path.join(SRC, rel))) {
    const p = rel + "/" + f;
    if (fs.statSync(path.join(SRC, p)).isFile() && test(f)) copy(p);
  }
}

// プログラム
for (const f of ["data", "maze", "midi", "core", "town", "explore", "battle", "input"]) copy(`wizrpg/${f}.js`);
copy("wizrpg/bgm/bgm_data.js");
copy("wizrpg/obj3d/obj3d_data.js");
// 絵・音・フォント（ゲームが読み込む種類だけ。英数字の名前のものだけ＝元素材の日本語名のファイルは入れない）
const ascii = f => /^[\w.-]+$/.test(f);
copyDir("wizrpg/bg", f => ascii(f) && /\.(jpg|png)$/.test(f));
copyDir("wizrpg/tex", f => ascii(f) && /\.jpg$/.test(f));
copyDir("wizrpg/obj3d", f => /\.webp$/.test(f));
copyDir("wizrpg/se", f => ascii(f) && /\.mp3$/.test(f) && !["crit.mp3", "axecrit.mp3", "ecrit.mp3", "block.mp3", "trap_bomb.mp3"].includes(f));
copy("wizrpg/font/DotGothic16-Regular.ttf"); copy("wizrpg/font/OFL.txt");
copy("wizrpg/icon-192.png");
// モンスターの絵は、ゲームに出てくるものだけ
const D = require("./wizrpg/data.js");
for (const m of D.MONSTERS) { if (fs.existsSync(path.join(SRC, `wizrpg/monsters/${m.id}.png`))) copy(`wizrpg/monsters/${m.id}.png`); else console.log("絵が無い:", m.id); }

// 入口のページ：PLiCy 向けに変える
let h = fs.readFileSync(path.join(SRC, "wizrpg.html"), "utf8");
function rep(a, b) { if (h.split(a).length !== 2) throw new Error("見つからない: " + a.slice(0, 50)); h = h.replace(a, b); }
// ・「← もどる」（行き先が無い）を、版の表記に替える
rep(`<a href="index.html">← もどる</a>`, `<span class="vtag">${VERSION}</span>`);
rep(`</style>`, `  header .vtag{font-size:11px;color:#9a9a9a;white-space:nowrap;}\n</style>`);
// ・ホーム画面に追加する設定（PLiCy の中では使えない）を外す
h = h.split("\n").filter(l => !/rel="manifest"|mobile-web-app-capable|apple-touch-icon/.test(l)).join("\n");
fs.writeFileSync(path.join(OUT, "index.html"), h);
n++; bytes += Buffer.byteLength(h);

// ゲームが読み込むファイルが、そろっているかを確かめる（スクリプトの読み込み）
const missing = [...h.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(f => !fs.existsSync(path.join(OUT, f)));
if (missing.length) throw new Error("入口のページが読み込むのに、入っていないファイル: " + missing.join(", "));

console.log(`plicy/ を作りました：${n}ファイル、${(bytes / 1024 / 1024).toFixed(1)}MB（${VERSION}）`);

// アップロード用の plicy.zip も作る。Windows に入っている tar を使う
// （PowerShell の Compress-Archive だと、中のフォルダの区切りが「\」になり、PLiCy 側でファイルが見つからなくなる）
const ZIP = path.join(SRC, "plicy.zip");
fs.rmSync(ZIP, { force: true });
try {
  require("child_process").execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
    ["-a", "-cf", ZIP, "index.html", "wizrpg"], { cwd: OUT });
  console.log(`plicy.zip を作りました：${(fs.statSync(ZIP).size / 1024 / 1024).toFixed(1)}MB`);
} catch (e) { console.log("plicy.zip は作れませんでした（plicy フォルダを自分で圧縮してください）：" + e.message); }
