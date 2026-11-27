/**
 * 応答適切さ人手評価: 回答の受け取り（Google Apps Script ウェブアプリ）。仕様書 5.4・6.1。
 * 結果のスプレッドシートに紐づけた（コンテナバインドの）スクリプトとして置く。
 * このファイルは控え。編集したらスプレッドシートのスクリプトエディタに貼り直して「新しいデプロイ」ではなく
 * 「デプロイを管理 → 編集 → 新バージョン」で同じ URL のまま更新する。
 *
 *   GET  ?action=progress&rater=A&key=…  -> {"ok":true,"seed":12345,"done":["i017a",…]}
 *   POST {"action":"submit","rater":"A","key":"…","row":{…}} -> {"ok":true,"status":"saved"|"duplicate"}
 *   キー不一致 -> {"ok":false,"error":"unauthorized"}、入力不正 -> {"ok":false,"error":"invalid"}
 */

var SHEET_RATERS = 'raters';
var SHEET_RESPONSES = 'responses';
var RATER_HEADER = ['rater', 'key', 'seed'];
var COLUMNS = [
  'server_ts', 'client_ts', 'rater', 'stim_version', 'sid', 'iid', 'kind', 'pos',
  'rid_A', 'rid_B', 'rid_C', 'rid_D', 'valid_A', 'valid_B', 'valid_C', 'valid_D',
  'best_rid', 'worst_rid', 'play_count', 'rt_ms', 'user_agent', 'comment'
];
var COMMENT_MAX = 1000;   // 自由記入欄の最大文字数（app.js の textarea の maxlength と揃える）
var COL_RATER = COLUMNS.indexOf('rater');
var COL_SID = COLUMNS.indexOf('sid');
var LETTERS = ['A', 'B', 'C', 'D'];

var RE_RATER = /^[A-Za-z0-9_-]{1,32}$/;
var RE_SID = /^(i\d{3,4}[a-h]|i\d{3,4}x|p\d{1,2})$/;   // main: i017a / check: i017x / practice: p1
var RE_IID = /^(i\d{3,4}|pr\d{1,2})$/;
var RE_RID = /^[0-9a-f]{12}$/;
var KINDS = { main: true, check: true, practice: true };

// ------------------------------------------------------------------ 入口
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'progress') return json_({ ok: false, error: 'invalid' });
  var seed = auth_(p.rater, p.key);
  if (seed === null) return json_({ ok: false, error: 'unauthorized' });
  var done = [];
  var rows = responseKeys_();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === p.rater) done.push(String(rows[i][1]));
  }
  return json_({ ok: true, seed: seed, done: done });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'invalid' });
  }
  if (!body || body.action !== 'submit') return json_({ ok: false, error: 'invalid' });
  if (auth_(body.rater, body.key) === null) return json_({ ok: false, error: 'unauthorized' });
  var row = body.row;
  if (!validRow_(row, body.rater)) return json_({ ok: false, error: 'invalid' });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 重複確認と追記を同じロックの中で行う
    var keys = responseKeys_();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === row.rater && String(keys[i][1]) === row.sid) {
        return json_({ ok: true, status: 'duplicate' });
      }
    }
    var values = COLUMNS.map(function (c) {
      if (c === 'server_ts') return new Date().toISOString();
      return sanitize_(row[c], c === 'comment' ? COMMENT_MAX : 500);
    });
    var sh = sheet_(SHEET_RESPONSES);
    var r = sh.getLastRow() + 1;
    var range = sh.getRange(r, 1, 1, COLUMNS.length);
    range.setNumberFormat('@');   // rid（16進）が数値や日付に化けないよう、すべて文字列で書く
    range.setValues([values]);
    SpreadsheetApp.flush();
    return json_({ ok: true, status: 'saved' });
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------ 検査
function validRow_(row, rater) {
  if (!row || typeof row !== 'object') return false;
  if (row.rater !== rater || !RE_RATER.test(row.rater)) return false;
  if (typeof row.sid !== 'string' || !RE_SID.test(row.sid)) return false;
  if (typeof row.iid !== 'string' || !RE_IID.test(row.iid)) return false;
  if (!KINDS[row.kind]) return false;
  if ((row.kind === 'practice') !== (row.sid.charAt(0) === 'p')) return false;
  if (!isInt_(row.pos) || row.pos < 0) return false;
  if (!isInt_(row.play_count) || row.play_count < 1) return false;
  if (!isInt_(row.rt_ms) || row.rt_ms < 0) return false;
  if (typeof row.client_ts !== 'string' || row.client_ts.length > 40) return false;
  if (typeof row.stim_version !== 'string' || row.stim_version.length > 40) return false;
  if (typeof row.user_agent !== 'string') return false;
  // 自由記入欄は任意（旧版のクライアントの未送信分には無い）
  if (row.comment !== undefined && (typeof row.comment !== 'string' || row.comment.length > COMMENT_MAX)) return false;
  var rids = {};
  for (var i = 0; i < LETTERS.length; i++) {
    var rid = row['rid_' + LETTERS[i]];
    var v = row['valid_' + LETTERS[i]];
    if (typeof rid !== 'string' || !RE_RID.test(rid) || rids[rid]) return false;
    rids[rid] = true;
    if (v !== 0 && v !== 1) return false;
  }
  if (!rids[row.best_rid] || !rids[row.worst_rid]) return false;
  if (row.best_rid === row.worst_rid) return false;
  return true;
}

