# 07. IO And Scripts

Purpose: define file/process/network IO verbs and script execution boundaries.

## 1. Canonical verbs in scope

- read/write/list/exists family
- command execution (`be command`)
- download (`be download`)
- interpret script execution
- date/time helpers used by runtime flows

## 2. IO determinism rules

- sentence-shaped inputs/outputs only
- stable output contracts for same inputs
- explicit cwd/path semantics
- no hidden mutation outside declared targets

## 3. Script execution

Interpreter execution from file/text must:
- preserve sentence parsing invariants
- surface file and parse errors as typed sentence errors

## 4. Download surface

Download verbs must distinguish source scheme and intent via explicit cases (`as wo web`, etc.).

Output should include deterministic target metadata.

## 5. Command surface

`be command` behavior is constrained by safety policies in `19-ops-safety.md`.

## 6. Agent cwd enforcement

Agent runs may use task cwd while retaining access to agent-house paths under policy.

## 7. Conformance

Implementation conforms when IO verbs are deterministic, sentence-shaped, and policy-bounded.

## 8. Full draft reference

Expanded verb-level details are preserved at:
`documentation/recipes/spec-archive/07-io-and-scripts.full.md`
