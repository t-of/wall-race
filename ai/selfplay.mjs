// 自己対局で (特徴, 結果) を集める。単独で動かすと速さと結果の割合を出すだけ（試走用）。
//   node ai/selfplay.mjs --games 16 --nodes 300 --net ai/runs/x/best.json
import { readFileSync } from 'node:fs';
import { runPool, parseArgs } from './worker.mjs';
import { FEATURE_DIM } from './features.js';

export const toSpec = (f) => (f === 'hand' ? { kind: 'hand' } : { kind: 'net', net: JSON.parse(readFileSync(f, 'utf8')) });

// spec の評価どうしで games 局。戻り値 { X, Q, Z, n, red, blue, draw, plies }
export async function selfplay(spec, { games, nodes, threads, seed, randPlies = 6, maxPlies = 300 }, onDone) {
  const tasks = Array.from({ length: games }, (_, i) => ({ specs: [spec, spec], opts: { nodes, seed: seed + i, randPlies, maxPlies, record: true } }));
  const rs = await runPool(tasks, threads, onDone);
  const n = rs.reduce((a, r) => a + r.N, 0), X = new Float32Array(n * FEATURE_DIM), Q = new Float32Array(n), Z = new Float32Array(n);
  let o = 0;
  for (const r of rs) { X.set(r.X, o * FEATURE_DIM); Q.set(r.Q, o); Z.set(r.Z, o); o += r.N; }
  const count = (w) => rs.filter((r) => r.winner === w).length;
  return { X, Q, Z, n, red: count(0), blue: count(1), draw: count(-1), plies: rs.reduce((a, r) => a + r.plies, 0) / games };
}

if (process.argv[1] && process.argv[1].endsWith('selfplay.mjs')) {
  const a = parseArgs({ games: 16, nodes: 300, threads: 8, seed: 1, net: 'hand' });
  const t0 = Date.now();
  const r = await selfplay(toSpec(a.net), { games: a.games, nodes: a.nodes, threads: a.threads, seed: a.seed });
  console.log(`${a.games} 局 ${((Date.now() - t0) / 1000).toFixed(1)} 秒 / 局面 ${r.n} / 平均 ${r.plies.toFixed(1)} 手 / 赤 ${r.red} 青 ${r.blue} 引き分け ${r.draw}`);
}
