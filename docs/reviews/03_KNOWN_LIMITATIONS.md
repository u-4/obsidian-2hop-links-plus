# Known Limitations and Risks

- Manual Obsidian UI testing was not performed for this optional polish pass.
- The body-search cache is bounded by entry count and total character count, but
  it is still an in-memory cache and is reset only when the plugin process is
  unloaded.
- The cache cap is simple LRU-like behavior based on JavaScript `Map` insertion
  order, not a separate full LRU data structure.
- `source/patch-from-final-hardening.diff` contains source changes only. The
  rebuilt `main.js` is included separately under `artifacts/`.
- The exact `git diff --check` command passes, but the plugin source directory is
  inside an untracked work area of the parent operations repository. For that
  reason, `logs/source-diff-check.log` is also included for the actual source
  comparison patch.
- Existing eslint warnings remain and were not addressed because this pass was
  limited to optional polish items.
