# 2Hop Links Plus — Cosense-style community fork

[日本語](#日本語) | [English](#english)

## 日本語

このリポジトリは、Obsidian プラグイン
[2Hop Links Plus](https://github.com/L7Cy/obsidian-2hop-links-plus) `0.37.0`
を基にした、非公式のコミュニティ fork です。関連ノートをたどる操作を
Cosense / Scrapbox に近づけるため、関連度順・PageRank 風の並び替え、カード検索、
リンク元行へのジャンプなどを追加しています。

### 主な追加機能

- `Related score`、`Related, Cosense-like`、`Page rank`、`Most linked` の並び替え
- 設定画面の既定ソートとは別に、現在の 2-hop 表示だけを一時的に
  並び替えられる、チェック付きのコンパクトなソートメニュー
- タイトル、パス、別名、タグ、リンク、必要に応じて本文を対象にしたカード検索
- iPhone や狭い分割ペインでも、横幅いっぱいのコンパクトな検索面・設定・ソートを
  一行に保ち、カードを読みやすい 2 列へ整えるレスポンシブ表示
- 既定と異なる一時ソートを示すアクセント色のドットと、ライト／ダークで読みやすい
  ソートメニュー
- 2-hop カードと Back Links カードから、該当リンク行へのジャンプ
- WebP 画像と相対パス埋め込み画像のプレビュー改善
- Hover Preview や Hover Editor に影響されないアクティブノート追従
- 同名ノート、ピン留めタブ、非同期プレビューの安定性改善
- 長文ノートの上部と 2-hop 表示を往復できる、円形のヘッダーボタン
- カスタム画面から Markdown ノートを開く際の、画面準備待ちと古い描画の中止
- 起動待機、タブ切替の計算待ち時間、グラフ・表示結果の再利用、古い計算の中止による
  大規模 Vault 向けの負荷軽減

詳細は [実装履歴](docs/IMPLEMENTATION_HISTORY.md) と
[既知の制約](docs/reviews/03_KNOWN_LIMITATIONS.md) を参照してください。

### 公開状態と互換性

これは元プロジェクトの公式リリースではありません。プラグイン ID
`2hop-links-plus` を引き継ぐため、元の 2Hop Links Plus と同時にはインストールできず、
置き換えとして動作します。導入前に既存プラグインフォルダをバックアップしてください。

最新の公開版は `0.42.0` です。狭い画面でも検索・設定・一時ソートを一行に保ち、
読みやすい 2 列カードへ切り替えます。検索結果が減っても表示領域を維持し、
設定の既定値と異なる一時ソートはアクセント色の点で示します。本文カードと
2-hop／標準 backlinks の境界を外部 CSS から安定して調整できる連携用クラスも追加しました。

設定の `Tab switch calculation delay (ms)` は通常のタブ切替後の待ち時間です
（既定 `200` ms）。コマンドパレットの `Show performance statistics` と
`Reset performance statistics` で、グラフ構築回数、キャッシュ利用、処理中止回数を
確認できます。

### インストール

リリース公開後は、リリースに添付された `main.js`、`manifest.json`、`styles.css`
を Vault 内の次のフォルダへ配置します。

```text
.obsidian/plugins/2hop-links-plus/
```

既存版から置き換える場合は、先に同フォルダをバックアップし、3 ファイルを置き換えた後、
Obsidian を再起動するかプラグインを再読み込みしてください。

問題が起きた場合は、バックアップした 3 ファイルを元の場所へ戻し、プラグインを
再読み込みしてください。更新作業自体は Vault のノートや添付ファイルを変更しません。

### 開発と確認

開発には Node.js 20.17 以上と npm 11 以上が必要です。GitHub Actions では
Node.js 24 を使用しています。

```bash
npm ci
npm run build
npm test
npm run eslint
git diff --check
npm run benchmark
```

ビルドすると `main.js` が生成されます。手動確認は
[受入試験](docs/specification/ACCEPTANCE_TESTS.md) と
[テスト Vault の説明](test-vault/README_TEST_VAULT.md) に従ってください。

## English

This repository is an unofficial community fork of the Obsidian plugin
[2Hop Links Plus](https://github.com/L7Cy/obsidian-2hop-links-plus) `0.37.0`.
It adds Cosense/Scrapbox-inspired navigation, relevance and PageRank-like
sorting, card search, link-line navigation, and several preview and tab-tracking
fixes.

### Highlights

- `Related score`, `Related, Cosense-like`, `Page rank`, and `Most linked` sort modes
- A compact checked sort menu that temporarily reorders the current 2-hop view
  without changing the default sort order in settings
- Card search across titles, paths, aliases, tags, links, and optionally note bodies
- A single-row toolbar with a full-width compact search surface, settings, and
  sorting, plus readable two-column cards on iPhone-sized or narrow split panes
- An accent dot for temporary sort overrides and a legible light/dark sort menu
- Jump from 2-hop and Back Links cards to the relevant link line
- Better WebP and candidate-relative embedded-image previews
- Active-note tracking that ignores Hover Preview and Hover Editor popups
- Stability fixes for duplicate basenames, pinned tabs, and asynchronous previews
- A circular header control for moving between a long note's top and its 2-hop results
- Markdown-host readiness and stale-render cancellation after leaving a custom view
- Lower large-vault startup and tab-switch load through a startup grace period,
  configurable debounce, graph/result reuse, and cancellation of superseded work

See the [implementation history](docs/IMPLEMENTATION_HISTORY.md) and
[known limitations](docs/reviews/03_KNOWN_LIMITATIONS.md) for details.

### Status and compatibility

This is not an official release of the upstream project. It intentionally keeps
the `2hop-links-plus` plugin ID, so it replaces the upstream plugin rather than
installing alongside it. Back up your existing plugin directory before trying it.

The latest release is `0.42.0`. It keeps search, settings, and temporary sorting
on one row in narrow views, switches to readable two-column cards, and preserves
the rendered results height while a search narrows the card set. Temporary sort
overrides gain an accent dot, and stable integration hooks let optional CSS keep
the note card visually separate from inline 2-hop results and standard backlinks.

`Tab switch calculation delay (ms)` controls the normal post-switch delay and
defaults to `200` ms. The command palette actions `Show performance statistics`
and `Reset performance statistics` report graph builds, cache reuse, and
cancelled superseded work.

### Installation

After a release is published, copy its `main.js`, `manifest.json`, and
`styles.css` assets into:

```text
.obsidian/plugins/2hop-links-plus/
```

When replacing an existing installation, back up that directory first, replace
the three files, and then reload the plugin or restart Obsidian.

If problems occur, restore the three backed-up files and reload the plugin. The
update procedure itself does not modify Vault notes or attachments.

### Development and validation

Development requires Node.js 20.17 or newer and npm 11 or newer. GitHub
Actions uses Node.js 24.

```bash
npm ci
npm run build
npm test
npm run eslint
git diff --check
npm run benchmark
```

The build generates `main.js`. Follow the
[acceptance tests](docs/specification/ACCEPTANCE_TESTS.md) and the
[test-vault guide](test-vault/README_TEST_VAULT.md) for manual validation.

## Attribution and license

This project is derived from
[L7Cy/obsidian-2hop-links-plus](https://github.com/L7Cy/obsidian-2hop-links-plus),
which is itself a fork of
[tokuhirom/obsidian-2hop-links-plugin](https://github.com/tokuhirom/obsidian-2hop-links-plugin).
It is distributed under the [MIT License](LICENSE.md), with the original
copyright notices preserved.
