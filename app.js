// 評価サイト本体。開始 → 説明 → 音量確認 → 練習 → 評価 → 完了（仕様書 4章）。
import { CONFIG } from "./config.js";
import { buildOrder, orderRids } from "./js/order.js";
import { getProgress, submitRow, Outbox, NetworkError, store } from "./js/api.js";

const T = CONFIG.text;
const $app = document.getElementById("app");
const $pending = document.getElementById("pending");
const $help = document.getElementById("help-link");
const $modal = document.getElementById("modal");

const S = {
  rater: null,
  key: null,
  seed: null,
  stim: null,
  inputs: new Map(),   // iid -> input
  order: [],           // 評価画面（main + check）の提示順
  serverDone: new Set(),
  outbox: null,
  inFlight: new Set(),
  stopped: false,      // unauthorized などで停止した
  audioCache: new Map(),
};

// 想定外のエラーを黙って止めずに画面に出す（古いキャッシュの JS と新しい刺激の組合せなど）
function showScriptError(err) {
  console.error(err);
  let el = document.getElementById("script-error");
  if (!el) {
    el = document.createElement("div");
    el.id = "script-error";
    el.className = "script-error";
    document.body.prepend(el);
  }
  el.textContent = `${T.scriptError}（${err && err.message ? err.message : err}）`;
}
window.addEventListener("error", (e) => showScriptError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => showScriptError(e.reason));

