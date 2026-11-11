---
name: offline-code-references
description: Look up versioned programming-language, ISA, and GPU API references in Pyash's offline ZIM archive while coding. Use when exact APIs, instruction semantics, or toolchain behavior need authoritative confirmation.
---

# Offline code references

Use the shared Pyash archive for targeted reference lookups; do not load whole manuals into the working context.

1. Identify the project's target version and platform from its manifests, toolchain files, build scripts, and CI configuration.
2. Search the shared archive with a distinctive API name, instruction, compiler diagnostic, or section heading:

   ```pyash
   ob text "Rust borrow checker" in filename "world/library/archive" as wo cluster-compress be search do
   ```

3. Open the matching article with `read as cluster-compress`, using its archive path and entry path from the search result. For a large manual page, call `read archive focus` and add `by text` with the API name or phrase being investigated; the focused read returns bounded excerpts with nearby headings:

   ```pyash
   from filename "world/library/archive/gpu-opencl-reference-2026-11.zim" as wo cluster-compress ob text "OpenCL_API.html" by text "clCreateBuffer" be read do
   ```

   Use the full article read when its complete contents are useful. Current collections are `rust-agent-guides-1.99.1.zim`, `assembly-agent-guides-2026-11.zim`, and `gpu-opencl-reference-2026-11.zim` under `world/library/archive/`.
4. Prefer documentation matching the project's version. Treat proposals, nightly-only features, and optional device features as unavailable unless the project target confirms them. Check nearby sections and cited source/version before applying a rule.
5. For assembly, distinguish assembler syntax from processor semantics. NASM and GNU assembler/linker manuals are offline; Intel and AMD architecture manuals are publisher links only. For GPU APIs, verify the device family, API version, and language feature support. OpenCL specifications are offline; CUDA and Metal documentation are publisher links only in the public archive.
6. If the archive lacks the needed reference, inspect documentation already installed with the project's toolchain. Report the missing reference rather than guessing version-specific behavior.

Each archive's landing page records its source, version, and license notes. The inventory and retrieval examples are in `documentation/reference/offline-code-references.md`.
