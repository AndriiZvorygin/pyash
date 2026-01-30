# `07-io-and-scripts.md` (merged)

Merged specification sources (legacy IDs):
- 24-directory-commands
- 31-date-and-time
- 32-interpret-script
- 33-download

---

# Chapter map

This chapter is four sections in order:
1. Directory commands (filesystem verbs).
2. Date and time (literals and date math).
3. Interpret script (execute `.pya` text files).
4. Read (text extraction).
5. Download (URL fetch into files).

# Directory commands (draft v0.1)

**Status:** draft (semantics locked, wording polish pending)

---

## 1. Purpose

Define the common directory-browsing verbs as Pyash sentences. These verbs are
intended for module-backed implementations, but the sentence forms and outputs
are stable across runtimes.

All inputs and outputs MUST be Pyash sentences.

---

## 2. Verbs (official)

### 2.1 `list` — directory listing

#### 2.1.1 Input forms

1. Default (current directory):
`be list do`

2. Explicit root:
`from filename "<dir>" be list do`

3. Filter by entry type:
`from filename "<dir>" as wo file be list do`  
`from filename "<dir>" as wo dir be list do`  
`from filename "<dir>" as wo all be list do`

4. Include hidden entries:
`from filename "<dir>" with name hidden be list do`

5. Recursive listing:
`from filename "<dir>" as wo recursive be list do`

#### 2.1.2 Defaults

* root directory: current working directory
* filter: `all`
* hidden entries: excluded (names starting with `.`)
* recursion: disabled
* `as wo recursive` implies filter `all`
* order: stable ASCII lexicographic (A-Z, a-z, 0-9, `_`, `-`, `.`)
* entries are returned as base names only when not recursive
* recursive entries are returned as paths relative to the root
* path separator: `/` (even on Windows)

#### 2.1.3 Output form

`ob ve text "<entry0>" "<entry1>" ... be list ya`

Implementations MAY instead return a named vector:

`ob name "<vector-name>" be list ya`

When using a named vector, the referenced sentence MUST be:

`su name "<vector-name>" ob ve text ... be vector ya`

If no entries match, return an empty vector:

`ob ve hollow be list ya`

#### 2.1.4 Errors

* missing directory or permission errors MUST emit `be error ya`
* non-directory roots MUST emit `be error ya`

---

## 3. Examples (informative)

List the current directory:

`be list do`

List only directories under `/var/log` (including hidden):

`from filename "/var/log" as wo dir with name hidden be list do`

Walk the repo recursively:

`from filename "/home/user/project" as wo recursive be list do`

---

### 2.2 `go` — change working directory

#### 2.2.1 Input form

`be go to filename "<dir>" do`

#### 2.2.2 Behavior

* Sets the current working directory for the remainder of the run.
* Affects relative `from filename`, `to filename`, and module path resolution.
* MUST NOT change any process-global state outside the current run.

#### 2.2.3 Output form

`ob filename "<dir>" be go ya`

#### 2.2.4 Errors

* missing directory or permission errors MUST emit `be error ya`
* non-directory targets MUST emit `be error ya`

---

### 2.3 `copy` — file copy

#### 2.3.1 Input form

`be copy ob filename "<src>" to filename "<dest>" do`

#### 2.3.2 Behavior

* Copies a file byte-for-byte from `<src>` to `<dest>`.
* Intermediate directories for `<dest>` MUST be created if missing.
* Existing destination files MUST be overwritten.
* Implementations MUST NOT mutate `<src>`.
* Future backend note: when available, implementations MAY use `rsync` (or equivalent)
  for large copies or network paths.

#### 2.3.3 Output form

`ob filename "<dest>" be copy ya`

#### 2.3.4 Errors

* missing source or permission errors MUST emit `be error ya`
* directory sources MUST emit `be error ya`

#### 2.3.5 Recursive copy (reserved)

`as wo recursive` copies directories and nested files recursively (e.g. `rsync -av`).
Implementations MUST merge into `<dest>` when it exists and overwrite existing files.

---

### 2.4 `directory` — create directory

#### 2.4.1 Input form

`be directory ob filename "<path>" do`

#### 2.4.2 Behavior

* Creates a directory at `<path>`.
* Intermediate directories MUST be created if missing.
* If the directory already exists, it MUST remain unchanged.

#### 2.4.3 Output form

`ob filename "<path>" be directory ya`

#### 2.4.4 Errors

* non-directory targets at `<path>` MUST emit `be error ya`
* permission errors MUST emit `be error ya`

