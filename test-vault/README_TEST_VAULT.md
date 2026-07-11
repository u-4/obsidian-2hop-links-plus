# Review test vault template

このvaultは、Codexがreview bundleに同梱する最小検証vaultのテンプレートです。実装に合わせてファイル名や手順を調整して構いませんが、本文検索、2-hop、Page rank、Related score、行ジャンプの確認ケースは残してください。

## 基本手順

1. このフォルダをObsidian vaultとして開く。
2. 改修後プラグインを `.obsidian/plugins/<plugin-id>/` に配置し、有効化する。
3. `Active.md` を開く。
4. 2-hopカード表示を確認する。
5. ソートを `Related score`, `Related, Cosense-like`, `Page rank`, `Most linked` に切り替える。
6. 検索欄に `BODY_ONLY_NEEDLE_ALPHA` を入力する。
7. タイトルには検索語がないが本文に検索語がある `BodyOnlyCandidate.md` が残り、2-hop候補ではない `NonCandidateBodyHit.md` は表示されないことを確認する。
8. `BodyLongCandidate.md` に含まれる `LONG_BODY_TOKEN_BETA` でも本文検索できるか確認する。
9. `JumpCandidate.md` のカードをクリックし、ページ内の `[[RareC]]` 行へ移動することを確認する。
10. Back Linksの `BacklinkToActive.md` をクリックし、`[[Active]]` 行へ移動することを確認する。
11. カードタイトルがデフォルトではファイル名のみになり、設定 `Show full path in link cards` を有効にするとフルパス表示へ戻ることを確認する。
12. `.webp` 画像を含むMarkdown候補を追加または既存候補に追記し、カードプレビューに表示されることを確認する。
13. separate paneを開いた状態でカード上のHover Preview / Hover Editorを使っても、メインカラムで選択している `Active.md` の2-hop表示から切り替わらないことを確認する。

## 期待される確認観点

- `MultiSharedCandidate.md` は複数の共通リンクを持つ。
- `HubOnlyCandidate.md` は巨大ハブ的な `[[CommonHub]]` だけを共有する。
- `RareCandidate.md` は希少な `[[RareA]]` を共有する。
- `PageRankHigh.md` は複数ページからリンクされ、Page rankで上がりやすい。
- `PageRankLow.md` は同じ経由リンクを持つが被リンクが少ない。
