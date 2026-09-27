# AGENTS.md

## Communication

- User-facing communication must be in Japanese.
- Explain outcomes, impact, validation, and rollback in terms suitable for a non-programmer.

## Project Scope

- This repository is the maintained community fork of Obsidian `2hop-links-plus` 0.37.0.
- Source development, tests, review notes, and release artifacts belong here.
- Personal Vault notes, attachments, paths, and operational records stay outside this repository.

## Build And Validation

- Do not upgrade dependencies unless explicitly requested.
- Install from the lockfile with `npm ci` when possible.
- Required checks after source changes:
  - `npm run build`
  - `npm run eslint`
  - `git diff --check`
- Use `test-vault/` and `docs/specification/ACCEPTANCE_TESTS.md` for manual checks.

## Vault Deployment

- The owner's main Vault is the standing deployment target. Deploying verified builds there does not need approval each time; any other Vault needs confirmation.
- Plugin destination inside the Vault: `.obsidian/plugins/2hop-links-plus/`.
- Before writing, create a timestamped backup outside the Vault.
- Deploy only `main.js`, `manifest.json`, and `styles.css` unless another file is explicitly required. Do not change plugin settings (`data.json`), enablement, or hotkeys without asking.
- Verify checksums after copying. Never copy Vault notes or attachments into this repository.

## Editing Safety

- Inspect Git status and relevant files before editing.
- Preserve unrelated user changes.
- Do not commit `node_modules`, Vault workspace files, credentials, personal notes, or review bundles containing duplicate full source archives.
- Use public Obsidian APIs and metadata cache. Keep full-Vault text reads out of render paths.