---

### 2.5 `touch` — create or update file

#### 2.5.1 Input form

`be touch ob filename "<path>" do`

#### 2.5.2 Behavior

* If the file does not exist, create an empty file.
* If the file exists, update its modified time.
* Intermediate directories MUST be created if missing.

#### 2.5.3 Output form

`ob filename "<path>" be touch ya`

#### 2.5.4 Errors

* permission errors MUST emit `be error ya`

---

### 2.6 `delete` — remove file or directory

#### 2.6.1 Input form

`be delete ob filename "<path>" do`

`be delete ob filename "<path>" as wo file do`  
`be delete ob filename "<path>" as wo directory do`  
`be delete ob filename "<path>" as wo recursive do`

#### 2.6.2 Behavior

* Deletes a file at `<path>`.
* Deletes an empty directory at `<path>`.
* `as wo file` requires `<path>` to be a file.
* `as wo directory` requires `<path>` to be a directory.
* For non-empty directories, `as wo recursive` MUST be provided.

#### 2.6.3 Output form

`ob filename "<path>" be delete ya`

#### 2.6.4 Errors

* missing file or permission errors MUST emit `be error ya`
* non-empty directory targets MUST emit `be error ya` unless `as wo recursive` is provided
* `as wo file` on a directory MUST emit `be error ya`
* `as wo directory` on a file MUST emit `be error ya`

---

### 2.7 `search` — search text in files

#### 2.7.1 Input form

`be search ob text "<pattern>" in filename "<path>" do`

#### 2.7.2 Behavior

* Searches case-insensitively (equivalent to `rg -i`).
* `<path>` may be a file or directory.
* When `<path>` is a directory, the search is recursive.
* Each match MUST emit a line as `<file>:<line>:<text>`.
* Results MUST be sorted for deterministic output.

#### 2.7.3 Output form

`ob text "<matches>" be search ya`

#### 2.7.4 Errors

* missing pattern or target MUST emit `be error ya`
* unreadable files or permission errors MUST emit `be error ya`

---

### 2.8 `exists` — check path existence

#### 2.8.1 Input form

`be exists ob filename "<path>" do`

#### 2.8.2 Behavior

* Returns `true` if `<path>` exists, otherwise `false`.
* Does not require the path to be a file vs directory.

#### 2.8.3 Output form

`ob bool <true|false> be exists ya`

#### 2.8.4 Errors

* permission errors MUST emit `be error ya`

---

### 2.9 `rename` — move or rename path

#### 2.9.1 Input form

`be rename ob filename "<src>" to filename "<dest>" do`

#### 2.9.2 Behavior

* Renames or moves `<src>` to `<dest>`.
* Intermediate directories for `<dest>` MUST be created if missing.
* `<dest>` MUST be overwritten if it already exists.

#### 2.9.3 Output form

`ob filename "<dest>" be rename ya`

#### 2.9.4 Errors

* missing source or permission errors MUST emit `be error ya`

---

### 2.10 `here` — current directory

#### 2.10.1 Input form

`be here do`

#### 2.10.2 Behavior

* Returns the current working directory for the run.

#### 2.10.3 Output form

`ob filename "<cwd>" be here ya`

---

### 2.11 `glance` — file metadata

#### 2.11.1 Input form

`be glance ob filename "<path>" do`

#### 2.11.2 Behavior

* Returns file metadata for `<path>`.
* MUST include: `magnitude` (bytes), `improve time` (ISO 8601), `sort` (`file` or `directory`).
* MUST include `ob filename "<path>"` in the map definition header, matching the input path from the evoking sentence.
* MAY include: `license time`, `license`, `owner`, `flock`, `descriptive` (from `file`) if available.
* `owner` and `flock` SHOULD be human-readable names when available; otherwise numeric IDs.
* Permissions MAY be expressed as a vector of words using `license`:
  `owner read write command flock read hollow hollow all read hollow hollow`
  (example for `rw-r--r--`).
* The permission word for executable bit is `command`.

#### 2.11.3 Output form

`ob name "<metadata>" be glance ya`

Where `<metadata>` is a `be map def` sentence. Implementations SHOULD name the
map as `glance <hash>`, where `<hash>` is the first 8 hex characters of the
SHA-256 of the resolved absolute path.

#### 2.11.4 Errors

* missing path or permission errors MUST emit `be error ya`

---

### 2.12 `license` — ownership and permissions

#### 2.12.1 Input forms

Ownership:

`be license ob filename "<path>" to name "<owner>" among name "<group>" do`

