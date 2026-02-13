# Pyash cheat sheet (coding-only, compact)

Audience: small models writing Pyash programs without reading the full spec.
Scope: only how to write correct code (no philosophy).

## 1) Sentence core

**Canonical sentence shape (keyworded cases):**

```
[mood] su <subject> [ob <object>] be <verb> [cases...] [mood-end]
```

Common moods:

- `ya` = declarative (fact)
- `do` = imperative (execute)
- `def` / `prah` = ceremony definition block

**Always** use canonical ordering and canonical case keywords.
If unsure, see `01-sentence-and-grammar.md` and `documentation/specifications/compositional-cases.md`.

## 2) Types and literals

- **text**: `"quoted string"`
- **num**: `num 3`, `num 3.14`
- **bool**: `truth`, `lie`
- **hollow**: `null`
- **name**: unquoted identifier
- **vec**: `ve ...` list
- **map**: `be map def ... prah` (see `06-data-formats.md`)

Examples:

```pyash
exists su name greeting ob text "hi" be text ya
exists su name flag ob bool truth be bool ya
exists su name nums ob ve num 1 num 2 num 3 be vec ya
```

## 3) Blocks and scoping

Ceremonies define reusable procedures:

```pyash
su name hello ob text who be ceremony def
  ob text "hi " to name text out be plus do
  ob name who to name out be plus do
  su name out ret
prah
```

Rules:

- `def` starts a block, `prah` ends it.
- `this` refers to the invoking sentence.
- `ret` returns a value to caller.

## 4) Control flow (minimal)

Conditional:

```pyash
ob name flag be equally from bool truth then
  ob text "ok" be write do
```

Re-entry (loop-like):

```pyash
fromindex num 0 toindex num 2 to name text result be re-entry cycle do
```

Error:

```pyash
su name broken ob text "reason" from name runtime be error ya
```

## 5) Tool and IO verbs (core)

Common IO verbs (see `07-io-and-scripts.md`):

- **read**: raw bytes by default; text extraction with `become wo text`.
- **write**: write `ob text` to output or `to filename`.
- **download**: fetch remote content to artifacts.
- **search**: web search (see `12-web-and-browser.md`).
- **command**: run shell command (use carefully).
- **import**: load a module.

Examples:

```pyash
ob text "hello" to filename "/tmp/hello.txt" be write do
from filename "/tmp/hello.txt" become wo text to name text out be read do
ob name out be write do
```

```pyash
ob text "pyash language" fromstate text "web" be search do
```

```pyash
from filename "./module/read_auto.pya" ob name read to name read be import do
```

## 5b) Runtime defaults (dynamic)

- Defaults are loaded from `configure/default.pya`, then `configure/container.pya` (in containers), then `configure/secret.pya`.
- Config roots are found by searching upward from the entry program path, plus the current working directory.
- Defaults are normal sentences using `be default` facts.

## 6) Common idioms (10–20)

1) Declare constant:
```pyash
exists su name site ob text "https://example.com" be text ya
```

2) Read text file:
```pyash
from filename "notes.txt" become wo text to name text out be read do
```

3) Write text file:
```pyash
ob text "done" to filename "out.txt" be write do
```

4) Download a file:
```pyash
ob text "https://example.com/file.pdf" be download do
```

5) Read HTML as markdown:
```pyash
from filename "page.html" become wo markdown to name text out be read do
```

6) Read PDF as text:
```pyash
from filename "doc.pdf" become wo text to name text out be read do
```

7) Conditional:
```pyash
ob name ok be equally from bool truth then
  ob text "ok" be write do
```

8) Simple pipeline step:
```pyash
ob text "hello" be write do
```

9) Import module:
```pyash
from filename "./module/read_html.pya" ob name read to name read be import do
```

10) Use `wo` literal dispatch (exact signature word):
```pyash
from filename "file.pdf" fromstate wo pdf become wo text to name text out be read do
```

## 7) Formatting rules (high priority)

Always:

- use **canonical order**
- use **canonical case keywords**
- use **double quotes** for text
- terminate blocks with `prah`
- keep one verb per sentence

Never:

- invent new keywords or reorder cases
- omit `be` when a verb is required
- mix multiple verbs in one sentence
- invent map wrappers when a canonical sentence form already exists

## 8) Gotchas (frequent failures)

1) `be read` default returns **bytes**, not text.
2) `become wo text` is required for text extraction.
3) `wo` is a **literal dispatch word**; only use when needed.
4) `from filename` is not the same as `from name`.
5) `ob name X` refers to a name; `ob text "X"` is literal.
6) Ceremonies must close with `prah`.
7) Use `exists su name ... be <type> ya` for facts.
8) `do` executes; `ya` declares a fact.
9) `be error ya` is data; `be error do` throws.
10) Always introduce names before use.
11) For lifecycle/aspect outcomes, use `vyah ... success` or `vyah ... fail`.

## 9) Minimal grammar sketch

```
Sentence := [Mood] Subject Object? "be" Verb Cases* [MoodEnd]
Subject  := "su" Name | "exists su" Name
Object   := "ob" Value
Cases    := ("from" | "to" | "as" | "with" | "accordingto" | "during" | ...) Value
Mood     := "ya" | "do" | "def"
MoodEnd  := "ya" | "do" | "prah"
```

## 10) Validation checklist (mentally verify)

- One verb per sentence.
- Canonical order and keywords.
- Names introduced before use.
- Quotes only around text.
- `be read` uses `become wo text` when text is needed.
- Every block has `prah`.
- If using `wo`, ensure it matches the signature word exactly.
