// 提示順の性質を確かめる: node tests/order.test.mjs [stimuli.json]
//   決定性・各画面ちょうど 1 回・同じ入力の画面が minGap 以上離れる・画面内の並びの決定性
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildOrder, orderRids, countGapViolations } from "../js/order.js";

const path = process.argv[2] || new URL("../stimuli/stimuli.json", import.meta.url);
const stim = JSON.parse(readFileSync(path, "utf8"));
const minGap = 20;

for (let seed = 1; seed <= 200; seed++) {
  const s = seed * 7919;
  const o1 = buildOrder(stim.screens, s, minGap);
  const o2 = buildOrder(stim.screens.slice().reverse(), s, minGap);
  assert.deepEqual(o1.map((x) => x.sid), o2.map((x) => x.sid), "同じ seed なら stimuli の並びによらず同じ順");
  assert.equal(o1.length, stim.screens.length);
  assert.equal(new Set(o1.map((x) => x.sid)).size, stim.screens.length, "各画面ちょうど 1 回");
  assert.equal(countGapViolations(o1, minGap), 0, `seed ${s}: 同じ入力の画面が ${minGap} 未満に近い`);
  for (const sc of stim.screens.slice(0, 20)) {
    const r1 = orderRids(sc, s), r2 = orderRids(sc, s);
    assert.deepEqual(r1, r2);
    assert.deepEqual([...r1].sort(), [...sc.rids].sort());
  }
}
const a = buildOrder(stim.screens, 1, minGap).map((x) => x.sid).join();
const b = buildOrder(stim.screens, 2, minGap).map((x) => x.sid).join();
assert.notEqual(a, b, "seed が違えば順も違う");

// 応答の位置の偏り: 全画面・多数の seed で各 rid 位置が一様か（粗い確認）
const posCount = [0, 0, 0, 0];
const first = stim.screens[0];
for (let s = 0; s < 4000; s++) posCount[orderRids(first, s).indexOf(first.rids[0])]++;
for (const c of posCount) assert.ok(Math.abs(c - 1000) < 150, `位置の偏り ${posCount}`);

// check 画面の位置の分布（先頭・末尾に偏らないか）
const checkPos = [];
for (let s = 1; s <= 200; s++) {
  buildOrder(stim.screens, s, minGap).forEach((x, p) => { if (x.kind === "check") checkPos.push(p); });
}
if (checkPos.length) {
  const mean = checkPos.reduce((u, v) => u + v, 0) / checkPos.length;
  console.log(`check 画面の平均位置 ${mean.toFixed(1)} / ${stim.screens.length}`);
}
console.log(`order tests ok（${stim.screens.length} 画面、seed 200 通り）`);