Permissions (numeric):

`be license ob filename "<path>" as num 755 do`

Permissions (symbolic text):

`be license ob filename "<path>" as text "g+w" do`

Permissions (vector):

`be license ob filename "<path>" as ve owner read write command flock read hollow hollow all read hollow hollow do`

Scoped vector:

`be license ob filename "<path>" as ve read write command for name owner do`

#### 2.12.2 Behavior

* Ownership form updates both owner and group.
* Numeric and vector forms update permissions.
* Symbolic text form MUST forward to `chmod`-style semantics.
* Vector form with `owner/flock/all` markers applies each group.
* Scoped vector applies only to the specified group.

#### 2.12.3 Output form

`ob filename "<path>" be license ya`

#### 2.12.4 Errors

* missing target or permission errors MUST emit `be error ya`
* unknown owner/group names MUST emit `be error ya`

---

### 2.13 `ecology` — environment variables

#### 2.13.1 Input forms

Read single value:

`su name "<key>" be ecology que`

Set single value:

`su name "<key>" be ecology ob text "<value>" do`

Set numeric or boolean values:

`su name "<key>" be ecology ob num 12 do`  
`su name "<key>" be ecology ob bool truth do`

Read full environment:

`be ecology do`

#### 2.13.2 Behavior

* `su name "<key>" be ecology que` returns a `be ecology ya` sentence for the current value.
* Setting forms update the environment variable before returning.
* `be ecology do` returns a map def of all environment variables.

#### 2.13.3 Output forms

Single value:

`su name "<key>" ob text "<value>" be ecology ya`

Missing values:

`su name "<key>" ob hollow be ecology ya`

Full environment:

`ob name "ecology env" be ecology ya`  
with `su name ecology env be map def` describing all key/value pairs.

#### 2.13.4 Errors

* missing key or value MUST emit `be error ya`

---

### 2.14 Reserved stubs (planned)

Non-normative conveniences that may land later. These are listed to keep
sentence shapes stable when implemented.

* `be list ... with name absolute` — return absolute paths instead of relative.
* `be list ... as wo time` / `as wo size` — sort by modified time or size.
* `be list ... with name inode` — include inode IDs (platform-dependent).
* `be search ... with name case` — case-sensitive search.
* `be search ... with name whole` — whole-word matches only.
* `be search ... with name regex` — treat pattern as regex without implicit escaping.
* `be delete ... as wo force` — ignore missing paths, delete read-only when possible.
* `be glance ... with name hash` — include `sha256` of file contents.
* `be go ... with name push` / `be go ... with name pop` — directory stack behavior.
* `be interpret ob text "<script>" do` — execute sandboxed code (language-dependent runner).

### 2.15 Sysadmin nice-to-haves (tentative)

These are not specified yet; names and cases may evolve.

* `be link ob filename "<src>" to filename "<dest>" do` — create a symlink.
* `be link ob filename "<src>" to filename "<dest>" as wo hard do` — create a hard link.
* `be process be list do` — list running processes.
* `be process ob num <pid> be kill do` — terminate a process by PID.
* `be service ob name "<svc>" be status do` — get service status.
* `be service ob name "<svc>" be restart do` — restart a service.
* `be mount ob filename "<device>" to filename "<mount>" do` — mount a device.
* `be disk be list do` — list disks/partitions.
* `be network be list do` — list network interfaces.
* `be user be list do` — list local users.
* `be group be list do` — list local groups.


---

# Date and time (draft v0.1)

This document defines date/time literals, duration units, and basic date math.

## 1. Date literals

Pyash uses the `date` type for time values.

- `ob date <ISO 8601>` is the canonical form.
- Date-only strings are allowed (for example `2025-01-20`).

Dynamic constants:
- `ob date today` resolves to the current day in the runtime time zone.
- `ob date now` resolves to the current timestamp in the runtime time zone.

Example:
```
ob date today be record ya
ob date now be record ya
```

## 2. Duration unit types

Durations are expressed using unit type tokens with numeric payloads.

Supported unit types:
- `second`
- `minute`
- `hour`
- `day`
- `week`
- `month`

Plural unit words (`seconds`, `minutes`, `hours`, `days`, `weeks`, `months`) are aliases.

Examples:
```
ob day 3 be record ya
ob hours 4 be record ya
ob month 1 be record ya
```

## 3. Date math with `add` / `subtract`

Adding a duration to a date produces a date.

Examples:
```
be add ob day 3 to date today do
be add ob hour 4 to date now do
be add ob weeks 3 to date today do
be add ob month 1 to date today do
```