// ---------------------------------------------------------------- DOM 小道具
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function show(...nodes) {
  $app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function fatal(msg) {
  S.stopped = true;
  $help.hidden = true;
  show(h("div", { class: "card center" }, h("p", { class: "fatal" }, msg)));
}

function updatePending() {
  const n = S.outbox ? S.outbox.size() : 0;
  $pending.hidden = n === 0;
  $pending.textContent = T.pending(n);
}

// ---------------------------------------------------------------- 説明モーダル
function openHelp() {
  $modal.replaceChildren(
    h("div", { class: "modal-body", role: "dialog", "aria-modal": "true" },
      h("h2", {}, T.instructionsTitle),
      h("div", { html: T.instructionsHtml }),
      h("div", { class: "actions" }, h("button", { onclick: closeHelp }, T.close))));
  $modal.hidden = false;
}
function closeHelp() { $modal.hidden = true; }
$help.textContent = T.showInstructions;
$help.addEventListener("click", (e) => { e.preventDefault(); openHelp(); });
$modal.addEventListener("click", (e) => { if (e.target === $modal) closeHelp(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHelp(); });

// ---------------------------------------------------------------- 送信
function answeredSids() {
  const s = new Set(S.serverDone);
  for (const x of S.outbox.sids()) s.add(x);
  for (const x of S.outbox.localDone()) s.add(x);
  return s;
}

async function sendOne(row) {
  if (S.inFlight.has(row.sid) || S.stopped) return;
  S.inFlight.add(row.sid);
  try {
    const res = await submitRow(S.rater, S.key, row);
    if (res.ok && (res.status === "saved" || res.status === "duplicate")) {
      S.outbox.remove(row.sid);
      S.outbox.markDone([row.sid]);
      S.serverDone.add(row.sid);
    } else if (res.error === "unauthorized") {
      fatal(T.badUrlContact);
    } else if (res.error === "invalid") {
      console.error("サーバが回答を不正として拒否しました（実装の不具合）", row, res);
      S.outbox.remove(row.sid);
    } else {
      console.warn("想定外の応答。キューに残して再送します", res);
    }
  } catch (e) {
    if (!(e instanceof NetworkError)) console.error(e);
  } finally {
    S.inFlight.delete(row.sid);
    updatePending();
  }
}

async function flushOutbox() {
  for (const row of S.outbox.rows()) {
    if (S.stopped) return;
    await sendOne(row);
  }
}

window.addEventListener("beforeunload", (e) => {
  if (S.outbox && S.outbox.size() > 0 && !S.stopped) {
    e.preventDefault();
    e.returnValue = T.beforeUnload;
    return T.beforeUnload;
  }
});
window.addEventListener("storage", updatePending);

// ---------------------------------------------------------------- 音声
function getAudio(src) {
  let a = S.audioCache.get(src);
  if (!a) {
    a = new Audio();
    a.preload = "auto";
    a.src = src;
    S.audioCache.set(src, a);
  }
  return a;
}

function preload(src) {
  if (src) getAudio(src).load();
}

// 再生ボタン。onEnded は最後まで再生し終えるたびに呼ばれる。シークはさせない。
function audioPlayer(src, { onEnded, onPlay } = {}) {
  const audio = getAudio(src);
  const btn = h("button", { class: "play", type: "button" }, T.play);
  const bar = h("div", { class: "audio-bar" }, h("div", { class: "audio-fill" }));
  const msg = h("span", { class: "audio-msg" });
  const retry = h("button", { type: "button", class: "secondary", hidden: true }, T.retry);
  let everEnded = false;

  const setIdle = () => { btn.textContent = everEnded ? T.replay : T.play; };
  const onTime = () => {
    const f = audio.duration ? audio.currentTime / audio.duration : 0;
    bar.firstChild.style.width = `${Math.min(100, f * 100)}%`;
  };
  const onEnd = () => {
    everEnded = true;
    bar.firstChild.style.width = "100%";
    setIdle();
    if (onEnded) onEnded();
  };
  const onErr = () => {
    msg.textContent = T.audioError;
    retry.hidden = false;
    btn.disabled = true;
  };
  audio.addEventListener("timeupdate", onTime);
  audio.addEventListener("ended", onEnd);
  audio.addEventListener("error", onErr);

  btn.addEventListener("click", async () => {
    if (!audio.paused) {
      audio.pause();
      audio.currentTime = 0;
      setIdle();
      return;
    }
    audio.currentTime = 0;
    try {
      await audio.play();
      btn.textContent = T.stop;
      if (onPlay) onPlay();
    } catch (e) {
      console.warn(e);
      onErr();
    }
  });
  retry.addEventListener("click", () => {
    msg.textContent = "";
    retry.hidden = true;
    btn.disabled = false;
    audio.load();
  });
  if (audio.error) onErr();

  const el = h("div", { class: "player" }, btn, bar, msg, retry);
  // 画面を離れるときに呼ぶ
  el.dispose = () => {
    audio.pause();
    audio.removeEventListener("timeupdate", onTime);
    audio.removeEventListener("ended", onEnd);
    audio.removeEventListener("error", onErr);
  };
  return el;
}

let currentPlayer = null;
function disposePlayer() {
  if (currentPlayer) currentPlayer.dispose();
  currentPlayer = null;
}

// ---------------------------------------------------------------- 画面
async function main() {
  show(h("div", { class: "card center" }, T.loading));
  document.title = T.title;
  const params = new URLSearchParams(location.search);
  S.rater = params.get("rater");
  S.key = params.get("key");
  if (!S.rater || !S.key) return fatal(T.badUrl);
  S.outbox = new Outbox(S.rater);
  updatePending();

  let stim;
  try {
    const res = await fetch(`${CONFIG.stimuliUrl}?v=${Date.now()}`, { cache: "no-store" });
    stim = await res.json();
  } catch (e) {
    console.error(e);
    return fatal(T.stimuliError);
  }
  S.stim = stim;
  for (const inp of stim.inputs) S.inputs.set(inp.iid, inp);

  // 起動時: 未送信キューを先に送り、その後 progress を取る（6.2）
  await flushOutbox();
  if (S.stopped) return;
  let prog;
  try {
    prog = await getProgress(S.rater, S.key);
  } catch (e) {
    console.error(e);
    return fatal(T.cannotConnect);
  }
  if (!prog.ok) return fatal(prog.error === "unauthorized" ? T.badUrl : T.cannotConnect);
  S.seed = prog.seed;
  S.serverDone = new Set(prog.done);
  S.outbox.resetDone(prog.done);

  const verKey = `stimver_${S.rater}`;
  try {
    const prev = store.getItem(verKey);
    if (prev && prev !== stim.version) {
      console.warn(`刺激の version が前回と異なります: ${prev} → ${stim.version}（回答済みの sid はそのまま飛ばします）`);
    }
    store.setItem(verKey, stim.version);
  } catch (e) { /* 使えなくても続ける */ }

  S.order = buildOrder(stim.screens, S.seed, CONFIG.minGap);
  setInterval(() => { if (!S.stopped) flushOutbox(); }, CONFIG.retryIntervalMs);
  renderStart();
}

function countAnswered() {
  const done = answeredSids();
  return S.order.filter((s) => done.has(s.sid)).length;
}

function renderStart() {
  const n = countAnswered();
  const total = S.order.length;
  if (n >= total) return renderFinish();
  const first = n === 0;
  show(h("div", { class: "card center" },
    h("h1", {}, T.title),
    h("p", { class: "big" }, T.startProgress(total, n)),
    h("p", {}, T.startDevice),
    h("button", { class: "primary", onclick: first ? renderInstructions : () => nextEval() },
      first ? T.startFirst : T.startResume)));
}

function renderInstructions() {
  show(h("div", { class: "card" },
    h("h2", {}, T.instructionsTitle),
    h("div", { html: T.instructionsHtml }),
    h("div", { class: "actions" }, h("button", { class: "primary", onclick: renderSoundcheck }, T.instructionsNext))));
}

function renderSoundcheck() {
  disposePlayer();
  currentPlayer = audioPlayer(S.stim.soundcheck);
  show(h("div", { class: "card" },
    h("h2", {}, T.soundcheckTitle),
    h("p", {}, T.soundcheckBody),
    currentPlayer,
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: () => { disposePlayer(); startPractice(); } }, T.soundcheckNext))));
  const first = S.stim.practice[0];
  if (first) preload(S.inputs.get(first.iid).audio);
}

