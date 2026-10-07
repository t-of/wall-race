'use strict';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'wall-race.' で始める。
const STORE = 'wall-race.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'wall-race', text: '盤を1台で交互に遊ぶ、壁立てレース' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- ここからアプリ本体 ----

const W = 9, H = 13, S = 30, G = 8, P = S + G;
const COLORS = ['#ff6b6b', '#5ca8ff'], NAMES = ['赤', '青'];
// 壁は左上の角のマス (c,r) で表し、c + r * W の位置に置いた人の番号 + 1 を入れる（探索で速く引けるように配列にする）
const wallSet = () => new Uint8Array(W * H);
const has = (a, c, r) => c >= 0 && r >= 0 && c < W && r < H && a[c + r * W] !== 0;
let pawns, walls, seenPos, turn, winner, mode, preview, timer;
let cpus = 0;   // CPU の数。1 なら青が CPU、2 なら両方

function reset() {
  pawns = [{ c: 2, r: H - 1 }, { c: W - 3, r: H - 1 }];
  walls = { h: wallSet(), v: wallSet() };
  seenPos = new Map(); turn = 0; winner = -1; mode = 'move'; preview = null;
  clearTimeout(timer);
  next();
}

// (c,r) から (dc,dr) へ壁で行けないか（盤の外も不可）
function blocked(w, c, r, dc, dr) {
  const nc = c + dc, nr = r + dr;
  if (nc < 0 || nc >= W || nr < 0 || nr >= H) return true;
  if (dc) { const x = Math.min(c, nc); return has(w.v, x, r) || has(w.v, x, r - 1); }
  const y = Math.min(r, nr);
  return has(w.h, c, y) || has(w.h, c - 1, y);
}
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

function moves(i) {
  const p = pawns[i], o = pawns[1 - i];
  return DIRS.map(([a, b]) => ({ c: p.c + a, r: p.r + b }))
    .filter((q, k) => !blocked(walls, p.c, p.r, DIRS[k][0], DIRS[k][1]) && !(q.c === o.c && q.r === o.r));
}

// 相手のコマは無視して、一番上の段までの最短の歩数（着けなければ Infinity）
const seen = new Uint32Array(W * H), queue = new Int16Array(W * H), parent = new Int16Array(W * H);
let stamp = 0, goal = -1;   // 最後に着いたゴールのマス。parent をたどると道になる
function dist(w, p) {
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
        if (seen[n] !== stamp && !blocked(w, c, r, a, b)) { seen[n] = stamp; parent[n] = k; queue[tail++] = n; }
      }
    }
  }
  return Infinity;
}

// 十字・重なりにならないか（道がふさがるかは見ない）
function wallShapeOk(o, c, r) {
  if (c < 0 || c > W - 2 || r < 0 || r > H - 2) return false;
  const a = walls[o], b = walls[o === 'h' ? 'v' : 'h'];
  if (has(b, c, r)) return false;
  return o === 'h' ? !(has(a, c - 1, r) || has(a, c + 1, r) || has(a, c, r))
                   : !(has(a, c, r - 1) || has(a, c, r + 1) || has(a, c, r));
}
function canWall(o, c, r) {
  if (!wallShapeOk(o, c, r)) return false;
  walls[o][c + r * W] = 1;
  const ok = pawns.every((p) => dist(walls, p) < Infinity);
  walls[o][c + r * W] = 0;
  return ok;
}

const isCpu = (i) => cpus === 2 || (cpus === 1 && i === 1);
function next() {
  draw();
  if (winner < 0 && isCpu(turn)) timer = setTimeout(cpu, 300);
}
const posKey = () => pawns.map((p) => p.c + ',' + p.r).join(' ') + walls.h.join('') + walls.v.join('');
function end() { seenPos.set(posKey(), (seenPos.get(posKey()) || 0) + 1); turn = 1 - turn; preview = null; next(); }
function moveTo(c, r) {
  pawns[turn] = { c, r };
  if (r === 0) { winner = turn; preview = null; draw(); } else end();
}
function placeWall(o, c, r) { walls[o][c + r * W] = turn + 1; end(); }

