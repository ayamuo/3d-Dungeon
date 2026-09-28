/* BGM（MIDI）をスクリプトに埋め込むための変換ツール
   使い方：このフォルダで  node make_bgm_data.js  を実行すると、bgm_data.js が作り直される。
   ・曲を追加・差し替えたら（core.js の BGM_LIST を変えたら）、必ず実行すること
   ・ゲームで使っている曲（core.js の BGM_LIST に書いてある .mid）だけを埋め込む
   ・ファイルを直接開いた時（file://）は、ブラウザの制限でMIDIファイルを読み込めないため、
     ゲームはこの bgm_data.js に埋め込んだデータを使って鳴らす */
"use strict";
const fs = require("fs"), path = require("path");
const dir = __dirname;
const core = fs.readFileSync(path.join(dir, "..", "core.js"), "utf8");
const listSrc = (core.match(/const BGM_LIST = \{[\s\S]*?\n\};/) || [""])[0];
const used = [...new Set([...listSrc.matchAll(/midi:\s*"([^"]+\.mid)"/g)].map(m => m[1]))].sort();
const data = {};
const missing = [];
for (const f of used) {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) data[f] = fs.readFileSync(p).toString("base64"); else missing.push(f);
}
const out = `/* 自動生成ファイル（make_bgm_data.js で作成）。直接編集しないこと。
   BGMのMIDIデータを埋め込んだもの。ファイルを直接開いた時でもBGMを鳴らせるようにするため。 */
window.BGM_DATA = ${JSON.stringify(data, null, 0).replace(/","/g, '",\n"')};
`;
fs.writeFileSync(path.join(dir, "bgm_data.js"), out);
console.log(`bgm_data.js を作成しました（${Object.keys(data).length}曲、${(out.length / 1024).toFixed(0)}KB）`);
Object.keys(data).forEach(f => console.log("  " + f));
if (missing.length) console.log("見つからない曲（core.js には書いてあるがファイルが無い）:", missing.join(", "));
const unused = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".mid") && !used.includes(f));
if (unused.length) console.log("使っていない曲（埋め込まない）:", unused.join(", "));
