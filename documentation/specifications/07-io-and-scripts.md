# 07. IO And Scripts

Purpose: define filesystem/process/network IO surfaces and script execution boundaries.

## 1. Verb keyword table

| Verb/family | Meaning | Application |
| --- | --- | --- |
| `be read` | ingest file/source into typed value | load text/map/json/etc. |
| `be write` | persist typed value | file output and exports |
| `be list` | directory listing | inspect workspace state |
| `be exists` | path existence check | guards before IO |
| `be command` | external command execution | shell/tool bridge |
| `be download` | fetch from URL/source | web/media retrieval |
| interpret script | execute `.pya` program source | batch run mode |

## 2. Canonical sentence patterns

Read text file:
```pyash
from filename "note.txt" to name text out become text "text" be read do
```

Write text file:
```pyash
ob text "hello" to filename "note.txt" be write do
```

List directory:
```pyash
at filename "." be list do
```

Run command:
```pyash
la ob text "ls -la" to name text output be command do
```

Download web page:
```pyash
from filename "https://example.com" to filename "example.html" as wo web be download do
```

## 3. Determinism and safety

- sentence-shaped I/O only,
- explicit path/cwd semantics,
- no hidden mutations,
- command safety policy governed by `19-ops-safety.md`.

## 4. Agent cwd note

Agent runs may use task cwd while preserving policy-controlled access to agent house files.

## 5. Conformance

Implementation conforms when IO surfaces are deterministic, sentence-shaped, and policy bounded.

## 6. Full draft reference

`documentation/recipes/spec-archive/07-io-and-scripts.full.md`
