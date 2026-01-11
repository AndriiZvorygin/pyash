# `50-modules.md`

**Status:** v0.1

## 1. Purpose

Define a **file-based module system** for Pyash that stays compatible with **signature-first dispatch** and supports interpreter, JS, and C targets.

External tool wrappers (ffmpeg, xdotool, piper, espeak, whisper.cpp, etc.) SHOULD be expressed as modules and imported via `configure/default.pya`, so defaults wire external dependencies once and programs stay declarative.

Modules should:

* treat a module file as a unit of execution and compilation
* support minimal `import` by path or logical name
* support exports for facts and ceremonies
* support qualified access for ceremonies and facts
* load each module once per run (memoized)

This document defines surface syntax and runtime semantics.

---

## Addendum: external tool runner contract (v0.1)

This addendum defines a minimal, backend-agnostic contract for invoking external tools from Pyash modules while keeping built-ins small. It complements the tool envelope specs (`16-mind-and-tools.md`, `11-run-recording-and-artifacts.md`) by defining how a module calls an external command and how results are surfaced.

### A.1 Tool runner goals

* Provide a single runtime entry point for external processes.
* Allow modules to express tool behavior in Pyash while delegating IO to the runner.
* Preserve determinism and tool event recording rules.

### A.2 Required runner behavior

The runtime MUST provide a generic command runner that can:

1. Execute a command (binary plus args) specified by the module.
2. Accept an optional input payload (text or filename).
3. Return:
   * a surfaced result sentence (always),
   * optional streamed chunks (when enabled),
   * artifact records for created files when applicable.

### A.3 Invocation shape (module side)

Modules SHOULD express tool execution via a dedicated ceremony (module wrapper) and pass the command line as text. A command runner invocation MUST include:

* a command line (`text`)
* optional input:
  * `from filename <path>` (read bytes)
  * `fromtext text <payload>` (literal text)
* optional streaming mode (`vyah stream`)

#### A.3.1 Core invocation (normative)

```
su name <handle>
ob text "<command line>"
from filename "<path>"     # optional
fromtext text "<payload>"  # optional
to filename "<path>"       # optional
vyah stream                # optional
be command do
```

Notes:

* `from filename` and `fromtext text` are mutually exclusive.
* `su name <handle>` is required for streaming (so `vyah cancel` can target it).
* `to filename` is optional for non-streaming output capture; when omitted, the runner returns the stdout text.

### A.4 Streaming contract

When `vyah stream` is requested:

* The runner MUST emit a stream handle (`be stream ya`) whose `ob` contains either:
  * `ve values [...]` for in-memory streams, or
  * `filename <path>` pointing to a file that the runner appends to incrementally.
* Modules may consume the stream with `be write vyah stream` or other stream-aware verbs.
* The stream MUST close deterministically (end-of-process, explicit cancel, or backend-specific end token).

#### A.4.1 Stream exit conditions

The runner MUST define one or more explicit exit conditions:

* **process exit**: when the external tool exits, the stream closes.
* **explicit cancel**: a `vyah cancel` call for the same stream name stops the process and closes the stream.
* **end token (optional)**: if configured, a backend-specific terminal token (e.g., `[BLANK_AUDIO]`) closes the stream without waiting for process exit.

### A.5 Tool event recording

Each command execution used as a tool runner MUST emit a tool event as specified in `16-mind-and-tools.md` and `11-run-recording-and-artifacts.md`:

```
su name tool event <counter>
ob la <evoked sentence> ko
to la <result sentence> ko
be tool ya
```

The tool event MUST appear after any `write` records that capture raw tool request/response payloads.

### A.6 Artifact recording

If the tool creates files (audio, transcripts, metadata), the runner MUST emit `be artifact ya` records as described in `11-run-recording-and-artifacts.md`. Modules SHOULD pass explicit filenames to enable deterministic artifact names.

---

## 2. Terms

* **module**: the contents of one module file, addressed by a official module id
* **module id**: official identity used for caching and resolution
* **module namespace value**: a runtime value bound to an alias name, used for genitive fact access
* **export**: a symbol explicitly made visible outside a module
* **import**: bringing a module namespace (or one exported symbol) into caller scope
* **alias**: a local name for an imported module namespace or symbol
* **qualified ceremony name**: a composite verb phrase formed from `<alias> <ceremony-name>`
* **qualified fact access**: a fact accessed via standard genitives (`<alias> ti <fact>` or `<fact> of <alias>`)
* **signature dispatch**: resolution by `be` plus typed cases

---

## 3. Design constraints

