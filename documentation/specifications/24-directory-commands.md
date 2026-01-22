# `24-directory-commands.md` (draft v0.1)

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

`as wo recursive` is reserved for future directory copy behavior (e.g. `rsync -av`).
Current implementations MAY treat it as unsupported and return `be error ya`.

---

### 2.4 `touch` — create or update file

#### 2.4.1 Input form

`be touch ob filename "<path>" do`

#### 2.4.2 Behavior

* If the file does not exist, create an empty file.
* If the file exists, update its modified time.
* Intermediate directories MUST be created if missing.

#### 2.4.3 Output form

`ob filename "<path>" be touch ya`

#### 2.4.4 Errors

* permission errors MUST emit `be error ya`

---

### 2.5 `delete` — remove file or directory

#### 2.5.1 Input form

`be delete ob filename "<path>" do`

`be delete ob filename "<path>" as wo file do`  
`be delete ob filename "<path>" as wo directory do`  
`be delete ob filename "<path>" as wo recursive do`

#### 2.5.2 Behavior

* Deletes a file at `<path>`.
* Deletes an empty directory at `<path>`.
* `as wo file` requires `<path>` to be a file.
* `as wo directory` requires `<path>` to be a directory.
* For non-empty directories, `as wo recursive` MUST be provided.

#### 2.5.3 Output form

`ob filename "<path>" be delete ya`

#### 2.5.4 Errors

* missing file or permission errors MUST emit `be error ya`
* non-empty directory targets MUST emit `be error ya` unless `as wo recursive` is provided
* `as wo file` on a directory MUST emit `be error ya`
* `as wo directory` on a file MUST emit `be error ya`
