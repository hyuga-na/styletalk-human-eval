# styletalk-human-eval

StyleTalk に対する応答生成モデルの出力を、人手で比較評価してもらうための静的サイト。
評価は 1 画面 4 応答で「適切さ」の Best-Worst Scaling と、各応答の「妥当性」（はい／いいえ）。
GitHub Pages で配信し、回答は Google Apps Script（GAS）経由で Google スプレッドシートに保存する。

このリポジトリは公開される。どの応答がどのモデルのものかの対応表は置かない（応答は乱数 ID で扱う）。
`stimuli/` と `audio/` は研究側の生成スクリプトが書き出すので、手で編集しない。

## 構成

| パス | 中身 |
|---|---|
| `index.html` `app.js` `style.css` | 評価画面（素の HTML + ES モジュール。ビルド工程なし） |
| `config.js` | GAS の URL、表示設定（書き起こしの表示・休憩間隔など）、画面の文言一式 |
| `js/order.js` | 評価者の seed から提示順と応答の並びを決定的に作る |
| `js/api.js` | GAS との通信、未送信キュー（localStorage） |
| `stimuli/stimuli.json` | 刺激（文脈・書き起こし・応答文・画面の組） |
| `audio/*.mp3` | 現在発話の音声（モノラル 64 kbps） |
| `gas/Code.gs` | GAS のソースの控え（実体はスプレッドシートに紐づくスクリプト） |
| `tests/` | `node tests/order.test.mjs`（提示順）、`node tests/gas.test.mjs`（GAS を模擬環境で） |

## 準備

### 1. スプレッドシートと GAS

1. Google ドライブで新しいスプレッドシートを作る。
2. 「拡張機能 → Apps Script」を開き、`Code.gs` の中身を `gas/Code.gs` で置き換えて保存する。
3. エディタ上部の関数の選択で `setup` を選んで「実行」（初回は権限の承認を求められる）。
   `raters` と `responses` の 2 シートがヘッダ付きでできる。
4. 同じく `addRaterA`・`addRaterB`・`addRaterT`（試験用）を実行する。
   `raters` シートに rater・key（推測しにくい乱数）・seed（提示順の乱数の種）の行が足され、
   実行ログに `?rater=A&key=…` が出る。評価者を増やすときは `addRaterC` などを足すか、
   エディタで `addRater_('C')` を呼ぶ関数を作って実行する（行を手で足してもよい。key は 16 文字以上）。
5. 「デプロイ → 新しいデプロイ → 種類: ウェブアプリ」で
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
   としてデプロイし、表示された URL（`https://script.google.com/macros/s/…/exec`）を控える。
6. `config.js` の `gasUrl` をその URL に置き換えてコミットする。

`Code.gs` を直したときは、スクリプトエディタに貼り直してから
「デプロイ → デプロイを管理 → 編集（鉛筆）→ バージョン: 新バージョン」でデプロイする（URL が変わらない）。
「新しいデプロイ」を作ると URL が変わるので `config.js` も直すこと。

### 2. GitHub Pages

リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を `main` / `(root)` にする。
数分で `https://<user>.github.io/styletalk-human-eval/` に公開される。

### 3. 評価者の URL

```
https://<user>.github.io/styletalk-human-eval/?rater=A&key=<raters シートの key>
```

評価者ごとに別の URL を渡す。key を知っている人だけがその評価者として書き込める。

## 運用

- 回答済みかどうかはスプレッドシートが正。ブラウザの localStorage は未送信の回答を一時的に持つだけなので、
  別の端末・ブラウザで同じ URL を開いても続きから再開できる（提示順も同じ）。
- 結果は `responses` シートを直接見る。集計はシートを CSV でダウンロードして研究側の集計スクリプトに渡す。
- 評価を始めた後は、既存の画面（sid）の中身を変えない。刺激を作り直したら `stimuli.json` の `version` を変える。
- 同じ評価者・同じ sid の行は GAS が 1 行しか書かない（再送や 2 タブ同時の回答でも重複しない）。

## 受け入れテスト（評価者に URL を渡す前に）

試験用の評価者 T で行い、終わったら `raters` と `responses` の T の行を消す。
同じブラウザで T をやり直すときは、開発者ツールで localStorage の `outbox_T`・`done_T` も消す。

- [ ] 生成スクリプトの assert（分割の釣り合い・全モデルの出力がそろう・公開側に対応表の情報がない）がすべて通る
- [ ] 音声を最後まで聞くまで回答できず、条件を満たすまで「次へ」が押せない（足りない項目がボタン横に出る）
- [ ] 5 画面回答して閉じ、別のブラウザで同じ URL を開くと 6 画面目から再開し、提示順も同じ
- [ ] 開発者ツールでオフラインにして 3 画面回答し（右上に「未送信 N件」が出る）、オンラインに戻すと全件が届き、シートに重複行がない
- [ ] 同じ回答を二度送っても行が 1 つだけ
- [ ] key を変えた URL では評価が始まらず、シートに何も書かれない
- [ ] 2 画面（2 タブ）を同時に開いて交互に回答しても、行が欠けたり重複したりしない
- [ ] Chrome・Edge・Safari・Firefox の最新版で音声が再生でき、画面が崩れない（幅 1024 px 未満では応答が縦に並ぶ）
- [ ] 最初から最後まで自分で 1 周し、所要時間を測って `config.js` の説明文の目安を更新する
- [ ] 集計スクリプトがテスト回答から表を出力できる

ローカルで画面だけ確かめるときは、リポジトリ直下で `python3 -m http.server` を立てて
`http://localhost:8000/?rater=T&key=…` を開く（ES モジュールなので `file://` では動かない）。

## データの出典とライセンス

刺激の対話文・音声は StyleTalk（MIT License、音声は Azure TTS による合成）による。
ライセンス全文は [`LICENSE_StyleTalk`](LICENSE_StyleTalk)。

> Guan-Ting Lin, Cheng-Han Chiang, Hung-yi Lee.
> Advancing Large Language Models to Capture Varied Speaking Styles and Respond Properly in Spoken Conversations. ACL 2024.
> https://github.com/DanielLin94144/StyleTalk
