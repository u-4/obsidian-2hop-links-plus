// Copies the built main.js, manifest.json and styles.css into the owner's PalmWiki vault.
// Run it through `npm run deploy`, which builds first.
// The installed files and the plugin settings (data.json) are backed up outside
// the vault first, because a new version may migrate data.json when it loads.
// Enablement and hotkeys are left alone.
// Override the vault with PALMWIKI_VAULT=/path/to/vault.
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vault = process.env.PALMWIKI_VAULT
  ?? path.join(os.homedir(), 'PalmWiki');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const target = path.join(vault, '.obsidian/plugins', manifest.id);
const files = ['main.js', 'manifest.json', 'styles.css'];

const exists = async p => stat(p).then(() => true, () => false);
const sha256 = async p => createHash('sha256').update(await readFile(p)).digest('hex');

if (!await exists(path.join(vault, '.obsidian'))) {
  throw new Error(`Vault not found: ${vault}`);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const backup = path.join(os.homedir(), 'Library/Application Support/ObsidianOps/plugin-backups', manifest.id, stamp);
let backedUp = 0;
for (const name of [...files, 'data.json']) {
  if (!await exists(path.join(target, name))) continue;
  await mkdir(backup, { recursive: true });
  await copyFile(path.join(target, name), path.join(backup, name));
  backedUp += 1;
}

await mkdir(target, { recursive: true });
for (const name of files) {
  await copyFile(path.join(root, name), path.join(target, name));
  if (await sha256(path.join(root, name)) !== await sha256(path.join(target, name))) {
    throw new Error(`Checksum mismatch after copying ${name}`);
  }
}

console.log(`Deployed ${manifest.name} ${manifest.version} to ${target}`);
console.log(backedUp ? `Previous files backed up to ${backup}` : 'No previous files to back up.');

// Best effort: reload the plugin in the running Obsidian through its CLI.
const reload = spawnSync('obsidian', [`vault=${path.basename(vault)}`, 'plugin:reload', `id=${manifest.id}`], { encoding: 'utf8', timeout: 30000 });
console.log(reload.status === 0 && /Reloaded/.test(reload.stdout)
  ? 'Reloaded the plugin in Obsidian.'
  : 'Could not reload through the Obsidian CLI; reload the plugin or Obsidian by hand.');