function startPractice() {
  const done = answeredSids();
  const todo = S.stim.practice.filter((s) => !done.has(s.sid));
  if (todo.length === 0) return nextEval();
  const step = (i) => {
    if (i >= todo.length) {
      return show(h("div", { class: "card center" },
        h("p", { class: "big" }, T.practiceDone),
        h("button", { class: "primary", onclick: () => nextEval() }, T.practiceStart)));
    }
    renderScreen(todo[i], S.stim.practice.indexOf(todo[i]), {
      practice: true,
      preloadNext: i + 1 < todo.length ? todo[i + 1] : firstUnanswered(),
      onDone: () => step(i + 1),
    });
  };
  show(h("div", { class: "card center" },
    h("p", {}, T.practiceIntro),
    h("button", { class: "primary", onclick: () => step(0) }, T.next)));
  preload(S.inputs.get(todo[0].iid).audio);
}

function firstUnanswered(from = 0) {
  const done = answeredSids();
  for (let p = from; p < S.order.length; p++) if (!done.has(S.order[p].sid)) return S.order[p];
  return null;
}

// 未回答の最初の評価画面へ。sinceBreak は直前に答えた画面の pos
function nextEval(lastPos = null) {
  if (S.stopped) return;
  const done = answeredSids();
  let pos = -1;
  for (let p = 0; p < S.order.length; p++) if (!done.has(S.order[p].sid)) { pos = p; break; }
  if (pos < 0) return renderFinish();
  const go = () => {
    const nxt = (() => {
      for (let p = pos + 1; p < S.order.length; p++) if (!done.has(S.order[p].sid)) return S.order[p];
      return null;
    })();
    renderScreen(S.order[pos], pos, { practice: false, preloadNext: nxt, onDone: (p) => nextEval(p) });
  };
  if (lastPos !== null && (lastPos + 1) % CONFIG.breakEvery === 0) {
    show(h("div", { class: "card center" },
      h("p", { class: "big" }, T.breakBody),
      h("button", { class: "primary", onclick: go }, T.breakNext)));
    preload(S.inputs.get(S.order[pos].iid).audio);
  } else {
    go();
  }
}

