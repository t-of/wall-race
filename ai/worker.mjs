// worker_threads で局を並列に打つ。runPool(tasks, 並列数) → 結果の配列（tasks と同じ順）。
// task は { specs, opts }（playGame の引数）。子スレッドとして読まれたときは、受けた task を打って返すだけ。
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { playGame } from './play.js';

if (!isMainThread) {
  parentPort.on('message', (t) => {
    const r = playGame(t.specs, t.opts);
    parentPort.postMessage(r, [r.X.buffer, r.Q.buffer, r.Z.buffer]);
  });
}

export function runPool(tasks, threads = 8, onDone = () => {}) {
  return new Promise((resolve, reject) => {
    const out = new Array(tasks.length);
    let next = 0, done = 0;
    const workers = [];
    const feed = (w) => {
      if (next < tasks.length) { const i = next++; w.i = i; w.postMessage(tasks[i]); }
      else { w.terminate(); }
    };
    for (let k = 0; k < Math.min(threads, tasks.length); k++) {
      const w = new Worker(new URL(import.meta.url));
      w.on('message', (r) => {
        out[w.i] = r; onDone(++done, tasks.length);
        if (done === tasks.length) { workers.forEach((x) => x.terminate()); resolve(out); } else feed(w);
      });
      w.on('error', reject);
      workers.push(w); feed(w);
    }
    if (!tasks.length) resolve(out);
  });
}

// --名前 値 の引数を defaults の型に直して返す
export function parseArgs(defaults, argv = process.argv.slice(2)) {
  const o = { ...defaults };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    if (!(k in defaults)) throw new Error('知らない引数: ' + argv[i]);
    o[k] = typeof defaults[k] === 'number' ? Number(argv[i + 1]) : argv[i + 1];
  }
  return o;
}
