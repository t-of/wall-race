# ai/ 学習 AI（段階 1）

手書き評価の CPU（ゴールまでの歩数の差 ×100）を、自己対局で学習した価値ネットに差し替えるための仕組み。
Node のみ・依存なし（ブラウザの main.js はまだ使っていない）。コマンドは `apps/wall-race/` で。

## コマンド

```sh
node ai/test.mjs                                   # engine.js が main.js と同じ手を選ぶか（数秒）
# 試走（1〜2 分）
node ai/train.mjs --name try --games 24 --gens 2 --arena-games 8 --nodes 100 --arena-nodes 100 --epochs 2
node ai/arena.mjs --a ai/runs/try/gen-2.json --b hand --games 6 --nodes 100
# 本番（nohup で。同じ --name で動かすと続きから）
nohup node ai/train.mjs --name v1 --games 300 --gens 40 --threads 8 --nodes 300 > ai/runs/v1.out 2>&1 &
# 測定（合格の目安: 手書きに 400 局で 55% 以上）
node ai/arena.mjs --a ai/runs/v1/best.json --b hand --games 400 --nodes 300 --threads 8
node ai/selfplay.mjs --games 16 --nodes 300 --net hand   # 自己対局の速さ・結果の割合
```

`--a` / `--b` / `--net` は `hand`（手書き: 歩数の差）、`hand2`（手書き 2: 歩数の差＋壁 1 枚で延ばせる歩数の差。main.js の CPU に 16 局 14 勝）か網の JSON。学習の最初の相手は `--base`（既定 hand2）。引数は `ai/train.mjs` の先頭にある一覧が全部（世代あたりの局数、学習の回数、採用の勝率 `--accept` など）。

## ファイル

- `engine.js` main.js のゲーム処理と CPU の切り出し。`think(state, me, { nodes, evaluate })` で節点数をそろえて読める。
- `features.js` 手番側から見た入力（5 面 ×117 マス＋スカラー 6 = 591。スカラーに壁 1 枚で延ばせる歩数）。`flip` で左右反転。
- `net.js` 588 → 64 → 32 → 1（ReLU、出力 tanh）。重みは JSON。`netEvaluate` が探索用の評価（値 ×1000 点）。
- `play.js` 1 局（ランダムな最初の数手＋手数上限 300 で引き分け）。`worker.mjs` worker_threads の並列。
- `selfplay.mjs` 自己対局でデータを集める。`train.mjs` 世代ループ。`arena.mjs` 節点数そろえた対戦。
- `runs/<名前>/` に `gen-N.json`（毎世代の網）、`best.json`（採用された最良）、`log.tsv`。git に入れない。最良は後で `ai/model.json` として入れる。