function isInt_(x) {
  return typeof x === 'number' && isFinite(x) && Math.floor(x) === x;
}

// 表計算の式として解釈されないように（user_agent・comment など）
function sanitize_(x, max) {
  if (x === null || x === undefined) return '';
  var s = String(x).slice(0, max || 500);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

// ------------------------------------------------------------------ シート
function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('sheet not found: ' + name + '（setup() を実行してください）');
  return sh;
}

// [[rater, sid], ...]
function responseKeys_() {
  var sh = sheet_(SHEET_RESPONSES);
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, COL_RATER + 1, n, COL_SID - COL_RATER + 1).getValues()
    .map(function (r) { return [r[0], r[COL_SID - COL_RATER]]; });
}

// キーが合えば seed（数値）、合わなければ null
function auth_(rater, key) {
  if (typeof rater !== 'string' || typeof key !== 'string' || !RE_RATER.test(rater) || key.length < 16) return null;
  var sh = sheet_(SHEET_RATERS);
  var n = sh.getLastRow() - 1;
  if (n <= 0) return null;
  var rows = sh.getRange(2, 1, n, 3).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === rater) {
      return String(rows[i][1]) === key ? Number(rows[i][2]) : null;
    }
  }
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ 管理用（スクリプトエディタから手で実行）
/** シートとヘッダを作る。既にあれば、足りない列の見出しだけ補う。 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [[SHEET_RATERS, RATER_HEADER], [SHEET_RESPONSES, COLUMNS]].forEach(function (x) {
    var sh = ss.getSheetByName(x[0]) || ss.insertSheet(x[0]);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, x[1].length).setValues([x[1]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      // 既存のシートに後から足した列（comment など）の見出しを補う。既存の列は変えない
      var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
      for (var i = 0; i < x[1].length; i++) {
        if (head[i] !== x[1][i]) {
          if (head[i] === undefined || head[i] === '') {
            sh.getRange(1, i + 1).setValue(x[1][i]).setFontWeight('bold');
          } else {
            throw new Error(x[0] + ' の ' + (i + 1) + ' 列目の見出しが ' + head[i] + '（期待: ' + x[1][i] + '）');
          }
        }
      }
    }
  });
  ss.getSheetByName(SHEET_RATERS).getRange('A:B').setNumberFormat('@');
}

/** 評価者を追加する。例: addRater_('A')。key と seed は乱数。ログに URL の末尾を出す。 */
function addRater_(name) {
  if (!RE_RATER.test(name)) throw new Error('rater ID は英数字・_・- のみ');
  var sh = sheet_(SHEET_RATERS);
  var n = sh.getLastRow() - 1;
  if (n > 0 && sh.getRange(2, 1, n, 1).getValues().some(function (r) { return String(r[0]) === name; })) {
    throw new Error('既にある rater ID: ' + name);
  }
  var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var seed = Math.floor(Math.random() * 2147483647);
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, 3).setNumberFormat('@').setValues([[name, key, String(seed)]]);
  Logger.log('?rater=' + encodeURIComponent(name) + '&key=' + key);
}

// エディタの「実行」から選べるように（名前末尾が _ の関数は一覧に出ないため）
function addRaterA() { addRater_('A'); }
function addRaterB() { addRater_('B'); }
function addRaterT() { addRater_('T'); }   // 受け入れテスト用。終わったら raters と responses の T の行を消す
