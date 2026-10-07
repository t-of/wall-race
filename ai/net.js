// 小さな網（全結合・ReLU・出力は tanh）。入力は features.js のベクトル、出力は手番側の勝ちやすさ（−1〜1）。
// 重みは JSON { sizes, w: [層ごとの配列（[入力×出力] の行ごと）], b: [...] }。依存なし、Node でもブラウザでも読める。
import { FEATURE_DIM, features } from './features.js';

export const HIDDEN = [64, 32];
export const NET_SCALE = 1000;   // 探索の点にするときの倍率（手書きは 1 歩 = 100 点。戻る手の減点は 150）

export function createNet(rng = Math.random, hidden = HIDDEN) {
  const sizes = [FEATURE_DIM, ...hidden, 1];
  const w = [], b = [];
  for (let l = 0; l + 1 < sizes.length; l++) {
    const [n, m] = [sizes[l], sizes[l + 1]];
    const s = Math.sqrt(2 / n) * (l + 2 === sizes.length ? 0.1 : 1);
    const a = new Float32Array(n * m);
    for (let i = 0; i < a.length; i++) a[i] = (rng() + rng() + rng() - 1.5) * 2 * s;
    w.push(a); b.push(new Float32Array(m));
  }
  return { sizes, w, b };
}

// 入力 x → 手番側の値。acts を渡すと各層の値が入る（学習用）
export function forward(net, x, acts = []) {
  let h = x;
  const L = net.sizes.length - 1;
  for (let l = 0; l < L; l++) {
    const n = net.sizes[l], m = net.sizes[l + 1], w = net.w[l];
    const o = Float32Array.from(net.b[l]);
    for (let i = 0; i < n; i++) {
      const v = h[i];
      if (!v) continue;
      const off = i * m;
      for (let j = 0; j < m; j++) o[j] += w[off + j] * v;
    }
    if (l + 1 < L) for (let j = 0; j < m; j++) if (o[j] < 0) o[j] = 0;
    acts[l] = o;
    h = o;
  }
  return Math.tanh(h[0]);
}

export const toJSON = (net) => ({
  sizes: net.sizes,
  w: net.w.map((a) => Array.from(a, (v) => +v.toPrecision(6))),
  b: net.b.map((a) => Array.from(a, (v) => +v.toPrecision(6))),
});
export const fromJSON = (j) => ({ sizes: j.sizes, w: j.w.map((a) => Float32Array.from(a)), b: j.b.map((a) => Float32Array.from(a)) });
export const cloneNet = (net) => fromJSON(toJSON(net));

// think の evaluate に渡す。me から見た網の値 × NET_SCALE
export function netEvaluate(net) {
  const buf = new Float32Array(FEATURE_DIM);
  return (s, me) => forward(net, features(s, me, buf)) * NET_SCALE;
}
