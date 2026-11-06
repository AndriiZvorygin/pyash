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
2. The local maintainer cron fetches both branches and both push remotes, tests
   the proposed `dev`-into-`master` merge with the full CI tier, then pushes the
   tested commit to both branches on each remote. This also accepts `master`
   revisions into `dev`. No pull request or manual branch checkout is needed.
3. To run the maintainer immediately instead of waiting for its daily 04:00
   schedule:

   ```sh
   cd /home/htaf/pyac/pyash-dev
   command/run_local_master_safety.sh
   ```

If the full suite fails or a merge conflicts, no branch is promoted. The run
artifact identifies the exact source commits and contains the failure logs;
repair the issue on `dev` and rerun the maintainer.

## Automated failure diagnosis

`CI Failure Analysis` runs after a failed CI workflow on `dev` or `master`. It
preserves the failed-step log and, when configured, asks Codex `gpt-6-luna` at
`xhigh` effort for a read-only diagnosis. It never edits or pushes code.

Add an OpenAI API key to the repository's GitHub Actions secrets as
`OPENAI_API_KEY` to enable the Codex diagnosis. Without that secret, the
workflow still archives the CI failure log and clearly reports that diagnosis
was skipped.
