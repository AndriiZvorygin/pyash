# What Should the Pyash VLIW Backend Compile To?

**Status:** proposal awaiting review. It describes a destination for the VLIW
codelet format, shows one semantic compiled all the way to a RISC-V image, and
asks what the backend contract should say before a second destination is added.
It changes no behaviour beyond the one prototype described here, and it
schedules no work.

## Purpose

The question that started this document: *we have a codelet format that two
implementations already read and write. What does "compile" mean for it, and
what is the first thing it should compile to?*

The short answer, stated up front so a reviewer can stop early if it is wrong:

- **The codelet format is the interface, and a destination is a compiler from
  codelets to machine code.** The format does not change: "compile" means
  emitting machine code that computes what the codelet means.
- **The first destination is RISC-V.** It has a small, fully specified
  instruction set, the toolchain already carries a bare-metal target for it,
  and the image it produces can be read by any disassembler without this
  repository shipping an emulator.
- **One semantic is proven end to end.** `ob num 1 to num 1 be plus do` lowers
  to the legacy golden codelet, the Rust backend compiles that codelet into
  machine code, the image holds the machine code, and the compiled program's
  result is the interpreter's result.
- **Three things are not proven, and this document says so plainly.** The image
  is not executed here, because the repository has no RISC-V emulator
  dependency. Only the numeric arithmetic family and the invert codelet
  compile; the literal families do not. And the emitted programs are
  branchless by construction, which is a limit of the emitter, not of the
  format.

---

## Part 1 — What the milestone proves

### 1.1 The chain

The chain is four steps, and each one has a check:

```text
ob num 1 to num 1 be plus do        the sentence
  -> 0149 881D 0001 287E 881D 0001 245E 8A64 295E   the codelet
  -> 13 machine instructions         the compiled program
  -> an ELF64 RISC-V executable      the image
  -> 2                              the result the interpreter also gives
```

The codelet is the legacy golden, the same bytes the rest of the repository
already treats as the fixture for the numeric semantics. Nothing new was
invented to make the chain work.

### 1.2 The compiled program

The backend turns the codelet's quoted operands into immediates, the operator
word into the instruction that computes the result, and the result out through
the first argument register:

```text
0000000080000000 <pyac_body>:
  addi t0, zero, 1      # the ob operand
  addi t1, zero, 1      # the to operand
  add  t2, t0, t1       # the sum
  lui  t4, 0x10
  addi t4, t4, -1       # the saturation limit
  sltu t5, t4, t2       # did the sum cross it
  sub  t5, zero, t5
  xori t6, t5, -1
  and  t2, t2, t6
  and  t4, t4, t5
  or   t2, t2, t4       # the saturated sum
  addi a0, t2, 0        # the result
  ret
```

The saturation is not decoration. The JavaScript reference backend clamps
addition, subtraction, and exponentiation to `0xffff`, so a destination that
did not clamp would disagree with the interpreter on the values that matter.

### 1.3 The image

The image is an ordinary ELF64 RISC-V executable, 4,896 bytes, with the entry
point at `0x80000034` and the compiled program at `0x80000000`:

```text
Class:    ELF64
Type:     EXEC (Executable file)
Machine:  RISC-V
Entry:    0x80000034
```

There is no operating system under it, so the entry point runs the program and
stops. The program uses no stack and no branches, so the image needs no memory
beyond the load address.

### 1.4 The three checks

The claim "the compiled program computes the interpreter's result" rests on
three independent checks, which matter because they fail differently:

1. **The interpreter's side.** `quiz/vliw_riscv.test.mjs` lowers the sentence
   to the golden bytes and runs it through the interpreter, which answers `2`.
2. **The compiler's side.** `rust/pyac/tests/riscv_backend.rs` compiles the
   same golden bytes, runs the compiled program through the backend's own
   executor, and answers `2`. The same test also compares the compiled result
   with `execute_numeric_arithmetic_codelet`, so the two implementations are
   compared directly rather than against a shared constant.
3. **The encodings' side.** `rust/pyac/src/backend/riscv.rs` pins every
   instruction of the golden program to the encoding the instruction set's own
   field layout gives it. Those constants are computed from the specification,
   not from the encoder that produces the words, so a systematic encoder error
   cannot hide behind a self-consistent decoder.

### 1.5 What the checks do not cover

The image is never executed. The backend's executor models the instruction
subset the emitter produces, and it is that executor, not the image, that
produces the `2` in check two. The image and the executor agree because both
are produced from the same instruction stream, but nothing has yet run the
image itself.

---

## Part 2 — The shape of the backend contract

### 2.1 The destination reuses the semantic decoding

The backend does not decode codelets itself. It calls the same
`decode_numeric_arithmetic` the interpreter-side decoder uses and turns the
decoded `(operator, ob, to)` into instructions. That is deliberate: a
destination that re-derived the semantics would be a second implementation of
them, and the two would drift. The numeric semantics stay in one place, and a
destination only decides how to compute them.