1. Dispatch remains signature-first.
2. Module scoping is explicit.
3. Names remain speakable.
4. Determinism first in v0.1: `import` is synchronous at surface level.
5. Parallel-ready core: loader uses a state machine and memoization keyed by official module id.

---

## 4. Module files and boundaries

### 4.1 Module boundary

A module is exactly one file.

* Interpreter boundary: one `.pya` file
* Compiler boundary: one `.pya` file becomes one module unit for JS and C

### 4.2 Top-level rules (v0.1)

**Entry module** (the file passed to run or compile):

* top-level `do` is allowed

**Imported modules**:

* declarations-only
* top-level `do` is forbidden and raises `module import incomplete`

Allowed in imported modules (v0.1):

* ceremony definitions (`be ceremony def … prah`)
* fact writes (`… ya`)
* export marks (`be export ya`)
* imports (`be import do`)

---

## 5. Export

### 5.1 Export mark

Inside a module file:

```
su name <symbol> be export ya
```

Meaning:

* Marks `<symbol>` as exported from this module.
* For facts: exported value is the final value of `su name <symbol> … ya` in module scope at end of module load.
* For ceremonies: exported set includes every signature whose ceremony name is `<symbol>` (all overloads).

Export is declarative.

---

## 6. Import

### 6.1 Import signature disambiguation: modules vs JSON

`be import` exists for JSON import.

This spec defines module import as a disjoint signature family:

* **Module import** uses `from name <module> … be import do`
* **JSON import** uses `from filename <file> … be import do`, or `from state json … be import do`, or any JSON-specific signature defined elsewhere

Routing rule:

* If a sentence has `from name`, it derives only module import signatures.
* If a sentence has `from filename` or `from state json` (or other JSON-specific fields), it derives only JSON import signatures.

File extension routing is permitted as an additional cue:

* `.pya` routes to module import
* `.json` routes to JSON import

### 6.2 Import a module namespace

```
from name <module> to name <alias> be import do
```

* `<module>` is a module specifier (path or logical name)
* `<alias>` is the local namespace name used as module prefix at call sites

If `<alias>` is omitted, the loader assigns a default alias (see §9.3).

Example:

```
from name number tools to name math be import do
```

### 6.3 Import a single symbol (optional convenience)

```
from name <module> ob name <symbol> to name <local> be import do
```

Meaning:

* Imports one exported symbol from the module.
* If `<symbol>` refers to a ceremony name, import registers all exported signatures under the local name (all overloads).
* If `<symbol>` refers to a fact name, import binds that fact value under the local name.

If `<local>` is omitted, `<local>` defaults to `<symbol>`.

Collisions follow existing “last write wins” semantics for facts and for signature registry entries.

---

## 7. Qualified access

### 7.1 Qualified ceremony names (composite verbs)

Qualified ceremony name is a composite verb phrase:

```
<alias> <ceremony-name>
```

Example:

```
ob num 3 to name out be math add two do
```

Dispatcher treats the composite verb phrase as a normal ceremony name for signature dispatch.

### 7.2 Qualified fact access (standard genitives)

Facts are accessed via genitives:

* possessive: `<alias> ti <fact>`
* genitive: `<fact> of <alias>`

Examples:

* `math ti pi`
* `pi of math`

This requires that `<alias>` refers to a module namespace value (see §10.2).

---

## 8. Resolution order

Within a given scope:

1. local (current scope)
2. current module scope
3. imported via qualified forms, or via explicit single-symbol import that creates a local alias

Unqualified fallback into imported modules is excluded in v0.1.

---

## 9. Module identity and resolution

### 9.1 Specifier forms

`<module>` may be:

* a logical name (resolved by import map)
* a path-like specifier (relative or absolute)

Resolution base:

* relative paths resolve against the importing file’s directory
* absolute paths resolve from filesystem root
* logical names resolve via `pyash.json` only

### 9.2 Import map (v0.1)

Import map file:

* filename: `pyash.json`
* location: same directory as the entry module

Schema (v0.1):

```json
{
  "imports": {
    "number tools": "./std/number_tools.pya",
    "string tools": "./std/string_tools.pya"
  }
}
```

Rules:

* keys are logical names as a single string (may contain spaces)
* values are path strings (relative to the entry module directory unless absolute)

Resolution rule for logical names (v0.1):

* map-only resolution
* if logical name has no entry in the import map, raise `module lost`

Path specifiers (`./`, `../`, `/`) bypass the import map and resolve via filesystem.

### 9.3 Default alias rules

If `to name <alias>` is omitted:

* for **logical imports**: alias defaults to the logical words verbatim
  Example: `from name number tools be import do` gives alias `number tools`
