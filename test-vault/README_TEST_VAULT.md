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
14. Obsidian 1.4.0 以上で `FrontmatterLinkCandidate.md` が `RareA` の 2-hop
    候補になり、カード検索で `cosense-test-card` に一致し、クリックで対象ノートが
    開くことを確認する。frontmatterリンクには公開API上の行位置がないため、特定行への
    ジャンプは期待しない。Obsidian 1.3.5 ではこのfrontmatter専用リンクの検出は
    期待しない。
15. separate pane を有効にして `CanvasActive.canvas` を開き、Canvas 内のファイルノードがリンクとして扱われることを確認する。
16. `Active.md` の Back Links に `CanvasBacklink.canvas` が現れることを確認する。
17. `InvalidCanvasNodes.canvas` を開いてもプラグインが停止せず、空の結果として扱われることを確認する。
18. `Tab switch calculation delay (ms)` を既定の `200` にし、複数のノートタブを
    A → B → C のように素早く切り替える。最後に選択した C だけが表示対象になることを
    確認する。
19. コマンドパレットで `Reset performance statistics` を実行し、複数タブを往復した後、
    `Show performance statistics` を実行する。同じ状態では Graph builds が増え続けず、
    graph hits または result hits が増えることを確認する。
20. Obsidian を再起動し、復元中の非選択タブが長時間「ファイルがありません」にならず、
    他の起動時処理と同時に重い再計算が繰り返されないことを確認する。
21. 十分に広いペインで、検索欄が歯車の直前まで伸び、歯車と一時ソートが右端に
    揃うことを確認する。検索欄は既定カード約5枚分（727px）で伸び止まり、さらに
    広げても操作群は右端に残ることを確認する。
22. ペインを狭くし、検索・歯車・一時ソートが横にはみ出さず、折り返した場合も
    すべて操作できることを確認する。separate pane内で一時ソートを変更しても、
    ペイン、検索語、ツールバー、カードが消えず、その場で並び替わることも確認する。
23. 同梱の `LongScrollActive.md` をLive Previewで開き、右上の縦型二重山形アイコンを押す。
    本文上部または中ほどから2-hop表示先頭へ移動し、2-hop表示中に再度押すと
    ノート最上部へ戻ることを3往復確認する。
24. Reading viewでも同じ往復を確認し、モード切替、検索、ソート変更、別ノートとの
    往復後もアイコンが1個だけであることを確認する。
25. separate paneを有効にすると本文内2-hop表示と往復アイコンが消え、独立ペインにも
    同アイコンが追加されないことを確認する。試験後はseparate paneを無効へ戻す。
26. 往復アイコンが円形の枠と立体感を持ち、ホバー時に浮き、押下時に沈むように見える
    ことを確認する。
27. Markdownと同じleafで同梱の `CanvasActive.canvas` を開き、右上往復アイコンが
    Canvasへ残らないことを確認する。Markdownへ戻るとアイコンが1個だけ復帰することを
    確認する。
28. Markdownと `CanvasActive.canvas` を左右に分割し、Markdown側には右上往復
    アイコンが1個残り、Canvas側には表示されないことを確認する。分割を閉じても
    Markdown側のアイコンが重複しないことを確認する。
29. PalmWiki Homeなどのcustom viewが利用できる場合、その画面から `Active.md` を
    同じleafへ初回表示する。Live Preview → Reading view → Source mode → Live Previewと
    切り替え、各段階で現行ノートの本文2-hop、固有カード、右上アイコン1個を確認する。
30. `Active.md` とカード構成が異なる `BodyOnlyCandidate.md` をReading viewで開き、
    Live Previewへ戻る。`BodyOnlyCandidate.md` の結果だけがあり、前ノートのhidden
    containerや古いカードが復活しないことを確認する。
31. Reading view中に `Show 2hop links in separate pane` を有効にし、Live Previewへ
    切り替えて本文2-hopと右上アイコンがともに0であることを確認する。逆方向も確認し、
    試験後は設定を無効へ戻して現行ノートの結果が1組だけ復帰することを確認する。
32. SourceとReadingの両方を一度表示した後、Community Pluginsから本プラグインを
    無効化して反対modeへ切り替える。3〜5秒待っても本文2-hopと右上アイコンが復活
    しないことを確認し、最後にプラグインを再有効化する。

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
