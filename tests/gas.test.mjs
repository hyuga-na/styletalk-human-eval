// gas/Code.gs を Google のサービスの代わりの模擬オブジェクトで動かす: node tests/gas.test.mjs
//   認証・入力検査・重複排除・progress を確かめる（実機の確認は README の受け入れテストで行う）
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

class Sheet {
  constructor() { this.data = []; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    if (typeof r === "string") return { setNumberFormat() { return this; } };   // 'A:B' など
    return {
      setValue(x) { return this.setValues([[x]]); },
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
assert.equal(written[vm.runInContext("COLUMNS.indexOf('comment')", ctx)], "", "自由記入欄は省略できる");
assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row({ sid: "i017b", comment: "=音が途切れた\n2行目" }) }).status, "saved");
assert.equal(sheets.responses.data.at(-1)[vm.runInContext("COLUMNS.indexOf('comment')", ctx)], "'=音が途切れた\n2行目", "comment も式として解釈させない");
assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row({ sid: "i017c", comment: "あ".repeat(1000) }) }).status, "saved");

const bad = [
  { sid: "x17a" }, { sid: "i017a; DROP" }, { kind: "other" }, { valid_A: 2 }, { valid_B: "1" },
  { best_rid: "ffffffffffff" }, { worst_rid: "3f9a1c0be2d4" }, { rid_B: "3f9a1c0be2d4" }, { rid_C: "XYZ" },
  { comment: 1 }, { comment: "あ".repeat(1001) }, { pos: -1 }, { pos: 1.5 }, { play_count: 0 }, { rater: "B" }, { kind: "practice" }, { sid: "p1", kind: "main" },
];
for (const o of bad) {
  assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row({ sid: "i018a", ...o }) }).error, "invalid", JSON.stringify(o));
}
assert.equal(ctx.doPost({ postData: { contents: "not json" } }).s.includes("invalid"), true);
assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row({ sid: "i017x", kind: "check" }) }).status, "saved");
assert.equal(post({ action: "submit", rater: "A", key: KEY, row: row({ sid: "p1", iid: "pr1", kind: "practice" }) }).status, "saved");
assert.deepEqual(get({ action: "progress", rater: "A", key: KEY }).done, ["i017a", "i017b", "i017c", "i017x", "p1"]);
assert.ok(!lockHeld, "ロックを解放している");

// 評価者の追加
vm.runInContext("addRaterB()", ctx);
assert.match(ctx.lastLog, /^\?rater=B&key=[0-9a-f]{40}$/);
assert.throws(() => vm.runInContext("addRaterB()", ctx));

// setup: comment 列を足す前のシート（見出しが 1 列少ない）に見出しを補い、既存の行は動かさない
const oldHead = vm.runInContext("COLUMNS", ctx).slice(0, -1);
sheets.responses = new Sheet();
sheets.responses.data.push([...oldHead], ["x"]);
ctx.setup();
assert.deepEqual([...sheets.responses.data[0]], [...vm.runInContext("COLUMNS", ctx)], "comment の見出しを補う");
assert.deepEqual(sheets.responses.data[1], ["x"], "既存の行はそのまま");
ctx.setup();
assert.equal(sheets.responses.data[0].length, oldHead.length + 1, "2 回目は何もしない");
sheets.responses.data[0][3] = "wrong";
assert.throws(() => ctx.setup(), /見出し/, "見出しが食い違えば止める");
console.log("gas tests ok");
