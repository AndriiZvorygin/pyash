# Dev and Master CI Flow

Pyash uses `dev` for day-to-day implementation and `master` as the full-suite
safety boundary. Development does not require pull requests.

## Checks by branch

- Pushes to `dev` run the smoke tests, documentation and import checks, focused
  quiz tests changed since the merge-base with `master`, and the Rust checks.
- Pushes to `master` run the full CI test tier, documentation and import checks,
  house API compatibility checks, and Rust checks.
- A scheduled run checks the current `master` every day at 08:00 UTC. It is a
  full-suite safety run, independent of whether a commit landed that day.
- A manual CI dispatch follows the same branch rules as a push.

## Promoting work

1. Keep feature work and its focused tests on `dev`; wait for the `dev` checks.
2. Bring upstream `master` changes into `dev` regularly and rerun its checks:

   ```sh
   git fetch origin
   git switch dev
   git merge origin/master
   git push origin dev
   ```

3. When ready to promote, merge `dev` directly into `master` and push. The full
   suite runs on the resulting `master` commit:

   ```sh
   git switch master
   git pull --ff-only origin master
   git merge --no-ff dev
   git push origin master
   ```

If the post-merge full suite fails, the failure report identifies the exact
run, commit, failing step, and relevant test evidence. Fix on `dev`, validate
there, then promote the correction to `master`.

## Automated failure diagnosis

`CI Failure Analysis` runs after a failed CI workflow on `dev` or `master`. It
preserves the failed-step log and, when configured, asks Codex `gpt-6-luna` at
`xhigh` effort for a read-only diagnosis. It never edits or pushes code.

Add an OpenAI API key to the repository's GitHub Actions secrets as
`OPENAI_API_KEY` to enable the Codex diagnosis. Without that secret, the
workflow still archives the CI failure log and clearly reports that diagnosis
was skipped.
