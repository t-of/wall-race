// 手番 me から見た入力ベクトル。9×13 のマスごとに 5 枚の面 ＋ 少数のスカラー。
// 面: 0 手番のコマ / 1 相手のコマ / 2 横壁 / 3 縦壁（左上の角のマスに 1）/ 4 ゴールまでの歩数の地図（/30、上限 30）
// ゴールは両者とも一番上の段なので、歩数の地図は 1 枚で両者に共通（手番側・相手側の別の地図は同じ値になる）。
// スカラー: 手番の最短歩数 /30、相手の最短歩数 /30、(相手 − 手番) /10（−3〜3 に収める）
import { W, H, dist, distMap } from './engine.js';

const N = W * H, PLANES = 5;
export const FEATURE_DIM = N * PLANES + 3;
const map = new Uint8Array(N);

export function features(s, me, out = new Float32Array(FEATURE_DIM)) {
  out.fill(0);
  const p = s.pawns[me], o = s.pawns[1 - me];
  out[p.c + p.r * W] = 1;
  out[N + o.c + o.r * W] = 1;
  for (let i = 0; i < N; i++) {
    if (s.h[i]) out[2 * N + i] = 1;
    if (s.v[i]) out[3 * N + i] = 1;
  }
  distMap(s, map);
  for (let i = 0; i < N; i++) out[4 * N + i] = Math.min(map[i], 30) / 30;
  const dm = Math.min(dist(s, p), 30), dp = Math.min(dist(s, o), 30);
  out[PLANES * N] = dm / 30; out[PLANES * N + 1] = dp / 30;
  out[PLANES * N + 2] = Math.max(-3, Math.min(3, (dp - dm) / 10));
  return out;
}

// 左右反転: flipped[i] = x[FLIP[i]]（壁は左端の列 c が c..c+1 を覆うので、反転すると W-2-c）
export const FLIP = new Int32Array(FEATURE_DIM).map((_, i) => i);
for (let pl = 0; pl < PLANES; pl++)
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const wall = pl === 2 || pl === 3;
      if (wall && c > W - 2) continue;
      FLIP[pl * N + r * W + c] = pl * N + r * W + (wall ? W - 2 - c : W - 1 - c);
    }
export function flip(x, out = new Float32Array(FEATURE_DIM)) {
  for (let i = 0; i < FEATURE_DIM; i++) out[i] = x[FLIP[i]];
  return out;
}