// ---- CPU: 反復深化のアルファベータ探索（1 歩 = 100 点） ----
const WIN = 100000, THINK_MS = 1200, MAX_WALL_CANDS = 12;

// me の番のときの形勢: ゴールまでの歩数の差
function evaluate(me) {
  return 100 * (dist(walls, pawns[1 - me]) - dist(walls, pawns[me]));
}

// 指せる手を、良さそうな順に。壁は相手の道を自分より長く延ばすものだけ
function actions(me) {
  const op = 1 - me, dm0 = dist(walls, pawns[me]), dp0 = dist(walls, pawns[op]), acts = [];
  for (const q of moves(me)) acts.push({ q, s: 100 * (dm0 - dist(walls, q)) });
  {
    // 相手の道を延ばせる壁は、相手の最短の道のどこかを切るものだけ
    const cands = new Set();
    dist(walls, pawns[op]);
    for (let k = goal; parent[k] >= 0; k = parent[k]) {
      const j = parent[k], c = Math.min(k % W, j % W), r = Math.floor(Math.min(k, j) / W);
      if (k - j === W || j - k === W) cands.add('h' + c + ',' + r).add('h' + (c - 1) + ',' + r);
      else cands.add('v' + c + ',' + r).add('v' + c + ',' + (r - 1));
    }
    const ws = [];
    for (const key of cands) {
      const o = key[0], [c, r] = key.slice(1).split(',').map(Number);
      if (!wallShapeOk(o, c, r)) continue;
      walls[o][c + r * W] = 1;
      const dm = dist(walls, pawns[me]), dp = dist(walls, pawns[op]);
      walls[o][c + r * W] = 0;
      if (dm === Infinity || dp === Infinity) continue;
      const gain = (dp - dp0) - (dm - dm0);
      if (gain > 0) ws.push({ w: [o, c, r], s: 100 * gain });
    }
    ws.sort((a, b) => b.s - a.s);
    acts.push(...ws.slice(0, MAX_WALL_CANDS));
  }
  return acts.sort((a, b) => b.s - a.s);
}

function play(me, a) {
  if (a.q) { const old = pawns[me]; pawns[me] = a.q; return () => { pawns[me] = old; }; }
  const [o, c, r] = a.w;
  walls[o][c + r * W] = me + 1;
  return () => { walls[o][c + r * W] = 0; };
}