function renderScreen(screen, pos, { practice, preloadNext, onDone }) {
  disposePlayer();
  const input = S.inputs.get(screen.iid);
  const rids = orderRids(screen, S.seed);
  const st = { heard: false, playCount: 0, valid: [null, null, null, null], best: null, worst: null };
  const t0 = performance.now();

  // 進捗
  const total = practice ? S.stim.practice.length : S.order.length;
  const shownN = practice ? pos + 1 : pos + 1;
  const progress = h("div", { class: "progress" },
    h("div", { class: "progress-bar" }, h("div", { class: "progress-fill", style: `width:${(100 * pos) / total}%` })),
    h("span", { class: "progress-text" }, practice ? `${T.practiceBadge} ${shownN} / ${total}` : `${shownN} / ${total}`));

  // 文脈（刺激に含まれるときだけ表示。現行の刺激には無い）
  const ctx = !(input.context && input.context.length) ? null : h("div", { class: "context" },
    h("div", { class: "label" }, T.contextLabel),
    ...input.context.map((line) => h("div", { class: "turn", lang: "en" }, line)));

  // 現在発話
  currentPlayer = audioPlayer(input.audio, {
    onPlay: () => { st.playCount++; },
    onEnded: () => { if (!st.heard) { st.heard = true; fieldset.disabled = false; } update(); },
  });
  const cur = h("div", { class: "current" },
    h("div", { class: "label" }, T.currentLabel(input.speaker || "B")),
    currentPlayer,
    CONFIG.showTranscript
      ? h("div", { class: "transcript", lang: "en" }, h("span", { class: "tlabel" }, `${T.transcriptLabel}: `), input.transcript)
      : null,
    CONFIG.showStyleTags && input.style
      ? h("div", { class: "style-tags" }, h("span", { class: "tlabel" }, `${T.styleLabel}: `),
          ...T.styleKeys.map(([k, ja]) => h("span", { class: "tag" },
            `${ja}: `, h("span", { lang: "en" }, input.style[k]),
            T.styleValues[input.style[k]] ? `（${T.styleValues[input.style[k]]}）` : "")))
      : null,
    h("div", { class: "hint" }, T.listenFirst));

  // 応答の表
  const name = `s_${screen.sid}`;
  const rows = rids.map((rid, i) => {
    const vYes = h("input", { type: "radio", name: `${name}_v${i}`, value: "1" });
    const vNo = h("input", { type: "radio", name: `${name}_v${i}`, value: "0" });
    const best = h("input", { type: "radio", name: `${name}_best`, value: String(i) });
    const worst = h("input", { type: "radio", name: `${name}_worst`, value: String(i) });
    vYes.addEventListener("change", () => { st.valid[i] = 1; update(); });
    vNo.addEventListener("change", () => { st.valid[i] = 0; update(); });
    best.addEventListener("change", () => {
      st.best = i;
      if (st.worst === i) { st.worst = null; rowEls[i].worst.checked = false; }
      update();
    });
    worst.addEventListener("change", () => {
      st.worst = i;
      if (st.best === i) { st.best = null; rowEls[i].best.checked = false; }
      update();
    });
    const tr = h("div", { class: "row" },
      h("div", { class: "cell resp" }, h("span", { class: "rlabel" }, T.responseLabel(i)),
        h("span", { class: "rtext", lang: "en" }, S.stim.responses[rid])),
      h("div", { class: "cell valid" }, h("span", { class: "mlabel" }, T.colValid),
        h("label", {}, vYes, T.yes), h("label", {}, vNo, T.no)),
      h("div", { class: "cell best" }, h("label", {}, best, h("span", { class: "mlabel" }, T.colBest))),
      h("div", { class: "cell worst" }, h("label", {}, worst, h("span", { class: "mlabel" }, T.colWorst))));
    return { tr, best, worst };
  });
  const rowEls = rows;
  const head = h("div", { class: "row head" },
    h("div", { class: "cell resp" }, T.colResponse),
    h("div", { class: "cell valid" }, T.colValid),
    h("div", { class: "cell best" }, T.colBest),
    h("div", { class: "cell worst" }, T.colWorst));
  const fieldset = h("fieldset", { class: "responses", disabled: true },
    h("legend", {}, T.responsesLabel), head, ...rows.map((r) => r.tr));

  const nextBtn = h("button", { class: "primary", disabled: true }, T.next);
  const missing = h("span", { class: "missing" });

  function missingList() {
    const m = [];
    if (!st.heard) m.push(T.missingAudio);
    const nv = st.valid.filter((v) => v === null).length;
    if (nv) m.push(T.missingValid(nv));
    if (st.best === null) m.push(T.missingBest);
    if (st.worst === null) m.push(T.missingWorst);
    return m;
  }
  function update() {
    const m = missingList();
    nextBtn.disabled = m.length > 0;
    missing.textContent = m.join(" / ");
  }

  nextBtn.addEventListener("click", () => {
    if (missingList().length) return;
    nextBtn.disabled = true;
    const row = {
      client_ts: new Date().toISOString(),
      rater: S.rater,
      stim_version: S.stim.version,
      sid: screen.sid,
      iid: screen.iid,
      kind: practice ? "practice" : screen.kind,
      pos,
      rid_A: rids[0], rid_B: rids[1], rid_C: rids[2], rid_D: rids[3],
      valid_A: st.valid[0], valid_B: st.valid[1], valid_C: st.valid[2], valid_D: st.valid[3],
      best_rid: rids[st.best],
      worst_rid: rids[st.worst],
      play_count: st.playCount,
      rt_ms: Math.round(performance.now() - t0),
      user_agent: navigator.userAgent,
    };
    S.outbox.add(row);
    updatePending();
    sendOne(row);  // 完了を待たずに進む
    disposePlayer();
    onDone(pos);
  });

  update();
  show(h("div", { class: `screen${practice ? " practice" : ""}` },
    progress,
    practice ? h("div", { class: "badge" }, T.practiceBadge) : null,
    ctx, cur, fieldset,
    h("div", { class: "actions" }, missing, nextBtn)));

  if (preloadNext) preload(S.inputs.get(preloadNext.iid).audio);
}

function renderFinish() {
  disposePlayer();
  const tick = async () => {
    if (S.stopped) return;
    if (S.outbox.size() > 0) {
      show(h("div", { class: "card center" }, h("p", { class: "big" }, T.sending)));
      await flushOutbox();
      if (S.stopped) return;
      if (S.outbox.size() > 0) { setTimeout(tick, 5000); return; }
    }
    $help.hidden = true;
    show(h("div", { class: "card center" }, h("p", { class: "big" }, T.thanks), h("p", {}, T.thanksSub)));
  };
  tick();
}

main();
