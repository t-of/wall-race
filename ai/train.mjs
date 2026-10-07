// 世代ループ: 自己対局 → 学習 → 新しい網 vs 最良（節点数そろえて）→ 勝ち越したら採用。
//   試走: node ai/train.mjs --name try --games 16 --gens 2 --arena-games 8 --nodes 100 --epochs 2
// runs/<name>/ に gen-N.json（毎世代の網）、best.json（採用された最良。まだなければ手書き）、log.tsv。
// 同じ --name で動かすと続きから。（学習データの窓は再開時に空から貯め直す）
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { parseArgs } from './worker.mjs';
import { selfplay } from './selfplay.mjs';
import { arena } from './arena.mjs';
import { FEATURE_DIM, FLIP } from './features.js';
import { createNet, forward, toJSON, fromJSON } from './net.js';
import { mulberry32 } from './play.js';

const a = parseArgs({
  name: 'run', games: 200, gens: 20, threads: 8, nodes: 300, 'arena-games': 100, 'arena-nodes': 300,
  epochs: 4, batch: 128, lr: 0.001, window: 3, beta: 0.3, accept: 0.55, seed: 1, 'rand-plies': 6,
});
const dir = new URL(`./runs/${a.name}/`, import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const HEAD = 'gen\tpositions\tsp_plies\tsp_draw\tloss\tarena_score\tarena_w\tarena_d\tarena_l\tadopted\tsec\n';
const logFile = dir + 'log.tsv', rd = (f) => JSON.parse(readFileSync(dir + f, 'utf8'));

// 逆伝播（二乗誤差、出力は tanh）。g に勾配を足す
function backward(net, x, acts, t, y, g) {
  const L = net.sizes.length - 1;
  let d = Float32Array.of(2 * (t - y) * (1 - t * t));
  for (let l = L - 1; l >= 0; l--) {
    const n = net.sizes[l], m = net.sizes[l + 1], inp = l ? acts[l - 1] : x, w = net.w[l];
    const nd = l ? new Float32Array(n) : null;
    for (let j = 0; j < m; j++) g.b[l][j] += d[j];
    for (let i = 0; i < n; i++) {
      const v = inp[i];
      if (!v) continue;
      const off = i * m;
      for (let j = 0; j < m; j++) g.w[l][off + j] += v * d[j];
      if (nd && v > 0) { let s = 0; for (let j = 0; j < m; j++) s += w[off + j] * d[j]; nd[i] = s; }
    }
    d = nd;
  }
}

// データ全体を epochs 回。左右反転は半々の確率でかける（盤は左右対称）。最後の epoch の平均損失を返す
function fit(net, { X, Y, n }, { epochs, batch, lr, rng }, adam) {
  const ps = [...net.w, ...net.b];
  const g = { w: net.w.map((p) => new Float32Array(p.length)), b: net.b.map((p) => new Float32Array(p.length)) };
  const gs = [...g.w, ...g.b];
  const idx = Int32Array.from({ length: n }, (_, i) => i), xb = new Float32Array(FEATURE_DIM);
  let loss = 0;
  for (let e = 0; e < epochs; e++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    loss = 0;
    for (let s0 = 0; s0 < n; s0 += batch) {
      gs.forEach((q) => q.fill(0));
      const end = Math.min(n, s0 + batch);
      for (let k = s0; k < end; k++) {
        const i = idx[k], row = X.subarray(i * FEATURE_DIM, (i + 1) * FEATURE_DIM);
        let x = row;
        if (rng() < 0.5) { for (let f = 0; f < FEATURE_DIM; f++) xb[f] = row[FLIP[f]]; x = xb; }
        const acts = [], t = forward(net, x, acts);
        loss += (t - Y[i]) ** 2;
        backward(net, x, acts, t, Y[i], g);
      }
      adam.t++;
      const c1 = 1 - 0.9 ** adam.t, c2 = 1 - 0.999 ** adam.t, sz = end - s0;
      ps.forEach((p, q) => {
        const gq = gs[q], m = adam.m[q], v = adam.v[q];
        for (let i = 0; i < p.length; i++) {
          const gi = gq[i] / sz;
          m[i] = 0.9 * m[i] + 0.1 * gi; v[i] = 0.999 * v[i] + 0.001 * gi * gi;
          p[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
        }
      });
    }
    loss /= n;
  }
  return loss;
}

// 再開: log.tsv の最後の世代から。candidate = 最後の gen-N.json、best = best.json（なければ手書き）
let gen0 = 0, cand = null, best = { kind: 'hand' };
if (existsSync(logFile)) {
  const rows = readFileSync(logFile, 'utf8').trim().split('\n');
  gen0 = rows.length > 1 ? Number(rows[rows.length - 1].split('\t')[0]) : 0;
  if (gen0) cand = fromJSON(rd(`gen-${gen0}.json`));
  if (existsSync(dir + 'best.json')) best = { kind: 'net', net: rd('best.json') };
  console.log(`再開: 第 ${gen0} 世代まで済み`);
} else writeFileSync(logFile, HEAD);
if (!cand) cand = createNet(mulberry32(a.seed));

const rng = mulberry32(a.seed + gen0), adam = { t: 0, m: [...cand.w, ...cand.b].map((p) => new Float32Array(p.length)), v: [...cand.w, ...cand.b].map((p) => new Float32Array(p.length)) };
const win = [];   // 直近 window 世代のデータ
for (let gen = gen0 + 1; gen <= a.gens; gen++) {
  const t0 = Date.now();
  const sp = await selfplay(best, { games: a.games, nodes: a.nodes, threads: a.threads, seed: a.seed * 1e6 + gen * 1e4, randPlies: a['rand-plies'] },
    (d, n) => process.stderr.write(`\r第 ${gen} 世代 自己対局 ${d}/${n}  `));
  win.push(sp); if (win.length > a.window) win.shift();
  // 目標 = 結果と探索の値の混ぜ合わせ（beta が探索の値の割合）
  const n = win.reduce((s, r) => s + r.n, 0), X = new Float32Array(n * FEATURE_DIM), Y = new Float32Array(n);
  let o = 0;
  for (const r of win) { X.set(r.X, o * FEATURE_DIM); for (let i = 0; i < r.n; i++) Y[o + i] = (1 - a.beta) * r.Z[i] + a.beta * r.Q[i]; o += r.n; }
  process.stderr.write(`\r第 ${gen} 世代 学習 ${n} 局面          `);
  const loss = fit(cand, { X, Y, n }, { epochs: a.epochs, batch: a.batch, lr: a.lr, rng }, adam);
  writeFileSync(dir + `gen-${gen}.json`, JSON.stringify(toJSON(cand)));
  const spec = { kind: 'net', net: toJSON(cand) };
  const ar = await arena(spec, best, { games: a['arena-games'], nodes: a['arena-nodes'], threads: a.threads, seed: 777 + gen },
    (d, m) => process.stderr.write(`\r第 ${gen} 世代 対戦 ${d}/${m}  `));
  const adopted = ar.score >= a.accept;
  if (adopted) { best = spec; writeFileSync(dir + 'best.json', JSON.stringify(spec.net)); }
  const sec = Math.round((Date.now() - t0) / 1000);
  const row = [gen, sp.n, sp.plies.toFixed(1), (sp.draw / a.games).toFixed(2), loss.toFixed(4), ar.score.toFixed(3), ar.win, ar.draw, ar.loss, adopted ? 1 : 0, sec].join('\t');
  appendFileSync(logFile, row + '\n');
  process.stderr.write('\r' + ' '.repeat(50) + '\r');
  console.log(`gen ${gen}: ${sp.n} 局面 平均 ${sp.plies.toFixed(0)} 手 引き分け ${(100 * sp.draw / a.games).toFixed(0)}% 損失 ${loss.toFixed(4)} 対戦 ${ar.win}-${ar.draw}-${ar.loss} 勝率 ${(100 * ar.score).toFixed(1)}% ${adopted ? '採用' : '見送り'} ${sec} 秒`);
}