Subtracting a duration from a date produces a date:
```
be subtract ob day 7 from date today do
be subtract ob month 1 from date today do
```

### 3.1 Result shape

- The result is a `date` literal in ISO 8601 form.
- Runtimes MUST apply the runtime time zone when resolving `today` and `now`.

## 4. Error behavior

- Unknown unit types MUST emit `be error ya`.
- Non-numeric unit payloads MUST emit `be error ya`.


---

# Interpret script (draft v0.2)

This document defines the `interpret` verb for running embedded scripts in a **sandboxed interpreter**.

## 1. Sentence shape

```
be interpret ob text quoted.javascript.<code>.javascript.quoted as wo javascript be do
```

Notes:

* `ob text` is required and MUST be a quoted block.
* `as wo javascript` is required in v0.2.
* The quoted block contains **raw JavaScript source text**, not JSON and not an expression fragment.

## 2. Behavior (interpreter)

### 2.1 Execution model

* The runtime executes the provided JavaScript source as a **script**, not as an expression.
* Execution occurs inside a **WebAssembly (WASM) sandbox** using:

  * a WASI-compatible JavaScript engine (QuickJS)
  * a WASM runtime (for example Wasmtime)

The interpreter host:

* writes the quoted JavaScript source into a temporary script file
* executes that file inside the WASM sandbox
* captures standard output and standard error

### 2.2 Filesystem sandbox

* The script is executed with **capability-based filesystem access**.
* By default, the sandbox is granted access to **one temporary directory only**.
* The script MAY read and write files inside that directory.
* The script MUST NOT have access to:

  * the host filesystem outside the sandbox directory
  * user home directories
  * configuration directories
  * secrets or credentials

This directory preopen model corresponds to WASI `--dir=<path>` semantics.

### 2.3 Time and resource limits

* Implementations SHOULD enforce:

  * a wall-clock execution limit (for example 0.5 s)
  * an upper bound on captured output size
* Termination due to limits MUST be reported as an error (see §4).

### 2.4 Input

* In v0.2, the JavaScript source is provided **only** via the quoted block.
* Standard input piping is not required and not assumed.
* Any required input files MUST be placed in the sandbox directory by the host prior to execution.

## 3. Output

* Standard output produced by the script is captured verbatim.
* No trimming, normalisation, or newline removal is required.

On success, the interpreter returns:

```
su name result ob text "<stdout>" be interpret ya
```

Notes:

* `<stdout>` MAY be empty.
* Output is treated as opaque text.

## 4. Errors

Any failure MUST return a deterministic error sentence:

```
su name interpret defective ob text "<reason>" from name interpret be error ya
```

Failures include, but are not limited to:

* JavaScript parse or runtime errors
* sandbox violations (for example filesystem access outside the allowed directory)
* execution timeout
* output size limit exceeded
* interpreter or WASM runtime failure

The `<reason>` string SHOULD be stable and human-readable.

## 5. Safety

* `interpret` executes **sandboxed code**, not arbitrary host code.
* The sandbox:

  * provides filesystem isolation via directory capabilities
  * provides execution isolation via WASM
  * provides no network access unless explicitly enabled by policy
* Runtimes MAY disable the verb entirely by policy.
* Runtimes MAY further restrict available capabilities (read-only directories, smaller limits).

## 6. Vendoring and reproducibility

Implementations SHOULD support vendoring:

* the WASM JavaScript runner (for example `qjs.wasm`)
* the WASM runtime binary (for example `wasmtime`)

To ensure reproducibility, runtimes SHOULD record:

* runner identity (hash of `qjs.wasm`)
* runtime version
* enforced limits

## 7. Future extensions (non-normative)

* Additional language runners via `as wo <language>` (for example `python`, `lua`).
* Reserved `as wo` values (for example `lua`, `python.micro`) MUST return a deterministic error until implemented.
* Structured input via `from text` or `from name`.
* Structured output via official JSON objects.
* Multiple preopened directories with explicit naming.
* Deterministic PRNG seeding for replay.

---

### Summary of what changed from v0.1

* Removed the claim that `interpret` executes arbitrary host code.
* Defined WASM + QuickJS as the **reference execution model**.
* Formalised the directory-based sandbox.
* Clarified why stdin piping is not required.
* Added vendoring and reproducibility guidance.


---

# Read (text extraction, v0.1)

`be read` can extract plain text from document formats when `fromstate` is explicit.
HTML/PDF extraction is provided by modules that register additional `read` signatures.

