# Review test vault template

この vault は、Codex が review bundle に同梱する最小検証 vault のテンプレートです。実装に合わせてファイル名や手順を調整して構いませんが、本文検索、2-hop、Page rank、Related score、行ジャンプの確認ケースは残してください。

## 基本手順

1. このフォルダを Obsidian vault として開く。
2. 改修後プラグインを `.obsidian/plugins/<plugin-id>/` に配置し、有効化する。
3. `Active.md` を開く。
4. 2-hop カード表示を確認する。
5. ソートを `Related score`, `Related, Cosense-like`, `Page rank`, `Most linked` に切り替える。
6. 検索欄に `BODY_ONLY_NEEDLE_ALPHA` を入力する。
7. タイトルには検索語がないが本文に検索語がある `BodyOnlyCandidate.md` が残り、2-hop 候補ではない `NonCandidateBodyHit.md` は表示されないことを確認する。
8. `BodyLongCandidate.md` に含まれる `LONG_BODY_TOKEN_BETA` でも本文検索できるか確認する。
9. `JumpCandidate.md` のカードをクリックし、ページ内の `[[RareC]]` 行へ移動することを確認する。
10. Back Links の `BacklinkToActive.md` をクリックし、`[[Active]]` 行へ移動することを確認する。
11. カードタイトルがデフォルトではファイル名のみになり、設定 `Show full path in link cards` を有効にするとフルパス表示へ戻ることを確認する。
12. `.webp` 画像を含む Markdown 候補を追加または既存候補に追記し、カードプレビューに表示されることを確認する。
13. separate pane を開いた状態でカード上の Hover Preview / Hover Editor を使っても、メインカラムで選択している `Active.md` の 2-hop 表示から切り替わらないことを確認する。
14. `FrontmatterLinkCandidate.md` が `RareA` の 2-hop 候補になり、カード検索で `cosense-test-card` に一致することを確認する。
15. separate pane を有効にして `CanvasActive.canvas` を開き、Canvas 内のファイルノードがリンクとして扱われることを確認する。
16. `Active.md` の Back Links に `CanvasBacklink.canvas` が現れることを確認する。
17. `InvalidCanvasNodes.canvas` を開いてもプラグインが停止せず、空の結果として扱われることを確認する。

> 既存のVault内のサブフォルダへこの試験データをコピーする場合、Canvasの
> `file` はVaultルートからのパスである必要があります。たとえば配置先が
> `2hop-links-plus-test/` なら、`RareA.md` を
> `2hop-links-plus-test/RareA.md` に読み替えてください。このフォルダ自体を
> Vaultとして開く場合は、同梱されたパスのままで利用できます。

## 期待される確認観点

- `MultiSharedCandidate.md` は複数の共通リンクを持つ。
- `HubOnlyCandidate.md` は巨大ハブ的な `[[CommonHub]]` だけを共有する。
- `RareCandidate.md` は希少な `[[RareA]]` を共有する。
- `PageRankHigh.md` は複数ページからリンクされ、Page rank で上がりやすい。
- `PageRankLow.md` は同じ経由リンクを持つが被リンクが少ない。
