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

const W = 9, H = 13, S = 30, G = 8, P = S + G, WALLS = 10;
const COLORS = ['#ff6b6b', '#5ca8ff'], NAMES = ['赤', '青'];
const wallSet = () => new Set();
let pawns, walls, left, turn, winner, mode, preview, timer;
let cpus = 0;   // CPU の数。1 なら青が CPU、2 なら両方

function reset() {
  pawns = [{ c: 2, r: H - 1 }, { c: W - 3, r: H - 1 }];
  walls = { h: wallSet(), v: wallSet() };
  left = [WALLS, WALLS]; turn = 0; winner = -1; mode = 'move'; preview = null;
  clearTimeout(timer);
  next();
}

// (c,r) から (dc,dr) へ壁で行けないか（盤の外も不可）
function blocked(w, c, r, dc, dr) {
  const nc = c + dc, nr = r + dr;
  if (nc < 0 || nc >= W || nr < 0 || nr >= H) return true;
  if (dc) { const x = Math.min(c, nc); return w.v.has(x + ',' + r) || w.v.has(x + ',' + (r - 1)); }
  const y = Math.min(r, nr);
  return w.h.has(c + ',' + y) || w.h.has((c - 1) + ',' + y);
}
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

function moves(i) {
  const p = pawns[i], o = pawns[1 - i];
  return DIRS.map(([a, b]) => ({ c: p.c + a, r: p.r + b }))
    .filter((q, k) => !blocked(walls, p.c, p.r, DIRS[k][0], DIRS[k][1]) && !(q.c === o.c && q.r === o.r));
}

// 相手のコマは無視して、一番上の段までの最短の歩数（着けなければ Infinity）
function dist(w, p) {
  const seen = new Set([p.c + ',' + p.r]);
  let q = [[p.c, p.r]];
  for (let d = 0; q.length; d++) {
    const nq = [];
    for (const [c, r] of q) {
      if (r === 0) return d;
      for (const [a, b] of DIRS) {
        const k = (c + a) + ',' + (r + b);
        if (!seen.has(k) && !blocked(w, c, r, a, b)) { seen.add(k); nq.push([c + a, r + b]); }
      }
    }
    q = nq;
  }
  return Infinity;
}

function canWall(o, c, r) {
  if (c < 0 || c > W - 2 || r < 0 || r > H - 2 || left[turn] <= 0) return false;
  const a = walls[o], b = walls[o === 'h' ? 'v' : 'h'];
  if (b.has(c + ',' + r)) return false;                                       // 十字
  if (o === 'h' ? (a.has((c - 1) + ',' + r) || a.has((c + 1) + ',' + r) || a.has(c + ',' + r))
                : (a.has(c + ',' + (r - 1)) || a.has(c + ',' + (r + 1)) || a.has(c + ',' + r))) return false; // 重なり
  a.add(c + ',' + r);
  const ok = pawns.every((p) => dist(walls, p) < Infinity);
  a.delete(c + ',' + r);
  return ok;
}

const isCpu = (i) => cpus === 2 || (cpus === 1 && i === 1);
function next() {
  draw();
  if (winner < 0 && isCpu(turn)) timer = setTimeout(cpu, 500);
}
function end() { turn = 1 - turn; preview = null; next(); }
function moveTo(c, r) {
  pawns[turn] = { c, r };
  if (r === 0) { winner = turn; preview = null; draw(); } else end();
}
function placeWall(o, c, r) { walls[o].add(c + ',' + r); left[turn]--; end(); }
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// CPU: 相手の方がゴールに近ければ、差を一番広げる壁を置く。そうでなければ最短の道へ進む
// ponytail: 1 手読みの欲張り。強くするなら先読み（ミニマックス）を足す
function cpu() {
  const me = turn, op = 1 - turn;
  const gap = () => dist(walls, pawns[op]) - dist(walls, pawns[me]);
  const now = gap();
  if (now < 0 && left[me] > 0) {
    let best = [], bestGain = 0;
    for (const o of ['h', 'v']) for (let c = 0; c < W - 1; c++) for (let r = 0; r < H - 1; r++) {
      if (!canWall(o, c, r)) continue;
      walls[o].add(c + ',' + r);
      const gain = gap() - now;
      walls[o].delete(c + ',' + r);
      if (gain > bestGain) { best = [[o, c, r]]; bestGain = gain; } else if (gain === bestGain && gain > 0) best.push([o, c, r]);
    }
    if (best.length) return placeWall(...pick(best));
  }
  const ms = moves(me);
  if (!ms.length) return end();   // 動けず壁もないときはパス
  const ds = ms.map((q) => dist(walls, q));
  const min = Math.min(...ds);
  const q = pick(ms.filter((_, i) => ds[i] === min));
  moveTo(q.c, q.r);
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
  for (const o of ['h', 'v']) for (const k of walls[o]) { const [c, r] = k.split(',').map(Number); g.push(wr(o, c, r, 'fill="#ffd35c"')); }
  if (preview) g.push(wr(preview.o, preview.c, preview.r, 'fill="#ffd35c" opacity=".5" stroke="#fff"'));
  pawns.forEach((p, i) => g.push(`<circle cx="${p.c * P + S / 2}" cy="${p.r * P + S / 2}" r="${S / 2 - 3}" fill="${COLORS[i]}"/>`));
  const b = document.getElementById('board');
  b.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
  b.innerHTML = g.join('');
  document.getElementById('info').innerHTML = winner >= 0
    ? `<b style="color:${COLORS[winner]}">${NAMES[winner]}の勝ち！</b>`
    : `<b style="color:${COLORS[turn]}">${NAMES[turn]}の番</b> ・ 壁 赤${left[0]} / 青${left[1]}${preview ? ' ・ もう一度タップで確定' : ''}`;
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