Canonical forms:

```
ob name read from filename "../../module/read_html.pya" to name read be import do
from filename "<path>" fromstate wo html to name text <out> be read do
ob name read from filename "../../module/read_pdf.pya" to name read be import do
from filename "<path>" fromstate wo pdf to name text <out> be read do
```

Notes:
* `fromstate` is required for HTML/PDF extraction in v0.1.
* Import `module/read_html.pya` or `module/read_pdf.pya` (exporting `read`) to register these signatures.
* Modules MAY use external helpers (e.g. pandoc, pdftotext) to extract text.
* Failures should surface as standard command errors (e.g. `command defective`) unless a module defines a more specific error.

---

# Download (draft v0.1)

This document defines the `download` verb as a **signature-first** tool for pulling remote content into local files.
It is designed to avoid backend dispatch inside the verb body by encoding transport and intent in cases.

## 1. Canonical verb shape

```
be download fromstate <scheme> from filename <url> [as wo <intent>] [to filename <path>] do
```

- `fromstate` encodes the transport/scheme (`http`, `https`, `magnet`, `ipfs`).
- `from filename` carries the URL (text payload; not a local filename).
- `as wo` encodes the intent (`video`, `audio`, `web`, `file`) and maps to the backend choice.
- `to filename` is the local output path (optional; defaults to current working directory).

## 2. Scheme and intent vocabulary

**Schemes (`fromstate`):**
- `http`
- `https`
- `magnet`
- `ipfs`

**Intents (`as wo`):**
- `video`
- `audio`
- `web`
- `file`

Notes:
- `as wo` is optional when the scheme has a single backend (e.g., `magnet`, `ipfs`).
- `as wo` is required when multiple backends are valid for the scheme (e.g., `http`, `https`).
- `ob wo all` MAY be used to request a multi-item download (playlists/channels/feeds).

## 3. Signature-first dispatch (normative)

Each backend registers its own signature. Examples:

```
be download fromstate magnet from filename filename to filename filename do
be download fromstate ipfs from filename filename to filename filename do
be download fromstate https from filename filename as wo video to filename filename do
be download fromstate https from filename filename as wo web to filename filename do
```

Dispatch MUST be signature-first. Backends MUST NOT switch on URL contents inside the verb body.

## 4. URL normalization (sugar)

Implementations MAY support a sugar form that infers `fromstate` from the URL **before signature derivation**:

```
be download from filename "https://example.com/file.zip" as wo file to filename "out.zip" do
```

Normalization rules (normative):
- `magnet:` → `fromstate magnet`
- `ipfs://` or `ipfs:` → `fromstate ipfs`
- `http://` → `fromstate http`
- `https://` → `fromstate https`

If inference fails, the call MUST error (`download defective: missing fromstate`).

## 5. Output contract

On success, return:

```
su name <result> ob filename "<path>" be download ya
```

On failure, return:

```
su name download defective ob text "<reason>" from name download be error ya
```

## 6. Tooling boundaries

Suggested backend mapping (non-normative):
- `http/https + video|audio` → `yt-dlp`
- `http/https + web|file` → `curl` (or equivalent)
- `magnet` → torrent client
- `ipfs` → ipfs client

Backends live as modules or command helpers. Keep side effects localized.

## 6.1 Optional cases (download-specific)

These cases are interpreted by the download backend and do not change global grammar.

* `ob wo all` — download multiple items when the source is a playlist/channel/feed.
* `during months <n>` — restrict downloads to the last `<n>` months (backend-specific).

If `to filename` is omitted, the backend MUST write into the current working directory,
using its default naming template.

Additional backend arguments MAY be supplied via defaults, e.g.:

```
su name download extra ob ve text "--cookies-from-browser firefox" ya
```

## 7. Example sentences

```
be download fromstate https from filename "https://example.com/file.zip" as wo file to filename "out/file.zip" do
be download fromstate https from filename "https://escribemeetings.com/..." as wo audio to filename "out/audio.mp3" do
be download fromstate magnet from filename "magnet:?xt=urn:btih:..." to filename "out.torrent" do
be download fromstate ipfs from filename "ipfs://bafy..." to filename "out.bin" do
```

Sugar example (pre-dispatch normalization):
```
be download from filename "https://example.com/file.zip" as wo file to filename "out/file.zip" do
```

Playlist/channel example (download all items from last month into CWD):
```
be download ob wo all during months 1 from filename "https://www.youtube.com/@AndriiZ/videos" as wo audio do
```