* for **path imports**: alias is derived deterministically from the resolved path

Path alias transform:

1. take basename (final path segment)
2. drop extension `.pya`
3. split remaining text on `/`, `\`, `.`, `-`, `_`, and whitespace
4. remove empty segments
5. use remaining segments as a multi-word alias

Examples:

* `./std/math.pya` → `math`
* `./std/string_tools.pya` → `string tools`
* `../x86_64/gpu-kernels.pya` → `gpu kernels`

If the transform yields zero segments, raise `module import incomplete` with a message explaining alias derivation failure.

### 9.4 Official module id and normalisation

The loader resolves the specifier to a official module id.

Normalisation includes:

* collapsing `.` and `..`
* converting to an absolute path
* normalising path separators for the host OS

Normalisation excludes in v0.1:

* symlink resolution (`realpath`)

Official module id is the memoization key.

---

## 10. Loader semantics

### 10.1 Memoization

Each module id parses once per run, but may be initialized under multiple aliases:

* first import for an alias initializes that alias namespace and qualified names
* later imports with the same alias reuse the existing alias bindings
* later imports with a different alias reuse the cached parse, then apply a new alias qualification

### 10.2 Storage model for module exports

To support genitive access, importing binds the alias name to a **module namespace value**.

Observable behaviour:

* `math` behaves like a namespace for exported facts under genitive access (`math ti pi`, `pi of math`)
* exported ceremonies are registered in the signature registry under composite verb phrases (`math add two`, etc.)

Representation is implementation-defined, as long as behaviour matches:

* dedicated module registry keyed by alias name
* special internal value type for module namespaces
* map-like value with reserved internal tags
* module namespace entries store **name references** (live bindings), not snapshots of values

### 10.3 Loader internal state machine (parallel-ready core)

Each official module id has a record with a state:

* UNSEEN: no record
* PARSING: file read and parse in progress
* LINKED: exports table created, exported ceremony signatures registered
* INITIALIZING: module declarations applied to module scope
* LOADED: ready
* FAILED: error stored

In v0.1, `import` is synchronous: it returns only after LOADED or FAILED. The state machine still supports joining in-progress loads, enabling later parallel import.

### 10.4 Export availability (v0.1)

* Export set is determined after parsing the full file.
* Exported ceremony signatures register during LINKED.
* Exported facts become available after INITIALIZING.
* Since `import` returns after LOADED in v0.1, imported exports are usable immediately after the import statement.

### 10.5 Circular imports

Circular imports are tolerated via memoization and join semantics:

* when import encounters a module already in PARSING, LINKED, or INITIALIZING, it joins the existing in-progress load

---

## 11. Error behaviour

All module errors use the global error shape:

* `su name <error-name>`
* `ob text <message>`
* `from name <source>`

### 11.1 Error sources

For consistent tooling, module loader errors use these `from name` values:

* interpreter loader errors: `from name interpret import`
* compiler loader errors: `from name compile import`

### 11.2 Unknown module

If module specifier resolves to no file:

* `su name module lost`

### 11.3 Missing export

If importing a missing symbol:

* `su name module export incomplete`

### 11.4 Import incomplete

Used for:

* top-level `do` inside an imported module
* alias derivation failure
* early use of exports during an in-progress join (future-facing, rare in v0.1)

Error name:

* `su name module import incomplete`

Message should include module id and a short import chain trace where available.

---

## 12. Compilation model (v0.1)

### 12.1 Closed-world inclusion

For JS and C backends in v0.1, compilation is closed-world:

* compile of an entry module resolves and includes all transitive module imports at compile time
* resolution uses the importing file’s directory for relative paths (same as interpreter)
* missing module files at compile time are a compile error (`module lost`)

Entry module may contain top-level `do`. Imported modules follow declarations-only rules.

### 12.2 Multi-file gate

If a backend lacks multi-module parity, keep it gated behind `@js` or `@c` until parity.

---

## 13. Examples

### 13.1 Module file `number_tools.pya`

```
su name pi ob num 3.14159 ya
su name pi be export ya

su name add two to name bucket be ceremony def
  ob num 2 to name bucket be plus do
  su name bucket ret
prah
su name add two be export ya
```

### 13.2 Import with alias and use

```
from name number tools to name math be import do

ob num 3 to name out be math add two do
su name approx ob num (pi of math) ya
```

### 13.3 Import one symbol

```
from name number tools ob name add two to name plus two be import do
ob num 3 to name out be plus two do
```

---

## 14. Open questions

* future async surface for import using aspects (progressive for start, retrospective for await, cessative for cancel)
* importing configuration files as values via JSON map import, plus naming conventions for config maps
