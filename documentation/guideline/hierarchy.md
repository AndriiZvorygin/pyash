# Pyash hierarchy and speakable paths (v0.1)

This document defines:
- speakable directory names for Pyash repositories
- a speakable gloss for common Linux filesystem roots (FHS-style)
- a spoken “dir … dir …” form for paths


## 1) Repository layout

Official top-level names
- `program/`         Authored code (Pyash language, runtime, compiler, bridge, verbs)
- `module/`          Imported or vendored Pyash modules
- `specification/`   Language and runtime specifications
- `documentation/`   Guides, tutorials, design notes, reference docs
- `quiz/`            Automated tests
- `frozen/`          Fixtures and golden files
- `example/`         Runnable examples and demos
- `tools/`           Developer tooling (generators, linters, converters)
- `command/`         One-off helpers (release, migration, setup tasks)
- `criterion/`       Benchmarks and performance measurements
- `building/`        Intermediate build outputs
- `distribute/`      Release artifacts (final outputs)
- `know/`            Datasets used by quiz, example, criterion
- `caterer/`          Third-party snapshots and pinned dependencies

Optional names
- `library/`         Shared code intended for reuse across programs
- `binary/`          Built executables or entrypoints
- `sandpit/`         Temporary scratch space, safe to wipe
- `configure/`       Project-local configuration


### Mapping from common shorthand

Shorthand -> Pyash name
- `src` -> `program`
- `modules` -> `module`
- `spec` -> `specification`
- `docs` -> `documentation`
- `tests` -> `quiz`
- `fixtures` -> `frozen`
- `examples` -> `example`
- `scripts` -> `command`
- `benchmarks` -> `criterion`
- `build` -> `building`
- `dist` -> `distribute`
- `data` -> `know`
- `vendor` -> `caterer`
- `lib` -> `library`
- `bin` -> `binary`
- `tmp` -> `sandpit`
- `cfg` -> `configure`


### Repository example

pyash/
  program/
  module/
  specification/
  documentation/
  quiz/
  frozen/
  example/
  tools/
  command/
  criterion/
  building/
  distribute/
  know/
  caterer/


## 2) Linux filesystem gloss (speakable FHS sugar)

Real absolute paths remain official. This gloss provides speakable aliases that round-trip.

Gloss roots
- `root`        -> `/`
- `house`       -> `/home`
- `configure`   -> `/etc`
- `hierarchy`   -> `/usr`
- `protean`     -> `/var`
- `runtime`     -> `/run`
- `temporary`   -> `/tmp`
- `custom`      -> `/opt`
- `service`     -> `/srv`
- `begin`       -> `/boot`
- `instrument`  -> `/dev`
- `processing`  -> `/proc`
- `base`        -> `/sys`
- `attaching`   -> `/mnt`
- `separable`   -> `/media`

Common compounds
- `protean/newspaper`  -> `/var/newspaper`
- `protean/hiding`     -> `/var/cache`
- `protean/library`    -> `/var/lib`
- `hierarchy/binary`   -> `/usr/bin`
- `hierarchy/library`  -> `/usr/lib`
- `hierarchy/sharing`  -> `/usr/share`


### Sugar form examples

- `configure/ssh/sshd_config` expands to `/etc/ssh/sshd_config`
- `protean/newspaper/pyash/run-1.pya` expands to `/var/newspaper/pyash/run-1.pya`
- `hierarchy/binary/node` expands to `/usr/bin/node`


### Parsing rules

- A path starting with `/` is official and stays unchanged.
- A gloss path starts with one gloss root segment, then `/`.
- Expansion replaces the first segment using the table above, then joins the remainder.


## 3) Spoken path form (dir … dir …)

For speech, use `dir` as the separator token.

Rules
- `/etc/ssh/sshd_config` spoken: `dir configure dir ssh dir sshd_config`
- `house/andrii/.config/pyash/config.json` spoken: `dir house dir andrii dir dot config dir pyash dir config dot json`

Conventions
- A leading `.` in a segment is spoken as `dot <name>`.
- A `.` inside a filename is spoken as `dot` between parts (`config dot json`).


## 4) Naming rules

- prefer full words, single concept per directory
- prefer singular form for containers (`module/`, `example/`)
- use kebab-case for multiword names where needed
- add a one-line definition here before introducing a new top-level name
