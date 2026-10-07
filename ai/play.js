// 1 局を打たせる（自己対局と対戦の共通部分）。Node でもブラウザでも読める。
import { newState, think, actions, commit, handEval, hand2Eval } from './engine.js';
import { features, FEATURE_DIM } from './features.js';
import { fromJSON, netEvaluate, NET_SCALE } from './net.js';

export function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// spec: { kind: 'hand' } か { kind: 'net', net: JSON }。value は探索の点 → −1〜1（学習の目標用）
export function makeEvaluator(spec) {
  if (spec.kind === 'hand') return { evaluate: handEval, value: (sc) => Math.tanh(sc / 400) };
  if (spec.kind === 'hand2') return { evaluate: hand2Eval, value: (sc) => Math.tanh(sc / 400) };
  return { evaluate: netEvaluate(fromJSON(spec.net)), value: (sc) => Math.max(-1, Math.min(1, sc / NET_SCALE)) };
}

// specs[0] が赤（先手）、specs[1] が青。最初の randPlies 手はランダムで局面を散らす（seed で決まる）。
// maxPlies 手で決まらなければ引き分け。record なら (特徴, 探索の値) を集める。
// 戻り値 { winner（0 赤 / 1 青 / −1 引き分け）, plies, X, Q, Z（手番側から見た結果）, N }
export function playGame(specs, { nodes = 300, seed = 1, randPlies = 6, maxPlies = 300, record = false } = {}) {
  const ev = specs.map(makeEvaluator), rng = mulberry32(seed), s = newState();
  const xs = [], qs = [], who = [];
  let winner = -1, ply = 0;
  for (; ply < maxPlies && winner < 0; ply++) {
    const me = ply % 2;
    let a;
    if (ply < randPlies) {
      const acts = actions(s, me);
      a = acts[Math.floor(rng() * acts.length)] || null;
    } else {
      a = think(s, me, { nodes, evaluate: ev[me].evaluate, rng });
      if (record && a) { xs.push(features(s, me)); qs.push(ev[me].value(think.last.score)); who.push(me); }
    }
    if (commit(s, me, a)) winner = me;
  }
  const n = xs.length, X = new Float32Array(n * FEATURE_DIM), Q = Float32Array.from(qs);
  xs.forEach((x, i) => X.set(x, i * FEATURE_DIM));
  const Z = Float32Array.from(who, (m) => (winner < 0 ? 0 : m === winner ? 1 : -1));
  return { winner, plies: ply, X, Q, Z, N: n };
}
