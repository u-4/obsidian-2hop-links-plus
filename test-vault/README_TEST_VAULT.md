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
    開くことを確認する。frontmatter リンクには公開 API 上の行位置がないため、特定行への
    ジャンプは期待しない。Obsidian 1.3.5 ではこの frontmatter 専用リンクの検出は
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
21. 十分に広いペインで、左端の検索面が歯車の直前まで伸び、歯車・ソートと一行に
    並ぶことを確認する。検索面は円やピル型ではなく、角を少しだけ丸めた長方形で、
    閉じている時も左端に検索アイコンが見えることを確認する。アイコンを押すと同じ
    外形内の検索欄へフォーカスし、歯車・ソートの位置が動かないことを確認する。
    再度アイコンを押すか Escape を押すと、検索語が解除されることも確認する。
22. ペインを狭くし、検索・歯車・ソートが横にはみ出さず、折り返さず一行に残る
    ことを確認する。ソートアイコンを押した時だけ全候補が表示され、現在の一時
    ソートにチェックが付くことを確認する。separate pane 内で一時ソートを変更しても、
    ペイン、検索語、ツールバー、カードが消えず、その場で並び替わることも確認する。
23. 同梱の `LongScrollActive.md` を Live Preview で開き、右上の縦型二重山形アイコンを押す。
    本文上部または中ほどから 2-hop 表示先頭へ移動し、2-hop 表示中に再度押すと
    1.5 秒以内に先頭見出しまで戻り、途中位置で止まらないことを 3 往復確認する。
24. Reading view と Source mode でも同じ往復を各 3 回確認し、モード切替、検索、
    ソート変更、別ノートとの往復後もアイコンが 1 個だけであることを確認する。
    上へ戻る途中でホイールまたはキー操作を行った場合は、その手動操作後に
    強制的な再スクロールが起きないことも確認する。
25. separate pane を有効にすると本文内 2-hop 表示と往復アイコンが消え、独立ペインにも
    同アイコンが追加されないことを確認する。試験後は separate pane を無効へ戻す。
26. 往復アイコンが円形の枠と立体感を持ち、ホバー時に浮き、押下時に沈むように見える
    ことを確認する。
27. Markdown と同じ leaf で同梱の `CanvasActive.canvas` を開き、右上往復アイコンが
    Canvas へ残らないことを確認する。Markdown へ戻るとアイコンが 1 個だけ復帰することを
    確認する。
28. Markdown と `CanvasActive.canvas` を左右に分割し、Markdown 側には右上往復
    アイコンが 1 個残り、Canvas 側には表示されないことを確認する。分割を閉じても
    Markdown 側のアイコンが重複しないことを確認する。
29. PalmWiki Home などの custom view が利用できる場合、その画面から `Active.md` を
    同じ leaf へ初回表示する。Live Preview → Reading view → Source mode → Live Preview と
    切り替え、各段階で現行ノートの本文 2-hop、固有カード、右上アイコン 1 個を確認する。
30. `Active.md` とカード構成が異なる `BodyOnlyCandidate.md` を Reading view で開き、
    Live Preview へ戻る。`BodyOnlyCandidate.md` の結果だけがあり、前ノートの hidden
    container や古いカードが復活しないことを確認する。
31. Reading view 中に `Show 2hop links in separate pane` を有効にし、Live Preview へ
    切り替えて本文 2-hop と右上アイコンがともに 0 であることを確認する。逆方向も確認し、
    試験後は設定を無効へ戻して現行ノートの結果が 1 組だけ復帰することを確認する。
32. Source と Reading の両方を一度表示した後、Community Plugins から本プラグインを
    無効化して反対 mode へ切り替える。3〜5 秒待っても本文 2-hop と右上アイコンが復活
    しないことを確認し、最後にプラグインを再有効化する。
33. iPhone 相当の狭幅または実機で、ライトテーマとダークテーマを切り替える。3 つの
    操作が一行に残り、狭幅時は各ボタンが 44px 相当で、カードが 2 列、カード本文が
    薄すぎず読めることを確認する。横向きでも横スクロールが出ないことを確認する。
34. 狭幅で検索を展開し、日本語と `BODY_ONLY_NEEDLE_ALPHA` を入力する。ソフトウェア
    キーボード表示中も設定・ソートが同じ行に残り、閉じると全カードへ戻ることを
    確認する。`Rare`、`BODY_ONLY_NEEDLE_ALPHA`、`NO_MATCH_2HOP_20260715` の順で
    入力しても検索面の画面上の位置が動かず、検索開始前のカード領域の高さが保たれる
    ことを確認する。ソートメニューが画面外へ切れないことも確認する。
35. `cosense-scrapbox-style.css` を有効にし、Live Preview、Source、Reading の各 mode で
    本文だけが白またはテーマ対応色のカードになり、2Hop 領域が周囲の背景上にある
    ことを確認する。Obsidian の `Show backlinks in document` も開き、標準 backlinks が
    本文カードとは別の領域になることを確認する。2Hop 領域の左右・下端に細い白線が
    残らないことも確認する。
36. 連携 CSS を無効にしても 2Hop の検索・設定・ソート、2 列カード、ライト／ダークの
    読みやすさが維持されることを確認する。最後に使用する CSS 状態へ戻す。
37. 設定の既定ソートと同じ間はソートアイコンに印がなく、異なる一時ソートを選ぶと
    右上にテーマのアクセント色の小さな丸い点が出ることを確認する。既定へ戻すと点が
    消えることを確認する。ソートメニューはライトで白背景と黒系文字、ダークで暗い
    背景と明るい文字になり、チェック・選択行を含めて読めることを確認する。

> 既存の Vault 内のサブフォルダへこの試験データをコピーする場合、Canvas の
> `file` は Vault ルートからのパスである必要があります。たとえば配置先が
> `2hop-links-plus-test/` なら、`RareA.md` を
> `2hop-links-plus-test/RareA.md` に読み替えてください。このフォルダ自体を
> Vault として開く場合は、同梱されたパスのままで利用できます。

## 期待される確認観点

- `MultiSharedCandidate.md` は複数の共通リンクを持つ。
- `HubOnlyCandidate.md` は巨大ハブ的な `[[CommonHub]]` だけを共有する。
- `RareCandidate.md` は希少な `[[RareA]]` を共有する。
- `PageRankHigh.md` は複数ページからリンクされ、Page rank で上がりやすい。
- `PageRankLow.md` は同じ経由リンクを持つが被リンクが少ない。
