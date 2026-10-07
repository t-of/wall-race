// main.js のゲーム処理と CPU（反復深化のアルファベータ）を、グローバルに頼らない形で切り出したもの。
// 盤は state（newState() で作る）を渡して使う。評価関数は think の evaluate で差し替える。
// 強さの比較用に、時間ではなく「読む節点数」で打ち切れる（opts.nodes）。Node でもブラウザでも読める。
export const W = 9, H = 13, WIN = 100000, MAX_WALL_CANDS = 12;
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// 壁は左上の角のマス (c,r) の位置 c + r * W に、置いた人の番号 + 1 を入れる
export const newState = () => ({
  pawns: [{ c: 2, r: H - 1 }, { c: W - 3, r: H - 1 }],
  h: new Uint8Array(W * H), v: new Uint8Array(W * H),
  seen: new Map(),   // 出た形（posKey）→ 回数。戻る手の減点に使う
});
const has = (a, c, r) => c >= 0 && r >= 0 && c < W && r < H && a[c + r * W] !== 0;

export function blocked(s, c, r, dc, dr) {
  const nc = c + dc, nr = r + dr;
  if (nc < 0 || nc >= W || nr < 0 || nr >= H) return true;
  if (dc) { const x = Math.min(c, nc); return has(s.v, x, r) || has(s.v, x, r - 1); }
  const y = Math.min(r, nr);
  return has(s.h, c, y) || has(s.h, c - 1, y);
}

export function moves(s, i) {
  const p = s.pawns[i], o = s.pawns[1 - i];
  return DIRS.map(([a, b]) => ({ c: p.c + a, r: p.r + b }))
    .filter((q, k) => !blocked(s, p.c, p.r, DIRS[k][0], DIRS[k][1]) && !(q.c === o.c && q.r === o.r));
}

// 相手のコマは無視して、一番上の段までの最短の歩数（着けなければ Infinity）
const seen = new Uint32Array(W * H), queue = new Int16Array(W * H), parent = new Int16Array(W * H);
let stamp = 0, goal = -1;   // 最後に着いたゴールのマス。parent をたどると道になる
export function dist(s, p) {
  stamp++;
  let head = 0, tail = 0;
  queue[tail++] = p.c + p.r * W; seen[p.c + p.r * W] = stamp; parent[p.c + p.r * W] = -1;
  for (let d = 0; head < tail; d++) {
    const end = tail;
    for (; head < end; head++) {
      const k = queue[head], c = k % W, r = (k - c) / W;
      if (r === 0) { goal = k; return d; }
      for (const [a, b] of DIRS) {
        const n = k + a + b * W;
        if (seen[n] !== stamp && !blocked(s, c, r, a, b)) { seen[n] = stamp; parent[n] = k; queue[tail++] = n; }
      }
    }
  }
  return Infinity;
}

// 全マスから一番上の段までの歩数を out（W*H）に書く。着けないマスは 99。ゴールは両者とも同じ段なので地図は 1 枚
export function distMap(s, out) {
  out.fill(99);
  let head = 0, tail = 0;
  for (let c = 0; c < W; c++) { out[c] = 0; queue[tail++] = c; }
  while (head < tail) {
    const k = queue[head++], c = k % W, r = (k - c) / W;
    for (const [a, b] of DIRS) {
      const n = k + a + b * W;
      if (out[n] === 99 && !blocked(s, c, r, a, b)) { out[n] = out[k] + 1; queue[tail++] = n; }
    }
  }
}

// 十字・重なりにならないか（道がふさがるかは見ない）
export function wallShapeOk(s, o, c, r) {
  if (c < 0 || c > W - 2 || r < 0 || r > H - 2) return false;
  const a = s[o], b = s[o === 'h' ? 'v' : 'h'];
  if (has(b, c, r)) return false;
  return o === 'h' ? !(has(a, c - 1, r) || has(a, c + 1, r) || has(a, c, r))
                   : !(has(a, c, r - 1) || has(a, c, r + 1) || has(a, c, r));
}

export const posKey = (s) => s.pawns.map((p) => p.c + ',' + p.r).join(' ') + s.h.join('') + s.v.join('');

// 手書きの評価: me の番のときの、ゴールまでの歩数の差 ×100
export const handEval = (s, me) => 100 * (dist(s, s.pawns[1 - me]) - dist(s, s.pawns[me]));

// i の最短の道を切る壁を 1 枚置いて、i の道を最大何歩延ばせるか（両者の道は残す壁だけ）
export function gainOn(s, i) {
  const p = s.pawns[i], d0 = dist(s, p), path = [];
  for (let k = goal; parent[k] >= 0; k = parent[k]) path.push(k, parent[k]);
  let best = 0;
  for (let t = 0; t < path.length; t += 2) {
    const k = path[t], j = path[t + 1], c = Math.min(k % W, j % W), r = Math.floor(Math.min(k, j) / W);
    const cs = k - j === W || j - k === W ? [['h', c, r], ['h', c - 1, r]] : [['v', c, r], ['v', c, r - 1]];
    for (const [o, x, y] of cs) {
      if (!wallShapeOk(s, o, x, y)) continue;
      s[o][x + y * W] = 1;
      const a = dist(s, p), b = a - d0 > best ? dist(s, s.pawns[1 - i]) : 0;
      s[o][x + y * W] = 0;
      if (a < Infinity && b < Infinity && a - d0 > best) best = a - d0;
    }
  }
  return best;
}
// 手書き 2: 歩数の差 ＋ 「壁 1 枚で延ばせる歩数」の差（手書き同士の対局の結果からロジスティック回帰で重みを決めた）
export const GAIN_K = 130;
export const hand2Eval = (s, me) => handEval(s, me) + GAIN_K * (gainOn(s, 1 - me) - gainOn(s, me));

