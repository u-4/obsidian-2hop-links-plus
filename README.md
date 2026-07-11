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
  並び替えられるツールバーのプルダウン
- タイトル、パス、別名、タグ、リンク、必要に応じて本文を対象にしたカード検索
- 2-hop カードと Back Links カードから、該当リンク行へのジャンプ
- WebP 画像と相対パス埋め込み画像のプレビュー改善
- Hover Preview や Hover Editor に影響されないアクティブノート追従
- 同名ノート、ピン留めタブ、非同期プレビューの安定性改善

詳細は [実装履歴](docs/IMPLEMENTATION_HISTORY.md) と
[既知の制約](docs/reviews/03_KNOWN_LIMITATIONS.md) を参照してください。

### 公開状態と互換性

これは元プロジェクトの公式リリースではありません。プラグイン ID
`2hop-links-plus` を引き継ぐため、元の 2Hop Links Plus と同時にはインストールできず、
置き換えとして動作します。導入前に既存プラグインフォルダをバックアップしてください。

最新の公開版は `0.39.0` です。保守版 `0.39.1` では、動作仕様を維持したまま
TypeScript / ESLint の警告解消と開発用依存関係の安全性改善を進めています。

### インストール

リリース公開後は、リリースに添付された `main.js`、`manifest.json`、`styles.css`
を Vault 内の次のフォルダへ配置します。

```text
.obsidian/plugins/2hop-links-plus/
```

既存版から置き換える場合は、先に同フォルダをバックアップし、3 ファイルを置き換えた後、
Obsidian を再起動するかプラグインを再読み込みしてください。

### 開発と確認

開発には Node.js 20.17 以上と npm 11 以上が必要です。GitHub Actions では
Node.js 24を使用しています。

```bash
npm ci
npm run build
npm run eslint
git diff --check
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
- A toolbar dropdown that temporarily reorders the current 2-hop view without
  changing the default sort order in settings
- Card search across titles, paths, aliases, tags, links, and optionally note bodies
- Jump from 2-hop and Back Links cards to the relevant link line
- Better WebP and candidate-relative embedded-image previews
- Active-note tracking that ignores Hover Preview and Hover Editor popups
- Stability fixes for duplicate basenames, pinned tabs, and asynchronous previews

See the [implementation history](docs/IMPLEMENTATION_HISTORY.md) and
[known limitations](docs/reviews/03_KNOWN_LIMITATIONS.md) for details.

### Status and compatibility

This is not an official release of the upstream project. It intentionally keeps
the `2hop-links-plus` plugin ID, so it replaces the upstream plugin rather than
installing alongside it. Back up your existing plugin directory before trying it.

The latest release is `0.39.0`. Maintenance version `0.39.1` improves type
safety and development-tool security while preserving the existing behavior.

### Installation

After a release is published, copy its `main.js`, `manifest.json`, and
`styles.css` assets into:

```text
.obsidian/plugins/2hop-links-plus/
```

When replacing an existing installation, back up that directory first, replace
the three files, and then reload the plugin or restart Obsidian.

### Development and validation

Development requires Node.js 20.17 or newer and npm 11 or newer. GitHub
Actions uses Node.js 24.

```bash
npm ci
npm run build
npm run eslint
git diff --check
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
