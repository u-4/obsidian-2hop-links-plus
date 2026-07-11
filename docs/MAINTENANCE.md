# Maintenance guide

## Responsibilities

This repository owns source code, build configuration, test notes, review
history, and reproducible release configuration. Personal Vault content,
deployment paths, and operational records stay outside the repository.

## Build

Use Node.js 20.17 or newer with npm 11 or newer. CI and release workflows
currently use Node.js 24. npm 11 is required for the install-script approval
workflow described below.

```bash
npm ci
npm run build
npm run eslint
git diff --check
npm audit
```

`npm run eslint` must finish with zero warnings and zero errors. `npm audit`
must report no known dependency vulnerabilities. The build creates `main.js`,
which remains ignored because it is a generated artifact.

`package.json` approves only the pinned `esbuild` install script. When updating
esbuild, inspect the new package script and re-approve that exact version with
`npm approve-scripts esbuild`; do not approve all dependency scripts at once.

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
plugin or restart Obsidian. The update procedure itself does not modify Vault
notes or attachments.
