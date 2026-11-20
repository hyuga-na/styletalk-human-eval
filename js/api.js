// GAS ウェブアプリとの通信と、未送信キュー（仕様書 6章）。

import { CONFIG } from "../config.js";

export class NetworkError extends Error {}

async function fetchJson(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new NetworkError(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof NetworkError) throw e;
    throw new NetworkError(String(e));
  } finally {
    clearTimeout(timer);
  }
}

export function getProgress(rater, key) {
  const q = new URLSearchParams({ action: "progress", rater, key });
  return fetchJson(`${CONFIG.gasUrl}?${q}`, { method: "GET" });
}

// Content-Type: text/plain で送る（CORS の事前確認要求を出さない）
export function submitRow(rater, key, row) {
  return fetchJson(CONFIG.gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "submit", rater, key, row }),
  });
}

// localStorage が使えなければメモリ上だけで持つ
function makeStore() {
  try {
    const k = "__probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch (e) {
    console.warn("localStorage が使えないため、未送信の回答はメモリ上だけで保持します");
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }
}

export const store = makeStore();

function readJson(key, fallback) {
  try {
    const v = store.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("保存に失敗", e);
  }
}

// 未送信キュー。複数タブで同時に使っても壊れにくいよう、操作のたびに読み直して書く。
export class Outbox {
  constructor(rater) {
    this.key = `outbox_${rater}`;
    this.doneKey = `done_${rater}`;
  }
  rows() { return readJson(this.key, []); }
  sids() { return new Set(this.rows().map((r) => r.sid)); }
  size() { return this.rows().length; }
  add(row) {
    const rows = this.rows().filter((r) => r.sid !== row.sid);
    rows.push(row);
    writeJson(this.key, rows);
  }
  remove(sid) {
    writeJson(this.key, this.rows().filter((r) => r.sid !== sid));
  }
  // サーバに届いたことを確認した sid（別タブでの回答を飛ばすため）
  localDone() { return new Set(readJson(this.doneKey, [])); }
  // 起動時にサーバの done で置き換える（サーバが正。シートから行を消した場合も追従する）
  resetDone(sids) { writeJson(this.doneKey, [...sids]); }
  markDone(sids) {
    const s = this.localDone();
    for (const x of sids) s.add(x);
    writeJson(this.doneKey, [...s]);
  }
}
