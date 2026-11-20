// 評価サイトの設定と画面の文言。コードに文言を直書きしない（仕様書 4章）。
// gasUrl は GAS ウェブアプリをデプロイしたときの URL（…/exec）に置き換える。

export const CONFIG = {
  gasUrl: "https://script.google.com/macros/s/AKfycbzrUVguf7PoUhVxArsYDgt2QGFFlsHod7hOOUvnw1TTqAdPVt6xF0rqbfkYC_r8nUZk/exec",
  stimuliUrl: "stimuli/stimuli.json",

  // 現在発話の書き起こしを表示するか（仕様書の既定は false。8.2 の決定によりモデル・LLM 評価と条件を揃えて表示する）
  showTranscript: true,
  // この画面数ごとに休憩画面を挟む
  breakEvery: 20,
  // 同じ入力の画面どうしを最低この画面数だけ離す
  minGap: 20,
  // 送信のタイムアウトと再送間隔（ミリ秒）
  requestTimeoutMs: 10000,
  retryIntervalMs: 30000,

  text: {
    title: "応答の評価",
    badUrl: "URLが正しくありません",
    badUrlContact: "URLが正しくありません。出題者に連絡してください",
    cannotConnect: "接続できません。時間をおいて再読み込みしてください",
    loading: "読み込み中…",
    stimuliError: "評価データを読み込めませんでした。時間をおいて再読み込みしてください",

    startProgress: (total, n) => `全${total}画面中、${n}画面回答済み`,
    startDevice: "PC と、ヘッドホンまたはイヤホンを使ってご回答ください。",
    startFirst: "はじめる",
    startResume: "続きから再開する",

    showInstructions: "説明を見る",
    close: "閉じる",
    instructionsTitle: "評価の説明",
    // 説明文（HTML）。尺度の定義は仕様書 3.1 をそのまま使う
    instructionsHtml: `
      <p>英語の発話を 1 つ音声で聞き、それに対して聞き手が返す応答の候補 4 つを評価していただきます。
      それより前の会話（文脈）はありません。1 画面につき次の 2 つに答えてください。</p>
      <h3>1. 妥当性（はい／いいえ）</h3>
      <p>話し方は考えず、発話内容に対する次の発話として成立しているか。
      文法や意味の破綻、発話との矛盾、無関係な内容があれば「いいえ」。</p>
      <h3>2. 適切さ（最も適切／最も不適切）</h3>
      <p>発話の話し方（感情・話速・声の大きさなど）まで含めて、次の発話として最もふさわしい応答と
      最もふさわしくない応答を 1 つずつ選んでください。妥当性が「いいえ」の応答を最も適切に選んでもかまいません。</p>
      <p>まったく同じ文の応答が同じ画面に並ぶことがあります。その場合はどちらを選んでも同じものとして扱いますので、
      迷わずどちらか一方を選んでください。妥当性はそれぞれに答えてください。</p>
      <h3>画面の使い方</h3>
      <ul>
        <li>音声を最後まで聞くと回答できるようになります。音声は何度でも聞き直せます。</li>
        <li>すべてに答えると「次へ」が押せます。送信した回答は変更できません（戻れません）。</li>
        <li>いつ画面を閉じても、同じ URL を開けば続きから再開できます。</li>
      </ul>
      <h3>所要時間の目安</h3>
      <p>1 画面 1〜1.5 分、全体で 4〜5 時間ほどです。何日かに分けてもかまいません。20 画面ごとに休憩の案内が出ます。</p>
    `,
    instructionsNext: "次へ（音量確認）",

    soundcheckTitle: "音量の確認",
    soundcheckBody: "下のボタンで音声を再生し、聞き取りやすい音量に調整してください（この音声は評価に使いません）。",
    soundcheckNext: "調整できました",

    practiceBadge: "練習",
    practiceIntro: "まず練習を 2 画面行います。本番と同じ画面です。",
    practiceDone: "練習はここまでです。",
    practiceStart: "評価をはじめる",

    contextLabel: "対話の文脈",
    currentLabel: () => "発話（音声）",
    transcriptLabel: "書き起こし",
    play: "▶ 再生",
    stop: "■ 停止",
    replay: "▶ もう一度再生",
    audioLoading: "音声を読み込み中…",
    audioError: "音声を読み込めませんでした",
    retry: "再試行",
    listenFirst: "音声を最後まで聞くと回答できます",

    responsesLabel: "応答の候補",
    colResponse: "応答文",
    colValid: "妥当",
    colBest: "最も適切",
    colWorst: "最も不適切",
    yes: "はい",
    no: "いいえ",
    responseLabel: (i) => `応答${"ABCD"[i]}`,

    next: "次へ",
    missingAudio: "音声を最後まで聞いてください",
    missingValid: (n) => `妥当性が未回答（${n}件）`,
    missingBest: "「最も適切」を選んでください",
    missingWorst: "「最も不適切」を選んでください",

    breakBody: "休憩してかまいません。閉じても続きから再開できます。",
    breakNext: "続ける",

    pending: (n) => `未送信 ${n}件`,
    sending: "送信中です。画面を閉じないでください",
    thanks: "ご協力ありがとうございました",
    thanksSub: "すべての回答を受け取りました。画面を閉じてかまいません。",
    beforeUnload: "未送信の回答があります。",
    scriptError: "エラーが発生しました。Ctrl+Shift+R（Mac は Cmd+Shift+R）で再読み込みしてください。続く場合は出題者に連絡してください。",
  },
};