const TIMEOUT = {};
function search(me, depth, alpha, beta, deadline) {
  if (pawns[1 - me].r === 0) return -WIN - depth;   // 相手がさっきの手でゴールした（早い負けほど低く）
  if (depth === 0) return evaluate(me);
  if (performance.now() > deadline) throw TIMEOUT;
  const acts = actions(me);
  if (!acts.length) return -search(1 - me, depth - 1, -beta, -alpha, deadline);   // パス
  for (const a of acts) {
    const undo = play(me, a);
    let v;
    try { v = -search(1 - me, depth - 1, -beta, -alpha, deadline); } finally { undo(); }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return alpha;
}

// 時間いっぱいまで 1 手ずつ深く読み、読み切れた一番深い結果の最善手を返す
function think(me, ms = THINK_MS) {
  const deadline = performance.now() + ms;
  let acts = actions(me);
  if (!acts.length) return null;
  for (let i = acts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [acts[i], acts[j]] = [acts[j], acts[i]]; }
  acts.sort((a, b) => b.s - a.s);   // 同じ点の手はばらばらに並ぶ
  let best = acts[0];
  for (let depth = 1; depth <= 30; depth++) {
    try {
      let alpha = -Infinity, bestHere = null;
      for (const a of acts) {
        const undo = play(me, a);
        let v;
        try {
          // 前に出た形へ戻る手は減点（壁が無制限なので、行ったり来たりで終わらなくなるのを防ぐ）
          v = -search(1 - me, depth - 1, -Infinity, -alpha, deadline) - 150 * (seenPos.get(posKey()) || 0);
        } finally { undo(); }
        if (v > alpha) { alpha = v; bestHere = a; }
      }
      best = bestHere;
      acts = [best, ...acts.filter((a) => a !== best)];
      if (alpha >= WIN / 2) break;   // 勝ちが見えた
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      break;
    }
  }
  return best;
}

function cpu() {
  const a = think(turn);
  if (!a) return end();   // 動けず壁もないときはパス
  if (a.q) moveTo(a.q.c, a.q.r); else placeWall(...a.w);
}

function draw() {
  const bw = W * P - G, bh = H * P - G;
  const g = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++)
    g.push(`<rect x="${c * P}" y="${r * P}" width="${S}" height="${S}" rx="4" fill="${r === 0 ? '#3b4a73' : '#2c3857'}"/>`);
  if (winner < 0 && mode === 'move')
    for (const q of moves(turn))
      g.push(`<rect x="${q.c * P}" y="${q.r * P}" width="${S}" height="${S}" rx="4" fill="${COLORS[turn]}" opacity=".45" data-c="${q.c}" data-r="${q.r}"/>`);
  const wr = (o, c, r, extra) => o === 'h'
    ? `<rect x="${c * P}" y="${r * P + S}" width="${2 * S + G}" height="${G}" ${extra}/>`
    : `<rect x="${c * P + S}" y="${r * P}" width="${G}" height="${2 * S + G}" ${extra}/>`;
  for (const o of ['h', 'v']) walls[o].forEach((x, i) => { if (x) g.push(wr(o, i % W, Math.floor(i / W), `fill="${COLORS[x - 1]}"`)); });
  if (preview) g.push(wr(preview.o, preview.c, preview.r, `fill="${COLORS[turn]}" opacity=".5" stroke="#fff"`));
  pawns.forEach((p, i) => g.push(`<circle cx="${p.c * P + S / 2}" cy="${p.r * P + S / 2}" r="${S / 2 - 3}" fill="${COLORS[i]}"/>`));
  const b = document.getElementById('board');
  b.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
  b.innerHTML = g.join('');
  document.getElementById('info').innerHTML = winner >= 0
    ? `<b style="color:${COLORS[winner]}">${NAMES[winner]}の勝ち！</b>`
    : `<b style="color:${COLORS[turn]}">${NAMES[turn]}の番</b>${preview ? ' ・ もう一度タップで確定' : ''}`;
  document.getElementById('again').hidden = winner < 0;
  document.querySelectorAll('[data-mode]').forEach((e) => { e.hidden = winner >= 0; e.setAttribute('aria-pressed', e.dataset.mode === mode); });
}

document.getElementById('board').addEventListener('click', (e) => {
  if (winner >= 0 || isCpu(turn)) return;
  const b = e.currentTarget, rc = b.getBoundingClientRect(), vb = b.viewBox.baseVal;
  const x = (e.clientX - rc.left) * vb.width / rc.width, y = (e.clientY - rc.top) * vb.height / rc.height;
  if (mode === 'move') {
    const c = Math.floor(x / P), r = Math.floor(y / P);
    if (!moves(turn).some((q) => q.c === c && q.r === r)) return;
    return moveTo(c, r);
  }
  const c = Math.round((x + G / 2) / P) - 1, r = Math.round((y + G / 2) / P) - 1;
  if (preview && preview.o === mode && preview.c === c && preview.r === r) {
    placeWall(mode, c, r);
  } else {
    preview = canWall(mode, c, r) ? { o: mode, c, r } : null;
    draw();
  }
});
document.getElementById('modes').addEventListener('click', (e) => {
  const m = e.target.dataset.mode;
  if (m) { mode = m; preview = null; draw(); }
});
document.getElementById('players').addEventListener('click', (e) => {
  const n = e.target.dataset.cpus;
  if (n === undefined) return;
  cpus = Number(n);
  document.querySelectorAll('[data-cpus]').forEach((b) => b.setAttribute('aria-pressed', b === e.target));
  reset();
});
document.getElementById('again').addEventListener('click', reset);
reset();
