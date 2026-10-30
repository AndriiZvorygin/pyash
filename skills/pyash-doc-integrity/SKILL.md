---
name: pyash-doc-integrity
description: "Detect and repair prose corruption caused by bulk keyword replacement across docs/examples, and verify examples still execute."
---

# Pyash Doc & Example Integrity

Use when a vocabulary migration, alias change, or signature rename touched many
files, or when docs/examples may have drifted from runtime behavior.

## Why this skill exists

Repo-wide search-and-replace over Pyash keywords can silently corrupt English
prose. Keyword tokens like `until`, `subj`, `obj`, `fromindex`, `toindex` are
also ordinary English words, so a blanket replace hits prose too.

Observed instance: commit `28b392eb` ("migrate loops to sequence registers")
replaced `until` with `toindex` across 44 files, which rewrote sentences like
"remain as history until garbage collection chooses to purge them" into
"remain as history toindex garbage collection chooses to purge them". <!-- prose-check: ignore -->

A later commit (`9a665afe`, "normalize su ob and update signatures") replaced
`subj`/`obj` with `su`/`ob`, which mangled the design doc phrase
"The subject (`su` / `subj`)" into "The subject (`su` / `su`)". <!-- prose-check: ignore -->

Both defects were repaired in `documentation/design.md` by commit `7a5afffa`;
the originals were recovered from git history with `git log -L`.

## Audit commands

Run the guard first — it detects both shapes and is wired into CI:

```bash
node command/check_doc_prose.mjs
```

A line that quotes a corrupted passage on purpose opts out with
`prose-check: ignore` on the same line. The marker is read outside inline code
spans, so put it in an HTML comment rather than in backticks. Exempt lines are
counted in the output, so an exemption never hides silently.

To search by hand:

```bash
# keyword sitting between two lowercase words = prose corruption
git grep -nE '\b[a-z]+ (until|toindex|fromindex|subj|obj) [a-z]+' -- '*.md' '*.txt'
```

Find the tell-tale `su` / `su` or `obj` / `obj` duplication: <!-- prose-check: ignore -->

```bash
git grep -nE '\((or )?`(su|obj)`\)' -- '*.md'
```

Trace when a line was corrupted:

```bash
git log -L <line>,<line>:<file> --oneline
```

## Example integrity

Docs and `examples/` drift independently of the runtime. A `.pya` example can
parse, run without throwing, and still produce a wrong result.

Check the example's documented expectation against real behavior:

```bash
node command/read_pya_trace.mjs examples/pyash/<file>.pya
```

Compare the final memory facts to the "Expected output" block in the paired
`examples/core/<name>.md`.

Prefer the official runner over ad-hoc line splitting. The runner uses
`splitSentencesWithLines` and handles multi-line quoted blocks; naive
`split("\n")` breaks `quoted.pyash.` programs and produces false failures.

```bash
node command/run_pya_program.mjs examples/pyash/<file>.pya --verbose
```

## Report shape

For each defect: file, line, the corrupted phrase, the intended phrase, the
commit that introduced it, and whether runtime behavior is affected.
