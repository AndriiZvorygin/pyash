# Caterer rules (third-party code)

Goal: predictable, reproducible third-party integration with minimal repo churn.

## When to use caterer/
Use caterer/ for third-party source snapshots that we want inside git history.

Preferred structure
- one upstream project per directory:
  - caterer/cjson/
  - caterer/zsv/
  - caterer/node-csv/ (only if we vendor Node sources)

Keep vendored trees pristine
- avoid local edits inside caterer/<project>/
- put glue code in program/ (preferred) or in caterer/<project>/pyash/ when needed

## How to vendor

C/C++ libraries
- use git subtree:
  git subtree add --prefix caterer/<project> <upstream_url> <tag_or_commit> --squash

Updates:
  git subtree pull --prefix caterer/<project> <upstream_url> <tag_or_commit> --squash

Node.js libraries
- prefer npm dependency + lockfile (package-lock.json or pnpm-lock.yaml)
- use caterer/ only when offline vendoring is required

If offline vendoring is required for Node:
- subtree the upstream source repo (often a mono-repo)
- document the subpath used (example: packages/csv-parse)
