# CIVIC — repo conventions for Claude Code sessions

Working notes for any Claude Code session (operator or builder) committing to this repo.
The authoritative planning docs live in `docs/` (ARCHITECTURE.md, BUILD_PLAN.md, decisions.md);
this file only covers *how agents work in the repo*, not the product design.

## Commit identity (attribution)

Commits made by an agent must be **distinguishable from the owner's own commits in git
metadata**, not only in the message trailer:

- **Author** stays the repository owner (`git config user.name/email` → Nora Wu). The owner
  owns and is accountable for everything on `main`, regardless of who produced it.
- **Committer** is set to the agent for agent-made commits, so `git log --format='%an <%ae> / %cn'`
  cleanly separates human-produced from agent-produced commits. The operator uses:

  ```
  GIT_COMMITTER_NAME="Claude (operator)" GIT_COMMITTER_EMAIL="noreply@anthropic.com" \
    git commit -m "…"
  ```

  Builder agents set their own committer name (e.g. `Claude (builder: B1)`), same email.
- Keep the `Co-Authored-By: Claude …` trailer as well — it is the GitHub-rendered signal;
  the committer field is the blame-level signal.

Rationale (decisions D-016 discussion): the git author field records *ownership*, but by
itself it erases *authorship* and *review-depth* — a `git blame` that says "Nora Wu" on
agent-generated code sets an expectation the owner may not have context for. The distinct
committer field restores that without changing ownership.

## Decisions protocol

Any interface, schema, security, or process change gets a numbered entry in
`docs/decisions.md` (D-NNN) — record the reasoning and the *alternatives rejected*, not just
the conclusion, because the deliberation otherwise survives only in an ephemeral chat
transcript. Cross-reference the decision number in the commit message.

## Running the DB test suites without Docker (D-017)

The migration/RLS/auth suites normally need the Supabase CLI (Docker). This environment has
no Docker but does have a local PostgreSQL server, so the suites also accept an externally
provisioned database via `CIVIC_TEST_DB_URL`:

```
createdb civic_test
psql -d civic_test -f tests/lib/pg-local-stub.sql          # roles + auth schema stub
for f in supabase/migrations/*.sql; do psql -d civic_test -v ON_ERROR_STOP=1 -f "$f"; done
CIVIC_TEST_DB_URL="postgresql:///civic_test" node tests/rls/policies.test.mjs
```

The stub grants **schema usage only** — it deliberately does NOT blanket-grant table
privileges, so migration `GRANT`s are exercised rather than masked (this is how D-018's
missing-grant defect was found). Keep it faithful to the real stack.

## CI

`.github/workflows/ci.yml` — six jobs (`migrations`, `auth`, `rls`, `content`, `calibration`,
`column-refs`). Keep `main` green: builders branch off it. CI logs are readable via the
authenticated `gh` CLI (`gh run view <id> --log-failed`).
