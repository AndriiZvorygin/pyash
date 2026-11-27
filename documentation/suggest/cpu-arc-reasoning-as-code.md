# Reasoning as Code: What CPU-ARC Changes for Pyash

**Status:** proposal awaiting review. Nothing in Pyash changes today. This
document records a paper, checks a viral summary of it against the paper itself,
and states what it would mean for this repository if it were worth pursuing.

## Purpose

A post from [@oliviscusAI](https://x.com/oliviscusAI) claims that NVIDIA
researchers found a way to make an AI solve a problem once and then reuse the
reasoning as CPU code: for similar questions, 16× to 291× cheaper.

The claim points at a real paper — *CPU-ARC: Agentic Reasoning Caching for
on-CPU Reasoning Reuse* (arXiv:2611.09891, Belcak, Heinrich, Muralidharan,
Diao and Molchanov, NVIDIA, 6 November 2026). The interesting question for this
repository is not whether the paper is good. It is whether **Pyash already
builds the machinery this needs, and is missing only the loop that turns one
solved task into a reusable one**.

The short answer stated up front so a reviewer can stop early if it is wrong:

- **The paper is real and the post's numbers are accurate**, including the
  awkward condition the post ends on. It is a faithful summary.
- **The one thing the post leaves out is the build cost**, and that is the
  number that decides whether this concerns us: a cache entry costs 12× to 84×
  one source call to build, and pays for itself only after roughly 13 to 90
  invocations of the *same* problem family.
- **Pyash has the pieces but not the loop.** There is a compiler, a quiz gate,
  a translation layer, a refinery concept and 30 skills. What is missing is the
  path from "an agent solved this once" to "a tested, reusable artifact".
- **Pyash's version of this would be stronger than the paper's.** The paper
  checks a generated Python module against one expected output. This
  repository's rule is that code is kept only if it passes quizzes — so our
  equivalent of a cache entry is a *tested Pyash program*, which is inspectable
  in a way the paper's artifact is not.
- **This is a "look into later" item**, not a plan. The first question is
  whether our own workloads repeat enough for the economics to work at all, and
  that is an observation about our traffic, not a research project.

---

## Part 1 — The evidence

### 1.1 The post

- Post: <https://x.com/oliviscusAI/status/2125423669337829577>
- Author: Oliver (@oliviscusAI), "Helping you understand AI. Software Engineer.",
  23,999 followers, verified
- Posted: 2026-11-25 02:57:45 UTC
- Engagement at capture: 6,019 views, 148 likes, 19 reposts, 14 replies, 140
  bookmarks, 5 quotes
- Media: one image, 1178x1670 — the paper's first page, with its Table 1

Reproduce the capture:

```bash
curl -sSL "https://api.fxtwitter.com/oliviscusAI/status/2125423669337829577"
```

`x.com` itself serves an anti-bot page to plain HTTP clients; the FxTwitter
API returns the same post as JSON with no key.

### 1.2 The downloaded artifact

The post image is kept with the run artifacts, outside version control:

| File | SHA-256 |
| --- | --- |
| `artifacts/oliviscus-nvidia-code-cache-20261125/post-image.jpg` | `9a27ed0e2939d6d945f77ed6f6ca50c0bc5f71837f3bf01bf3a9fbba87fed37f` |

```bash
mkdir -p artifacts/oliviscus-nvidia-code-cache-20261125
curl -sSL -o artifacts/oliviscus-nvidia-code-cache-20261125/post-image.jpg \
  "https://pbs.twimg.com/media/HX8FcVuWcAEZjZi.jpg?name=orig"
sha256sum artifacts/oliviscus-nvidia-code-cache-20261125/post-image.jpg
```

The image is the paper's first page: the NVIDIA title block dated 2026-11-9,
the abstract, Table 1 (a MATH-500 problem beside its rephrasing and its
reparameterization, with the corresponding reasoning traces), and the opening
of the introduction. So the post is a summary of a specific technical report,
not of something else wearing its name.

### 1.3 The paper

- *CPU-ARC: Agentic Reasoning Caching for on-CPU Reasoning Reuse*
- Peter Belcak, Greg Heinrich, Saurav Muralidharan, Shizhe Diao, Pavlo
  Molchanov — NVIDIA
- arXiv:2611.09891v1 [cs.AI], submitted 6 November 2026
- Tech report: 28 pages, 9 figures, 11 tables. Project page: *Project Moonshot:
  Local Frontier Intelligence*.

```bash
curl -sSL "https://arxiv.org/abs/2611.09891" -o cparc-abs.html
curl -sSL "https://arxiv.org/html/2611.09891v1" -o cparc.html
```

### 1.4 What the paper does

The paper's framing is that language models "conflate task-solving with the
execution of the solutions", so a problem that only differs in its numbers or
its wording is solved from scratch every time.

Three roles, and the expensive two are needed only at construction time:

- **The source model** (Claude Opus 4.5) reasons through a problem once. Its
  full reasoning transcript is recorded.
- **The builder model** (also Claude Opus 4.5) reads that transcript and
  compiles it into executable code.
- **The target model** (a fine-tuned Llama 3.2 1B) handles small text tasks at
  invocation time, in three roles: target, extractor and converter.

The unit of reuse is a **semantic function**: a Python callable that takes a
Context object and returns a dictionary mapping natural-language descriptions
to values. Functions address their inputs, outputs and callees by description
rather than by fixed name, and one function can call another through that same
natural-language dispatch.

Construction runs in five phases:

1. **Input-output isolation** — the user input is separated from the expected
   output, which becomes the correctness reference for later testing.
2. **Decomposition** — the transcript is broken into a hierarchy of
   function-sized logical operations, and sub-computations likely to recur
   across equirational variants are marked for extraction.
3. **Parameter recognition** — the builder identifies the class of problem the
   query belongs to, produces a generic input template `q(•1, …, •n)`, and
   extracts the concrete value of each parameter. A parameter must be a basic,
   self-contained value — a number, a name, a formula, a list — never a whole
   problem description.
4. **Planning** — a structural plan for the program: which functions to create,
   their dependency structure, and the bottom-up order to implement them in.
5. **Implementation** — candidates are written, statically analysed, and tested
   against the transcript fragment with a judge, then rewritten on failure.

Construction proceeds per sample: each instance is built in an isolated cache,
and on success it is merged into a master cache that serves queries at
invocation time. The master cache can keep growing without rebuilding existing
entries — the paper contrasts this with fine-tuning, which cannot.

Two further properties matter for this repository. First, **invocation uses
only the small target model and CPU execution**; the source and builder are
needed at construction time only. Second, a **mature cache can be compiled
statically**: each dynamic dispatch is resolved into a direct function call and
each context load into a direct dictionary lookup, producing a self-contained
Python module that needs no embedding engine and no vector store at run time.
The paper notes the compiled form is also faster, because every semantic search
is replaced by constant-time name dispatch.

### 1.5 The post against the paper

| Post says | Paper says | Verdict |
| --- | --- | --- |
| NVIDIA researchers found a way to make AI solve a problem once, then reuse the reasoning as CPU code | CPU-ARC, NVIDIA | accurate |
| For similar questions, it was 16× to 291× cheaper | "16-291x cheaper to invoke than the source model" | accurate |
| Change a few numbers or reword a question, and an LLM usually works through it again | the paper's premise: instances vary in phrasing or in parameters | accurate |
| Agents repeating the same task with new data keep paying for that reasoning | agents "rely on repetitive queries to LLMs featuring the same instructions and plans but different payloads" | accurate |
| This method turns the first solution into reusable Python functions | semantic functions are Python callables | accurate |
| Claude Opus 4.5 converts the reasoning trace into code | both source and builder are Claude Opus 4.5 | accurate |
| with the changing inputs turned into parameters | Phase 3 produces a generic input template and a parameter dictionary | accurate |
| A CPU runs the saved code with new inputs | invocation is CPU execution plus the small target model | accurate |
| A fine-tuned 1B model handles small text tasks | a fine-tuned Llama 3.2 1B serves the target, extractor and converter roles | accurate |
| Questions the cache can't handle go back to the LLM | an LLM fallback for novel queries or for a failed invocation | accurate |
| The cache matched or beat the source model's accuracy on 7 of 8 math and science benchmarks | "matches or exceeds source accuracy on seven of the eight benchmarks" | accurate |
| On AIME '25, it scored 93.3%, compared with 83.3% for the source model | Table 2: AIME '25 source 83.3, cache 93.3 | accurate |
| It also handled at least 90% of rephrased or re-numbered variants | the combined perturbation column is at least 90.8 on all eight benchmarks | accurate, and tight |
| If your agent repeats the same job all day, the useful output might be a function it can keep running | the paper's own placement: endpoints handling "repetitively equi-instructed payloads accumulating usage over hours or weeks" | accurate |
| *(not mentioned)* | building an entry costs 12× to 84× one source call | **omission** |

That last row is the one worth making. Everything the post says is true; what
it leaves out is the side of the ledger the post itself gestures at in its last
line. A summary that ends "if your agent repeats the same job all day" is
honest about the condition, but it never says what "all day" has to be for the
arithmetic to work.

### 1.6 The paper's own numbers

Table 2 of the paper, transcribed. Accuracy and perturbation in percent; costs
in dollars per sample at March 2026 retail API rates.

| Benchmark | Source acc. | Cache acc. | Fidelity | Phrasal | Param. | Combined | Source $ | Builder $ | Cache $ | Build × | Savings × |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MATH-500 | 98.6 | 98.8 | 99.6 | 96.7 | 94.5 | 91.6 | 0.0388 | 1.1818 | 0.0004 | 30.5 | 88.7 |
| AIME '24 | 100.0 | 100.0 | 100.0 | 96.0 | 99.3 | 95.1 | 0.1101 | 1.4198 | 0.0004 | 12.9 | 262.4 |
| AIME '25 | 83.3 | 93.3 | 90.0 | 98.4 | 91.2 | 93.4 | 0.1203 | 1.4517 | 0.0004 | 12.1 | 291.1 |
| AIME '26 | 90.0 | 96.7 | 90.0 | 97.9 | 90.9 | 90.8 | 0.1197 | 1.5477 | 0.0004 | 12.9 | 281.4 |
| GPQA Diamond | 83.8 | 83.8 | 98.5 | 93.8 | 93.9 | 94.0 | 0.0708 | 1.7781 | 0.0019 | 25.1 | 38.1 |
| GSM8K | 98.5 | 98.0 | 99.5 | 96.2 | 94.2 | 92.5 | 0.0101 | 0.8481 | 0.0006 | 83.7 | 16.3 |
| MMLU-Pro | 88.0 | 89.0 | 100.0 | 95.7 | 96.7 | 91.9 | 0.0345 | 1.4084 | 0.0015 | 40.8 | 22.9 |
| SciBench | 85.2 | 88.2 | 99.4 | 97.5 | 98.8 | 96.4 | 0.0434 | 1.2572 | 0.0005 | 29.0 | 83.0 |

`Build ×` is builder cost over source cost; `Savings ×` is source cost over
cache cost. Note the shape of the table: the savings are large *because* the
source is expensive, so the biggest multipliers sit on the hardest competition
mathematics where a source call costs $0.12, and the smallest multiplier
(16×) sits on GSM8K where a source call costs $0.01.

The paper's own break-even formula: with `B` the one-time builder cost, `S`
the source cost per query and `C` the cache cost per invocation, the
break-even is `B / (S − C)` invocations, and the build multiplier `B / S`
approximates it when `C` is negligible. The paper reports that ARCs for AIME
problems pay for themselves after approximately 13 invocations, while GSM8K
requires approximately 90.

### 1.7 What the numbers do not say

1. **The build is not free, and it is per problem family.** 12× to 84× one
   source call, paid once per family, and a family is defined by the class of
   problem the builder recognises. A genuinely new kind of task needs a new
   build.
2. **The evaluation is mathematics and science only.** Eight benchmarks:
   MATH-500, AIME '24/'25/'26, GPQA Diamond, GSM8K, MMLU-Pro and SciBench.
   Nothing here shows the method working on open-ended or creative work, and
   the paper says so: the method suits "domains that do not require a great
   deal of creativity and are instead focused on the execution of particular
   instructions".
3. **The paper does not address generalizing similar functions.** Its own
   words: "the problem of generalizing multiple similar but not identical
   semantic functions into one coherent, more general semantic function is not
   addressed by this work". That is the step from one cached instance to a
   general capability, and it is missing.
4. **The accuracy gain is a determinism effect, and it is not free of
   selection.** The paper attributes the cache beating the source to cases
   where the source's reasoning was sound but its final steps slipped, and the
   cache executes the same reasoning deterministically. The one benchmark
   where the cache loses is GSM8K, by 0.5 points.
5. **It is a technical report, not a reviewed paper.** 28 pages from one
   organisation, arXiv v1.
6. **"Cache" now means several different things.** This repository already
   uses the word for the Ollama prefix cache and for the process-level cache of
   a lazy resource, and the adjacent proposal on latent KV transfer uses it
   again. Three different mechanisms, one word. Any note we write about this
   has to say which one it means.

---

## Part 2 — Why this could matter to Pyash

### 2.1 The mapping

| CPU-ARC | The nearest thing in this repository | What we have today |
| --- | --- | --- |
| A semantic function: a callable that addresses its inputs and callees by description, with the varying parts as parameters | a Pyash sentence, where roles are explicit and the values are separate | the grammar; the *slot* mechanism does not exist |
| The generic input template `q(•1, …, •n)` with a parameter dictionary | a sentence whose roles are filled from a payload | roles exist; parameter templates do not |
| A cache entry compiled to a standalone, readable Python module | a Pyash program compiled to JS, to C, or to a PyAC VLIW pack and a native executable | this exists, and it goes further than the paper's target |
| The builder's static analysis and judge against the expected output | the quiz suite, which is the standing gate on code in this repository | exists, and is stronger |
| The master cache that grows without rebuilding existing entries | a library of programs and skills that new work can draw on | 30 skills and an `examples/` tree, but no admission path |
| Invocation falling back to the LLM on a miss | the repository's default posture everywhere | exists |
| The small target model for extraction and dispatch | the local fleet behind the Housekeeper | `qwen3.5:9b` and friends, which are our small models |

### 2.2 The gap is the loop, not the machinery

Pyash can already compile a program, gate it with quizzes, translate between
Pyash and English, and run a staged refinement. What it cannot do is take a
transcript of an agent solving a task and turn it into an artifact that later
runs reuse.

The paper's Phase 3 is the interesting part for this repository, because it is
the part that is language-shaped rather than code-shaped: the builder produces a
*template* for the class of problem, plus the concrete values for one instance,
and every later instance fills the same template. That is the same move Pyash
makes when a sentence names a role and the value varies underneath it — except
that in Pyash the template is a sentence in a fixed grammar, which is exactly
what makes it checkable, and what the paper has no equivalent of.

### 2.3 The determinism prize

The reason the cache beats the source model is worth more to this repository
than the cost saving. The paper's explanation: the source reasons correctly,
but makes a small computational or logical slip in the final steps, while the
cache executes the same reasoning as deterministic code and does not slip.

That is this repository's thesis, arrived at from a different direction.
`documentation/pyash.md` ambition 7 is that "only code that passes quizzes is
kept, so behaviour is preserved while the internals evolve", and ambition 9 is
that any program should behave the same interpreted or compiled. A cache entry
in the paper's design is a generated module checked against one expected
output. The equivalent here would be a generated Pyash program checked against
a quiz — and a quiz is a standing contract that the artifact keeps honouring
after the generating model is gone.

So the Pyash version of a semantic function is not "a piece of Python with a
judge's approval". It is "a piece of Pyash that passes quizzes, is therefore
in the library, and is therefore reusable by the next agent that needs the
same thing". That is a stronger artefact than the paper's, and it is the
version worth wanting.

### 2.4 The economics, in our terms

Break-even is roughly the build multiple, counted in invocations of the same
family: 13 for AIME, about 90 for GSM8K. So the question for this repository is
not "does the method work" but "do we have families that repeat".

Some of our work does repeat:

- The criterion lane runs the **same prompt set** across several models, with
  repeated warm runs against the same five prompts, and FLORES runs over the
  same sample set. That is the shape the paper is aimed at.
- The refineries apply the **same transformation** to many inputs, by
  construction — one stage per ingest step, with explicit stage outputs.
- House work repeats a fixed procedure against a changing world.

Some of it does not: a one-off agent turn that reasons through a novel problem
will never amortize a build, and should not try.

There is also a difference of kind in the economics. The paper's savings are
*dollars*, because the source model is a paid API call at $5 per million input
tokens. Our "source" role is often a local model on a GPU we already paid for,
so the saving is GPU-seconds and queue latency rather than money. That makes
the ratios less impressive and the scheduling effect more important — which
points at the same place the adjacent latent-transfer proposal points: measure
our own traffic before building anything.

### 2.5 What would have to exist first

- **A parameter template in the grammar.** Something that says "this sentence
  holds for a class of tasks, and these roles are the values that vary". The
  grammar has roles and values; it has no template.
- **A way to express a semantic function as a sentence.** The paper's
  functions call each other by natural-language description. Pyash's role words
  are a fixed vocabulary, which is the point, but a fixed vocabulary cannot
  carry an arbitrary intent description.
- **An admission path from a transcript to the quiz suite.** Something that
  takes a solved run, proposes the program, and submits it to the same gate
  every other change goes through — rather than a parallel, weaker one.
- **A cache discipline.** Which entries exist, when they are invalidated, who
  may read them, and what happens on a miss. This is the same interface the
  adjacent proposal needs for KV caches, and the same interface the knowledge
  core needs for claims.

### 2.6 What this is not

It is not a suggestion that agents should stop reasoning. It is not a
suggestion that we train anything. It is not a suggestion that Pyash grows a
second, opaque layer beside the quiz suite. And it is not the same proposal as
the latent KV transfer one: that one is about passing *state* between models,
this one is about turning a *solution* into a program.

---

## Part 3 — Shape of a proposed change

If a reviewer accepts this as a direction, the work would land in pieces, and
only after the questions in the review section are answered:

- **A facts note** under `documentation/reference/` recording the paper, the
  verified claims, the build cost and the corrections, so nobody re-reads the
  post and believes the saving is unconditional.
- **A decision entry** in `documentation/decisions.md` only if we commit to
  running the observation below.
- **A roadmap package** in `program/runtime/work/roadmap.mjs`, with the same
  fields the existing packages carry — scope, non-goals, acceptance criterion,
  dependencies — and its measurements in `documentation/workbook/`.

The observation worth running, if any, is about our own traffic and needs no
new machinery: pick one recurring family in our work — the criterion prompt
set, or a refinery stage — and count how many times it runs, what each run
costs today, and whether the same reasoning would be reached again. If the
count is low, the paper does not concern us and this note stays a note.

### Exclusions

This proposal does not propose, and a reviewer should not read it as proposing:

- any change to the agent protocol, the newspaper format, or channel payloads;
- training a model, fine-tuning a model, or adopting the paper's code;
- a new grammar feature, or any change to the canonical sentence vocabulary;
- any claim that this is cheap in general — it is cheap only for families that
  repeat enough to amortize the build, and the paper's own numbers say how many
  that is;
- a benchmark suite, or a claim that our runtime "reuses reasoning";
- bringing cross-family or open-ended work into scope.

---

## Review questions

1. **Which of our workloads actually repeat?** The economics need roughly 13 to
   90 invocations of the same family to pay for the build. Name the families in
   this repository's own traffic that clear that bar, with counts, and name the
   ones that do not.
2. **What is the build cost on our hardware?** The paper's build multiple is
   measured against a paid API call. Ours would be GPU-seconds on a machine we
   already own, and against a small local model rather than Opus 4.5. Does the
   ratio survive that substitution, and what would the builder actually be?
3. **Should a cache entry be a Pyash program or a Python module?** Our rule is
   that code is kept only if it passes quizzes. If a cache entry is a Pyash
   program, it is gated like everything else and is inspectable by anyone who
   can read a sentence. If it is Python, it is not, and we would have invented a
   second, weaker standard for code we wrote ourselves.
4. **How would a parameter template be expressed?** The paper's template
   `q(•1, …, •n)` and its parameter dictionary have no counterpart in the
   grammar. Is that a small extension to the sentence vocabulary, or is it a
   different kind of object that belongs somewhere else entirely?
5. **What does this cost the reader?** A cache entry is only worth having if
   the agent that reads it can tell what it does, where it came from and when it
   was last checked. What is the inspection story — the same one the knowledge
   core has to answer for claims?
6. **Where should this land if it lands?** A reference note, a decision, or a
   roadmap package — and what is the acceptance criterion that would tell us
   the observation is done?
