// engine.js の手書き評価 CPU が main.js の CPU と同じ手を選ぶか、ほか少しの確認。node ai/test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';
import { newState, think, actions, commit, dist, distMap, W, H } from './engine.js';
import { features, flip, FEATURE_DIM } from './features.js';
import { createNet, forward, netEvaluate } from './net.js';
import { mulberry32 } from './play.js';

// main.js をそのまま（画面は空の飾りで）動かす。performance.now は呼ぶたびに 1 進む時計にして、
// 「ms = 節点数」で打ち切らせる（engine の nodes と同じ数え方）
const el = { setAttribute() {}, addEventListener() {}, innerHTML: '', hidden: false };
let clock = 0;
const ctx = vm.createContext({
  document: { getElementById: () => el, querySelectorAll: () => [] }, WebAppKit: { init() {} }, navigator: {},
  setTimeout() {}, clearTimeout() {}, console, performance: { now: () => clock++ },
});
vm.runInContext(readFileSync(new URL('../main.js', import.meta.url), 'utf8'), ctx);
const mainThink = (s, me, nodes, seed) => {
  ctx.ST = s; ctx.rnd = mulberry32(seed); ctx.nodes = nodes;
  return vm.runInContext('pawns = ST.pawns; walls = { h: ST.h, v: ST.v }; seenPos = ST.seen; Math.random = rnd; think(' + me + ', nodes)', ctx);
};
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// ランダムに進めた局面で、同じ手になること
let checked = 0;
for (let g = 0; g < 6; g++) {
  const s = newState(), rng = mulberry32(g + 100);
  for (let ply = 0; ply < 40 + g * 4; ply++) {
    const me = ply % 2, acts = actions(s, me);
    if (ply % 7 === 0) {
      const nodes = [20, 50, 100][ply % 3];
      const a = think(s, me, { nodes, rng: mulberry32(ply) }), b = mainThink(s, me, nodes, ply);
      assert(same(a, b), `g${g} ply${ply}: engine ${JSON.stringify(a)} main ${JSON.stringify(b)}`);
      checked++;
    }
    if (commit(s, me, acts[Math.floor(rng() * acts.length)])) break;
  }
}
console.log(`main.js と同じ手: ${checked} 局面 OK`);

// 歩数の地図が dist と合う、左右反転を 2 回かけると元に戻る、網が動く
const s = newState(), rng = mulberry32(5), map = new Uint8Array(W * H);
for (let ply = 0; ply < 60; ply++) {
  const me = ply % 2, acts = actions(s, me);
  commit(s, me, acts[Math.floor(rng() * acts.length)]);
  distMap(s, map);
  for (const p of s.pawns) assert.equal(map[p.c + p.r * W], dist(s, p));
}
const x = features(s, 0);
assert.equal(x.length, FEATURE_DIM);
assert(same(Array.from(flip(flip(x))), Array.from(x)));
assert(flip(x).some((v, i) => v !== x[i]));
const v = forward(createNet(mulberry32(1)), x);
assert(Number.isFinite(v) && Math.abs(v) <= 1);
const a = think(newState(), 0, { nodes: 50, evaluate: netEvaluate(createNet(mulberry32(1))) });
assert(a);
console.log('地図・左右反転・網: OK');
