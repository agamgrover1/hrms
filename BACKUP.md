# Backup & recovery

Two things need to survive an incident: the **code** and the **database**. They're independent — you can lose one without losing the other, and the recovery paths are different.

## Layers of protection (already in place)

| Layer | What it protects | Retention | How you use it |
| --- | --- | --- | --- |
| **Git remote** (`agamgrover1/hrms`) | Code — every commit | Forever | `git clone …` from any machine |
| **Git tags** (`backup-YYYY-MM-DD`) | Named recovery checkpoints on top of git | Forever | `git checkout backup-2026-07-31` |
| **Neon point-in-time restore (PITR)** | Database — every write | 7 days (free) / 30+ (paid) | Neon console → project → Restore → pick a timestamp |
| **`scripts/backup-db.sh`** | Database — logical dump | As long as you keep the file | Manual archive in `backups/` |
| **Vercel deploy history** | Live production build + env vars | ~30 days | Vercel dashboard → Deployments → Promote a previous one |

## Recovery — most likely scenario first

### "Someone deleted / bad-changed rows in the last week"

Use **Neon PITR**. Fastest, no dump needed.

1. Neon console → your project → **Branches**
2. Click **Restore** on your main branch
3. Pick a timestamp (accurate to the second)
4. Neon creates a new branch at that point-in-time. Verify the data there, then either:
   - Repoint the app to the new branch (change `DATABASE_URL` in Vercel env), or
   - Copy the good rows back into the live branch

No dumps involved. This is the primary safety net for day-to-day mistakes.

### "The database is corrupted / gone / we need to move providers"

Use a `pg_dump` archive.

```bash
scripts/restore-db.sh backups/2026-07-31_095455.sql.gz
```

The script drops and recreates the `public` schema on the target `DATABASE_URL` before importing, so **every row in the target is gone the moment you type `YES REPLACE`**. Restore into a fresh Neon project first if you're not 100% sure:

```bash
RESTORE_URL="postgres://user:pass@fresh-project/db" scripts/restore-db.sh backups/…
```

### "The code broke — need to roll back"

Two options, in order of preference:

1. **Vercel** → Deployments → find the last known-good deploy → **Promote to Production**. Instant, no git surgery.
2. **Git** → `git revert <bad-sha>` on `main`, push. Vercel picks it up.

Only use `git checkout backup-YYYY-MM-DD` if you're rebuilding a working copy on a new machine.

## Taking a fresh backup

```bash
# One-time setup (macOS)
brew install libpq                                # gives you pg_dump
# ~/.zshrc: export PATH="/opt/homebrew/opt/libpq/bin:$PATH"   (optional; the script uses the pinned path)

# Every backup after that
./scripts/backup-db.sh
```

Writes `backups/YYYY-MM-DD_HHMMSS.sql.gz`. The `backups/` folder is gitignored — dumps contain full customer data (salaries, warnings, personal info) so treat them as sensitive. Recommended storage:

- Local disk in `backups/` (default)
- Copy to an encrypted external drive weekly
- Or push to a private S3/Backblaze/etc bucket with server-side encryption

**Never commit a dump to git.** The `.gitignore` prevents accidental staging but always double-check `git status` before pushing.

## Automating it

The current script is on-demand. If you want a nightly cron, add this to your crontab:

```cron
# 2 AM local — take a backup, keep last 30
0 2 * * *  cd /Users/agamgrover/Claude\ Code/keka-hr-clone && ./scripts/backup-db.sh && find backups -name '*.sql.gz' -mtime +30 -delete
```

Or on Vercel: add a scheduled function that runs the same `pg_dump` and uploads the result to S3. Out of scope for this doc but the script is the reference.

## What's actually in a dump

- Every table's schema (`CREATE TABLE`, indexes, constraints)
- Every row (`COPY` blocks)
- Sequences with their current values
- No ownership / permissions (`--no-owner --no-privileges`) so it restores cleanly into any Postgres

What's **not** in a dump:

- The `.env` file — passwords, JWT secrets, API keys. Store those separately (1Password, a sealed envelope, wherever).
- Uploaded files — the app doesn't have any right now; if you add file uploads later, back up that store separately.
- Neon-specific state like branches / PITR history — Neon manages that.

## Verifying the backup works

Once a quarter, test the restore path against a fresh Neon branch:

1. In Neon console, create a new branch of `main` called `restore-test`.
2. Get its connection string.
3. `RESTORE_URL="postgres://...restore-test..." scripts/restore-db.sh backups/<latest>.sql.gz`
4. Point a local dev server at that branch, sign in, poke around, confirm data.
5. Delete the branch.

A backup you've never restored is a backup you don't have.