### 2.2 The saturation rule

The interpreter's numeric results are 16-bit values with three different
behaviours, and a destination has to reproduce all three:

| Operation | Interpreter | Machine code |
|---|---|---|
| addition | clamped to `0xffff` | saturating add |
| subtraction | clamped to `0` | saturating subtract |
| multiplication | full product | plain multiply |
| exponentiation | clamped to `0xffff` | saturating power |
| division, remainder | full quotient | `divu`, `remu` |

Multiplication is the odd one out: the interpreter does not clamp it, so
`65535 * 65535` is `4294836225` in both implementations.

### 2.3 The branchless rule

The emitted programs contain no branches. That is a limit of the emitter, and
it was chosen for a specific reason: a branchless program needs no label
resolution, so the emitted words are the whole program, and the executor can
check them without a control-flow model.

The cost is visible in the exponentiation, which needs sixteen rounds of
binary exponentiation rather than a loop, and in the saturation, which is
branchless arithmetic rather than a conditional jump. Both are unrolled at
compile time, which makes the programs longer and the compiler more involved
than a loop would.

### 2.4 Where the code lives

- `rust/pyac/src/backend/riscv.rs` — the compiler, the executor, the
  instruction encoders, and the golden encoding table.
- `rust/pyac-riscv/` — the bare-metal image: a build step that compiles the
  golden codelet, a linker script, and an entry point that runs the program and
  stops.

The image crate depends on the compiler as a build dependency only, so the
image carries machine code and no runtime dependency at all.

---

## Part 3 — What is deliberately not done

- **The image is not executed.** Nothing in the repository runs RISC-V code.
  The proof that the compiled program is right comes from the executor, and a
  reviewer who wants the image itself exercised needs an emulator.
- **Only the numeric arithmetic family and invert compile.** The literal
  families — numbers, texts, booleans, dates, and vectors — have no machine
  code yet, and the backend refuses them with a stable error rather than
  approximating them.
- **The pack format is not the image format.** A pack is a container of
  codelets for the catalog; an image is an executable. Nothing yet turns a
  pack into an image, and the two should not be confused.
- **There is no loader, no runtime, and no ABI for calling compiled code from
  the interpreter.** The prototype computes one result in a register and stops.

---

## Part 4 — What would pay

1. **A second destination.** The compiler is a function from a decoded
   semantic to an instruction stream. Another instruction set is another
   encoder set, and the executor and the image shape stay. The cost is in the
   encoders and in whatever the new machine's calling convention demands.
2. **The literal families.** A number, a text, a boolean, a date, and a vector
   all have a machine-code form; the literal layouts already say what the
   values are.
3. **A branch-capable emitter.** Labels and relative offsets would let the
   exponentiation be a loop and the general case be written naturally.
4. **Running the image.** Once an emulator is a dependency, the executor's
   role shrinks to a development aid and the image becomes the thing that is
   tested.

---

## Review questions

1. **Should the backend live in the Rust crate, or beside it?** It is now a
   module of `rust/pyac`, next to the decoder it reuses. A separate crate
   would separate the destination from the semantics it depends on.
2. **Is the branchless rule the right limit to start with?** It keeps the
   emitter small and the executor simple, and it costs a sixteen-round
   exponentiation. Would a branch-capable emitter be worth building first?
3. **Which literal family should compile next?** The numeric literal is the
   simplest; the date and the vector carry more structure.
4. **Is an emulator a dependency the repository should take?** The image is
   built and readable today, and unexecuted. Adding a RISC-V emulator to the
   development and test path would let the image itself be the thing under
   test.
5. **Should the image be committed, or only built?** It is a build product,
   reproducible from the golden codelet, so it is not committed today. A
   reviewer who wants to look at it has to build it.
6. **Does the pack format need a way to become an image?** A pack holds many
   codelets and an image holds one program. Something has to choose and
   schedule, and nothing does that yet.

---

## Reproducing the prototype

The prototype needs the bare-metal target and a Rust toolchain with the LLVM
tools for reading the image back:

```bash
rustup target add riscv64gc-unknown-none-elf
rustup component add llvm-tools-preview

# the compiler, the executor, and the golden encoding table
cargo test --manifest-path rust/pyac/Cargo.toml

# the image
cargo build --manifest-path rust/pyac-riscv/Cargo.toml --release \
  --target riscv64gc-unknown-none-elf

# the image read back by an independent tool
objdump=$(find ~/.rustup/toolchains -name llvm-objdump | head -1)
"$objdump" -d rust/pyac-riscv/target/riscv64gc-unknown-none-elf/release/pyac-riscv

# the interpreter's side of the same golden
node --test quiz/vliw_riscv.test.mjs
```

The disassembler output is the independent check on the compiler's bytes: it
is a different implementation, reading the image the linker produced.
