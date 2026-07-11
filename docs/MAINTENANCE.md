# Maintenance guide

## Responsibilities

This repository owns source code, build configuration, test notes, review
history, and reproducible release configuration. Personal Vault content,
deployment paths, and operational records stay outside the repository.

## Build

```bash
npm ci
npm run build
npm run eslint
git diff --check
```

`npm run eslint` currently reports legacy warnings but must finish with zero
errors. The build creates `main.js`, which remains ignored because it is a
generated artifact.

## Manual acceptance

Use `test-vault/README_TEST_VAULT.md` and
`docs/specification/ACCEPTANCE_TESTS.md`. In addition to scoring and search,
confirm the following interaction behavior:

- Switching normal or pinned main-note tabs updates the 2-hop pane.
- Hover Preview and Hover Editor popups do not change the 2-hop pane target.
- 2-hop and Back Links cards jump to the relevant link line.
- WebP and relative embedded images render in cards.

## Deploy to a test or personal Vault

1. Build and validate the repository.
2. Back up the existing Vault plugin directory outside the Vault.
3. Copy `main.js`, `manifest.json`, and `styles.css` to the confirmed Vault's
   `.obsidian/plugins/2hop-links-plus/` directory.
4. Compare checksums between source and destination.
5. Reload the plugin or restart Obsidian and perform the focused manual checks.

## Rollback

Restore the three files from the most recent timestamped backup, then reload the
plugin or restart Obsidian. The migration itself does not alter the installed
Vault plugin.
