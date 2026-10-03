# AGENTS.md

AIエージェント（Claude Code・Codex）向けの作業指示です。

## やりとり

- 利用者とのやりとりは日本語の敬体で行い、変更内容・確認方法・戻し方を、プログラマでない人にも分かる言葉で説明する。

## 進め方

- 実装はClaude Codeが担当する。完成は、利用者がMac・iPhone・iPadの実際の画面で確かめられることで判断する。
- 手順は個人用途に見合う軽さにする。自動の確認、Gitの履歴、配置前の控えで十分とし、レビュー記録や承認記録は作らない。
- 小さな変更は`main`で直接行う。大きい変更や危ない変更のときだけ短いブランチを使う。PRは要らない。

## 対象

- 2hop-links-plus 0.37.0（L7Cy版、2023-10から更新なし）から分かれた、利用者の改造版。公開のforkだが、使うのは利用者だけ。
- 元のプラグインからの取り込みはしない（更新が止まっているため）。
- PalmWiki Home（`../palmwiki-home`）とは、実行時に依存し合わない。見た目はCosense風CSS（`../../obsidian-css/obsidian-cosense-style`）がこのプラグインのクラス名に合わせて色を付けているので、クラス名を変えるときはCSSも同じ作業で直す。
- 公開APIとメタデータのキャッシュを使い、表示のたびにVault全体の本文を読む処理は入れない。

## 確認

- 変更のあとに`npm run build`（型検査つき）、`npm test`、`npm run eslint`を通す。
- 画面の確認には、必要に応じて`test-vault/`と`docs/specification/ACCEPTANCE_TESTS.md`を使う。
- 依存パッケージは、困ることが出るまで更新しない。`npm ci`で入れる。
- `docs/reviews/`と`docs/IMPLEMENTATION_HISTORY.md`はCodexで作業していたころの記録で、毎回の手順ではない。

## 版

- 版を上げるときは`manifest.json`・`package.json`・`versions.json`をそろえ、`docs/releases/<版>.md`に変更点を書いて、Gitのタグを付けて送る。GitHubのReleaseはタグからワークフローが作る。

## Vaultへの配置

- `npm run deploy`で、ビルド、Vaultの外への控え、`main.js`・`manifest.json`・`styles.css`の配置、SHA-256の照合、Obsidianでの再読み込みまで行う。Vaultの既定は`~/PalmWiki`（環境変数`PALMWIKI_VAULT`で変更可）。
- 利用者のメインのVaultへの配置は、毎回の承認なしで行ってよい。ほかのVaultへの配置は確認する。
- プラグインの設定（`data.json`）・有効化・ショートカットは、変える前に確認する。VaultはObsidian Syncで各端末と同期しているので、設定の変更は全端末に入る。

## Gitに入れないもの

- `node_modules`、`main.js`（ビルドで作るもの）、`data.json`、Vaultのノートや添付、個人の絶対パス、認証情報。

## ほかのセッションとの連携

- PalmWiki Home・2hop-links-plus・Cosense風CSSは、それぞれのフォルダで開いたClaude Codeのセッションで開発する。ObsidianOpsのセッションは、Vaultの設定・診断・開発状況のページを受け持つ拠点。
- 別のリポジトリの変更が要るとき（クラス名の変更に合わせたCSSなど）は、自分で直さず、`ListAgents`で相手のセッション名を確かめて`SendMessage`で頼む。相手のセッションがないときは、利用者に伝える。
- Vaultに配置したら、ObsidianOpsのセッションに版と変更点を短く知らせる（開発状況のページの更新のため）。
