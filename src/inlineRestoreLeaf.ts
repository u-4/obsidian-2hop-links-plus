interface InlineRestoreContext<TLeaf, TContainer> {
  didCloseActiveSeparatePane: boolean;
  activeLeafAfterClose: TLeaf | null;
  closedSeparatePaneLeaf: TLeaf | null;
  recentLeaf: TLeaf | null;
  expectedContainer: TContainer | null;
  isMarkdownLeaf: (leaf: TLeaf) => boolean;
  getContainer: (leaf: TLeaf) => TContainer;
}

export function chooseInlineRestoreLeaf<TLeaf, TContainer>({
  didCloseActiveSeparatePane,
  activeLeafAfterClose,
  closedSeparatePaneLeaf,
  recentLeaf,
  expectedContainer,
  isMarkdownLeaf,
  getContainer,
}: InlineRestoreContext<TLeaf, TContainer>): TLeaf | null {
  if (
    !didCloseActiveSeparatePane ||
    !closedSeparatePaneLeaf ||
    !expectedContainer
  ) {
    return null;
  }

  // Respect any leaf that Obsidian selected while the separate pane closed.
  if (activeLeafAfterClose && activeLeafAfterClose !== closedSeparatePaneLeaf) {
    return null;
  }

  if (!recentLeaf || !isMarkdownLeaf(recentLeaf)) {
    return null;
  }

  return getContainer(recentLeaf) === expectedContainer ? recentLeaf : null;
}
