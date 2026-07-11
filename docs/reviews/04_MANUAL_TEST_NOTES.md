# Manual Test Notes

Manual Obsidian UI testing was not performed during this bundle step.

## Checklist Status

- Not performed: Searching the active note name does not match all cards merely because `sourcePath` is the active note.
- Not performed: Body-only token matches candidate card body only when body search is ON.
- Not performed: Body-only token does not match after body search is OFF, even if body text was previously cached.
- Not performed: `folderA/Foo.md` and `folderB/Foo.md` can both appear in tag cards if both share a tag.
- Not performed: Frontmatter-related cards do not throw when active file cache/frontmatter is unavailable.
- Not performed: 2-hop card click jumps to the candidate page line containing the intermediate link.
- Not performed: Back Links card click jumps to the backlink source line containing the active-page link.
- Not performed: Hover Preview and dragged wikilink disambiguate same-basename files by path.

## Included Test Vault

The previous follow-up test vault is included under `test-vault/`.

## Suggested Extra Manual Fixture

For same-basename checks, add two notes such as:

```text
folderA/Foo.md
folderB/Foo.md
```

Give both notes the same tag and confirm both appear in tag cards when they are valid candidates.
