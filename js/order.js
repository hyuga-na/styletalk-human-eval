// 提示順と画面内の応答の並びを、評価者の seed から決定的に作る（仕様書 3.2・6.2）。
// DOM に依存しない（node でテストできる）。

// 32bit の種付き乱数
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 文字列 → 32bit ハッシュ（FNV-1a）
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rngFor(seed, label) {
  return mulberry32(hashString(`${seed}:${label}`));
}

// Fisher–Yates（新しい配列を返す）
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 同じ iid の画面どうしの最小距離が minGap 未満の組の数
export function countGapViolations(order, minGap) {
  const last = new Map();
  let v = 0;
  order.forEach((s, pos) => {
    const prev = last.get(s.iid);
    if (prev !== undefined && pos - prev < minGap) v++;
    last.set(s.iid, pos);
  });
  return v;
}

// 評価画面（main + check）の提示順。
//   main: 入力ごとに画面の順をランダムに決め、「各入力の 1 枚目をシャッフルした列」→「2 枚目をシャッフルした列」…と並べる。
//   check: その列のランダムな位置に差し込む。
//   同じ入力の画面が minGap 未満に近づいたらやり直す（乱数列は続けて使うので決定的）。
export function buildOrder(screens, seed, minGap, maxTries = 5000) {
  const rng = rngFor(seed, "order");
  const groups = new Map();
  const checks = [];
  for (const s of screens) {
    if (s.kind === "check") { checks.push(s); continue; }
    if (!groups.has(s.iid)) groups.set(s.iid, []);
    groups.get(s.iid).push(s);
  }
  // 画面の並びの初期値を sid 順にしておく（stimuli.json の並びに依存しないため）
  const groupList = [...groups.keys()].sort().map((k) =>
    groups.get(k).slice().sort((a, b) => a.sid.localeCompare(b.sid)));
  const checkList = checks.slice().sort((a, b) => a.sid.localeCompare(b.sid));

  let best = null, bestV = Infinity;
  for (let t = 0; t < maxTries; t++) {
    const perGroup = groupList.map((g) => shuffle(g, rng));
    const nBlocks = Math.max(0, ...perGroup.map((g) => g.length));
    let order = [];
    for (let k = 0; k < nBlocks; k++) {
      order = order.concat(shuffle(perGroup.filter((g) => g.length > k).map((g) => g[k]), rng));
    }
    for (const c of shuffle(checkList, rng)) {
      const p = Math.floor(rng() * (order.length + 1));
      order.splice(p, 0, c);
    }
    const v = countGapViolations(order, minGap);
    if (v < bestV) { best = order; bestV = v; }
    if (v === 0) break;
  }
  if (bestV > 0) console.warn(`buildOrder: minGap=${minGap} を満たす順序が見つからず（違反 ${bestV} 組）`);
  return best || [];
}

// 画面内の 4 応答の並び（評価者 × 画面ごとに固定）
export function orderRids(screen, seed) {
  return shuffle(screen.rids, rngFor(seed, `rids:${screen.sid}`));
}