// 指せる手を、良さそうな順に。壁は相手の道を自分より長く延ばすものだけ
export function actions(s, me) {
  const op = 1 - me, dm0 = dist(s, s.pawns[me]), dp0 = dist(s, s.pawns[op]), acts = [];
  for (const q of moves(s, me)) acts.push({ q, s: 100 * (dm0 - dist(s, q)) });
  const cands = new Set();
  dist(s, s.pawns[op]);
  for (let k = goal; parent[k] >= 0; k = parent[k]) {
    const j = parent[k], c = Math.min(k % W, j % W), r = Math.floor(Math.min(k, j) / W);
    if (k - j === W || j - k === W) cands.add('h' + c + ',' + r).add('h' + (c - 1) + ',' + r);
    else cands.add('v' + c + ',' + r).add('v' + c + ',' + (r - 1));
  }
  const ws = [];
  for (const key of cands) {
    const o = key[0], [c, r] = key.slice(1).split(',').map(Number);
    if (!wallShapeOk(s, o, c, r)) continue;
    s[o][c + r * W] = 1;
    const dm = dist(s, s.pawns[me]), dp = dist(s, s.pawns[op]);
    s[o][c + r * W] = 0;
    if (dm === Infinity || dp === Infinity) continue;
    const gain = (dp - dp0) - (dm - dm0);
    if (gain > 0) ws.push({ w: [o, c, r], s: 100 * gain });
  }
  ws.sort((a, b) => b.s - a.s);
  acts.push(...ws.slice(0, MAX_WALL_CANDS));
  return acts.sort((a, b) => b.s - a.s);
}

// 探索用。手を指して、戻す関数を返す
export function play(s, me, a) {
  if (a.q) { const old = s.pawns[me]; s.pawns[me] = a.q; return () => { s.pawns[me] = old; }; }
  const [o, c, r] = a.w;
  s[o][c + r * W] = me + 1;
  return () => { s[o][c + r * W] = 0; };
}

// 本物の 1 手。出た形を覚える。ゴールしたら true（a が null ならパス）
export function commit(s, me, a) {
  if (a) {
    play(s, me, a);
    if (a.q && a.q.r === 0) return true;
  }
  const k = posKey(s);
  s.seen.set(k, (s.seen.get(k) || 0) + 1);
  return false;
}

const TIMEOUT = {};
function search(s, me, depth, alpha, beta, cx) {
  if (s.pawns[1 - me].r === 0) return -WIN - depth;   // 相手がさっきの手でゴールした
  if (depth === 0) return cx.evaluate(s, me);
  cx.nodes++;
  if (cx.nodes > cx.limit || (cx.deadline && performance.now() > cx.deadline)) throw TIMEOUT;
  const acts = actions(s, me);
  if (!acts.length) return -search(s, 1 - me, depth - 1, -beta, -alpha, cx);
  for (const a of acts) {
    const undo = play(s, me, a);
    let v;
    try { v = -search(s, 1 - me, depth - 1, -beta, -alpha, cx); } finally { undo(); }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return alpha;
}

// opts: { nodes（読む節点数の上限）, ms（時間の上限）, evaluate(s, me)（既定は手書き）, rng, maxDepth }
// 読み切れた一番深い結果の最善手を返す。think.last に { score, depth, nodes } を残す。
export function think(s, me, opts = {}) {
  const { nodes = Infinity, ms = 0, evaluate = handEval, rng = Math.random, maxDepth = 30 } = opts;
  const cx = { nodes: 0, limit: nodes, evaluate, deadline: ms ? performance.now() + ms : 0 };
  let acts = actions(s, me);
  if (!acts.length) return null;
  for (let i = acts.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [acts[i], acts[j]] = [acts[j], acts[i]]; }
  acts.sort((a, b) => b.s - a.s);   // 同じ点の手はばらばらに並ぶ
  let best = acts[0], score = 0, depthDone = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      let alpha = -Infinity, bestHere = null;
      for (const a of acts) {
        const undo = play(s, me, a);
        let v;
        try {
          // 前に出た形へ戻る手は減点（壁が無制限なので、行ったり来たりで終わらなくなるのを防ぐ）
          v = -search(s, 1 - me, depth - 1, -Infinity, -alpha, cx) - 150 * (s.seen.get(posKey(s)) || 0);
        } finally { undo(); }
        if (v > alpha) { alpha = v; bestHere = a; }
      }
      best = bestHere; score = alpha; depthDone = depth;
      acts = [best, ...acts.filter((a) => a !== best)];
      if (alpha >= WIN / 2) break;
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      break;
    }
  }
  think.last = { score, depth: depthDone, nodes: cx.nodes };
  return best;
}
