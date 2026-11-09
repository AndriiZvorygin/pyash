# Offline coding references

Pyash keeps a small, searchable set of versioned programming references in its
shared Kiwix library. The public archive files live in `/srv/search/archive/`
and are exposed to Pyash at `world/library/archive/`.

## Collections

| ZIM file | Offline contents | Source/version |
|---|---|---|
| `rust-agent-guides-1.99.1.zim` | Rust Book, Reference, Cargo, Clippy, Rust By Example, Embedded Rust, Rustonomicon, rustc/rustdoc and related toolchain guides | Rust toolchain documentation installed for 1.99.1 |
| `assembly-agent-guides-2026-11.zim` | RISC-V unprivileged and privileged ISA manuals, ABI v1.0, profiles overview, NASM, GNU `as` and `ld` manuals | RISC-V ISA v20260120; NASM 3.02; GNU Binutils manuals captured 2026-11-09 |
| `gpu-opencl-reference-2026-11.zim` | OpenCL API, OpenCL C, and OpenCL Environment specifications | OpenCL unified specification v3.1.2, dated 2026-09-17 |

The Rust ZIM is about 29 MB, assembly about 2.6 MB, and OpenCL about 878 KB.
Each archive starts at `index.html`, which describes the contents and source.
The ZIMs are built through Pyash's `from filename ... fromstate wo html
tostate wo zim ... be cluster-compress do` flow.

## Publisher-only references

CUDA and Metal are in the target scope, but their vendor manuals are links in
the GPU archive rather than copied into the public server. NVIDIA's current
terms restrict distribution and public display of its technology unless a
separate product agreement permits it. Apple's developer agreement limits
documentation copies to authorized developers' internal use and restricts
hosting or redistribution. The Metal link list includes Apple's Metal docs,
resources, and shading-language specification. Check the current vendor
terms and feature support when working online.

Intel and AMD x86 architecture manuals are also linked from the assembly
archive rather than mirrored. Intel's document-use terms prohibit posting
documents on a network computer; AMD's site terms restrict public distribution
of copied materials. NASM syntax and GNU assembler/linker manuals are available
offline for syntax, object formats, macros, directives, and linking; use the
vendor manuals for authoritative x86 instruction and platform semantics.

The RISC-V and NASM documents retain their source attribution and license
notices. The OpenCL HTML specifications are unmodified Khronos Registry output
and retain the Registry's conditional copyright license. The OpenCL source
repository distinguishes its CC BY 4.0 specification sources from generated
Registry output. The archive landing pages link to these sources and terms.

## Search and retrieval

Search a collection or the complete library with Pyash:

```pyash
ob text "borrow checker" in filename "world/library/archive/rust-agent-guides-1.99.1.zim" as wo cluster-compress be search do
ob text "linker relaxation" in filename "world/library/archive/assembly-agent-guides-2026-11.zim" as wo cluster-compress be search do
ob text "clCreateBuffer" in filename "world/library/archive/gpu-opencl-reference-2026-11.zim" as wo cluster-compress be search do
```

Use the archive and entry path returned by search to retrieve the matching
article:

```pyash
from filename "world/library/archive/rust-agent-guides-1.99.1.zim" as wo cluster-compress ob text "book/ch04-02-references-and-borrowing.html" be read do
```

Choose the matching Rust edition/toolchain, RISC-V extension/profile/ABI,
assembler version, and GPU device/API feature set from the project before
using a result. Archive landing pages are source indexes; the manuals remain
the technical authority for their stated versions.
