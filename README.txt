星灯の迷宮 ― 十層の封印 ―
============================

あそびコレクション用の、昔ながらの3DダンジョンRPG。

■ ファイル構成
  wizrpg.html          画面・デザイン・遊び方（起動するファイル）
  wizrpg/data.js       種族・職業・呪文・アイテム・モンスター・迷宮10階とイベントの定義（バランス調整はここ）
  wizrpg/maze.js       迷宮の自動生成（階ごとの固定シードで毎回同じ形になる）
  wizrpg/core.js       キャラクター処理・セーブ・効果音・画面部品
  wizrpg/town.js       鉱山町（酒場・宿屋・商店・聖堂・訓練所・評議会・エンディング）
  wizrpg/explore.js    迷宮探索（3D表示・移動・仕掛け・イベント・キャンプ・地図）
  wizrpg/battle.js     戦闘・宝箱
  wizrpg/input.js      キーボード・ゲームパッド操作
  wizrpg/midi.js       MIDIのBGMを鳴らす簡易シンセ
  wizrpg/monsters/     モンスター画像の置き場（README.txt に全65体の作成指示）
  wizrpg/bg/           町・タイトルなどの背景画像の置き場（README.txt に全11枚の作成指示）
  wizrpg/tex/          迷宮の壁・床・天井・扉の画像の置き場（README.txt に作成指示。階ごとの差し替えも可）
  wizrpg/se/           戦闘の効果音（効果音ラボ。README.txt に割り当て一覧）
  wizrpg/bgm/          BGM（魔王魂のMIDI。曲を変えたら node make_bgm_data.js で bgm_data.js を作り直す）
  wizrpg/obj3d/        昇降機・上り階段・下り階段の立体の絵（Blenderで作ったモデルを、位置と向きごとに描き出したもの。
                       作り直すときは make_obj3d.py を Blender で実行する。一覧は obj3d_data.js）
  wizrpg/icon-*.png    ホーム画面に追加したときのアイコン（manifest.json から参照）
  manifest.json        ホーム画面に追加したとき、ブラウザの帯なしで開くための設定
  wizrpg/font/         文字のフォント（DotGothic16・SIL Open Font License。OFL.txt を同梱。font_data.js はファイルを直接開いたとき用の埋め込み）
  wizrpg/battle_SE/    効果音の元素材一式（コレクションへはコピーしない）

■ あそびコレクションへの組み込み
  wizrpg.html と wizrpg フォルダを asobi_collection 直下にコピーし、
  index.html にカードを1枚追加済み。
  こちらのフォルダを修正したら、同じ2つを asobi_collection へ上書きコピーする（battle_SE は除く）。
  効果音は、すべて wizrpg/se/ のファイルで鳴らす（決定・取り消し・足音・勝利などの8つは、asobi_collection/se から同じものをコピーして入れてある）。

■ セーブ
  ブラウザの localStorage（キー: wizrpg_save_v2）に自動保存。
