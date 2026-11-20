// gas/Code.gs を Google のサービスの代わりの模擬オブジェクトで動かす: node tests/gas.test.mjs
//   認証・入力検査・重複排除・progress を確かめる（実機の確認は README の受け入れテストで行う）
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

class Sheet {
  constructor() { this.data = []; }
  getLastRow() { return this.data.length; }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    return {
      setValues(v) { v.forEach((row, i) => { sh.data[r - 1 + i] = sh.data[r - 1 + i] || []; row.forEach((x, j) => { sh.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((sh.data[r - 1 + i] || [])[c - 1 + j] ?? ""); out.push(row); } return out; },
      setNumberFormat() { return this; },
      setFontWeight() { return this; },
    };
  }
  setFrozenRows() {}
}
const sheets = {};
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = new Sheet()),
};
let lockHeld = false;
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
  LockService: { getScriptLock: () => ({ waitLock() { assert.ok(!lockHeld); lockHeld = true; }, releaseLock() { lockHeld = false; } }) },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) },
  Utilities: { getUuid: () => "0123abcd-0123-4567-89ab-0123456789ab" },
  Logger: { log: (m) => { ctx.lastLog = m; } },
  Math, JSON, Date, String, Number, isFinite,
};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../gas/Code.gs", import.meta.url), "utf8"), ctx);

// setup の代わり（getRange('A:B') を使う部分は省く）
sheets.raters = new Sheet();
sheets.raters.data.push(["rater", "key", "seed"], ["A", "k".repeat(24), "12345"]);
sheets.responses = new Sheet();
sheets.responses.data.push(vm.runInContext("COLUMNS", ctx));

const get = (p) => JSON.parse(ctx.doGet({ parameter: p }).s);
const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).s);
const KEY = "k".repeat(24);
const row = (over = {}) => ({
  client_ts: "2026-11-20T00:00:00.000Z", rater: "A", stim_version: "2026-11-20a", sid: "i017a", iid: "i017",
  kind: "main", pos: 0, rid_A: "3f9a1c0be2d4", rid_B: "000000000001", rid_C: "00000000000a", rid_D: "1e5000000000",
  valid_A: 1, valid_B: 0, valid_C: 1, valid_D: 1, best_rid: "3f9a1c0be2d4", worst_rid: "000000000001",
  play_count: 1, rt_ms: 30000, user_agent: "=HYPERLINK(1)", ...over,
});

assert.deepEqual(get({ action: "progress", rater: "A", key: KEY }), { ok: true, seed: 12345, done: [] });
assert.equal(get({ action: "progress", rater: "A", key: KEY + "x" }).error, "unauthorized");
assert.equal(get({ action: "progress", rater: "Z", key: KEY }).error, "unauthorized");
assert.equal(get({ action: "progress", rater: "A" }).error, "unauthorized");

assert.equal(post({ action: "submit", rater: "A", key: "bad".repeat(8), row: row() }).error, "unauthorized");
assert.equal(sheets.responses.data.length, 1, "unauthorized では何も書かない");
assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row() }).status, "saved");
assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row() }).status, "duplicate");
assert.equal(sheets.responses.data.length, 2, "重複は 1 行だけ");
const written = sheets.responses.data[1];
assert.equal(written[vm.runInContext("COLUMNS.indexOf('user_agent')", ctx)], "'=HYPERLINK(1)", "式として解釈させない");
assert.equal(written[vm.runInContext("COLUMNS.indexOf('rid_D')", ctx)], "1e5000000000", "rid は文字列のまま");

const bad = [
  { sid: "x17a" }, { sid: "i017a; DROP" }, { kind: "other" }, { valid_A: 2 }, { valid_B: "1" },
  { best_rid: "ffffffffffff" }, { worst_rid: "3f9a1c0be2d4" }, { rid_B: "3f9a1c0be2d4" }, { rid_C: "XYZ" },
  { pos: -1 }, { pos: 1.5 }, { play_count: 0 }, { rater: "B" }, { kind: "practice" }, { sid: "p1", kind: "main" },
];
for (const o of bad) {
  assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row({ sid: "i018a", ...o }) }).error, "invalid", JSON.stringify(o));
}
assert.equal(ctx.doPost({ postData: { contents: "not json" } }).s.includes("invalid"), true);
assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row({ sid: "i017x", kind: "check" }) }).status, "saved");
assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row({ sid: "p1", iid: "pr1", kind: "practice" }) }).status, "saved");
assert.deepEqual(get({ action: "progress", rater: "A", key: KEY }).done, ["i017a", "i017x", "p1"]);
assert.ok(!lockHeld, "ロックを解放している");

// 評価者の追加
vm.runInContext("addRaterB()", ctx);
assert.match(ctx.lastLog, /^\?rater=B&key=[0-9a-f]{40}$/);
assert.throws(() => vm.runInContext("addRaterB()", ctx));
console.log("gas tests ok");
