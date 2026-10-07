// 2 つの評価を、読む節点数をそろえて対戦させる（先手後手は入れ替え。同じ開局を 2 局ずつ）。
//   node ai/arena.mjs --a ai/runs/x/best.json --b hand --games 400 --nodes 300
// a / b は 'hand'（手書き）か網の JSON ファイル。
import { runPool, parseArgs } from './worker.mjs';
import { toSpec } from './selfplay.mjs';

// A から見た { win, draw, loss, score（勝ち 1・引き分け 0.5）}
export async function arena(specA, specB, { games, nodes, threads, seed = 1, randPlies = 6, maxPlies = 300 }, onDone) {
  const tasks = Array.from({ length: games }, (_, g) => ({
    specs: g % 2 ? [specB, specA] : [specA, specB],
    opts: { nodes, seed: seed + (g >> 1), randPlies, maxPlies },
  }));
  const rs = await runPool(tasks, threads, onDone);
  let win = 0, draw = 0, loss = 0;
  rs.forEach((r, g) => {
    if (r.winner < 0) draw++; else if ((r.winner === 0) === (g % 2 === 0)) win++; else loss++;
  });
  return { win, draw, loss, score: (win + draw / 2) / games };
}

if (process.argv[1] && process.argv[1].endsWith('arena.mjs')) {
  const a = parseArgs({ a: 'hand', b: 'hand', games: 40, nodes: 300, threads: 8, seed: 1, 'rand-plies': 6 });
  const t0 = Date.now();
  const r = await arena(toSpec(a.a), toSpec(a.b), { games: a.games, nodes: a.nodes, threads: a.threads, seed: a.seed, randPlies: a['rand-plies'] });
  const p = (x) => (100 * x / a.games).toFixed(1) + '%';
  console.log(`A=${a.a} B=${a.b} ${a.games} 局 節点 ${a.nodes} ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  console.log(`A 勝ち ${r.win} (${p(r.win)}) 引き分け ${r.draw} (${p(r.draw)}) 負け ${r.loss}  勝率（引き分け半分）${(100 * r.score).toFixed(1)}%`);
}
