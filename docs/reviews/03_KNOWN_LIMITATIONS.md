# Known limitations and risks

- This community fork keeps the upstream `2hop-links-plus` plugin ID, so it
  replaces the upstream plugin rather than installing alongside it.
- Frontmatter-only links participate in link discovery, ranking, and search,
  but Obsidian's public `FrontmatterLinkCache` has no document position. Opening
  a card can therefore open the target note, but cannot reliably jump to the
  frontmatter line. This cache is available in Obsidian 1.4.0 and newer; the
  plugin remains compatible with its declared 1.3.5 minimum without this
  enhancement.
- Canvas file-node paths are relative to the Vault root. Fixtures copied into a
  subfolder must update their `file` values to include that folder path.
- Invalid Canvas JSON or a non-array `nodes` value is ignored and logged to the
  developer console. Individual malformed nodes are silently skipped. Neither
  case stops the plugin.
- The optional body-search cache is bounded and in memory. It is rebuilt after
  the plugin process unloads rather than persisted between Obsidian sessions.
- The scroll control lives in Obsidian's Markdown note view header and is hidden
  when the user disables view headers.
- TypeScript strict null checking is enabled, but focused manual tests remain
  necessary for Obsidian workspace transitions that cannot be reproduced by
  static analysis alone.
- Release validation covers local installation, build, lint, whitespace, and
  dependency audit. Pull-request CI repeats installation, build, lint, and
  whitespace checks and runs CodeQL. Context-menu targets, Hover Preview/Hover
  Editor, mobile long-press, and large-Vault responsiveness still require
  focused manual acceptance before each release.
