# Latent Agent Communication: What the SwaT Paper Changes for Pyash

**Status:** proposal awaiting review. Nothing in Pyash changes today. This
document records a paper, checks a viral summary of it against the paper, and
states what it would mean for the Pyash agent runtime if it were worth
pursuing.

## Purpose

A post from [@HowToPrompt__](https://x.com/HowToPrompt__) claims that MIT
built "telepathy" for AI: two models from different companies passing KV-cache
state directly to each other, with no text in between, 40% more accurate and 4x
faster than communicating in words.

The claim points at a real paper — *Swarm Telepathy: Prefill-Free KV-Cache
Transfer Across Families* (arXiv:2610.15095, MIT CSAIL with the MIT-IBM
Computing Research Lab, 10 October 2026). The interesting question for this
repository is not whether the paper is good. It is whether **the channel
between our agents is the thing that is limiting us**, and whether the paper
gives us a cheaper way to widen it than writing better summaries.

The short answer stated up front so a reviewer can stop early if it is wrong:

- **The paper is real and the post's numbers are accurate**, with one
  imprecision about prior work that this document corrects.
- **The "common language" is narrower than the marketing.** Two models' KV
  caches share no coordinates and no token boundaries; they share content, an
  approximately affine-comparable geometry, and a position-free subspace.
  Turning that into a channel costs a mapper per model pair.
- **The gap the paper attacks is real in our runtime**: today a Pyash agent
  hands its findings to the next agent as text, and the text is chosen for a
  reader, not for the sender's full state.
- **The method as published does not fit our fleet.** One trained mapper
  (about 300M parameters, under one GPU-day) per sender-receiver pair, on
  models of 3B to 32B. Our agents mostly run one small local family behind the
  GPU Housekeeper.
- **The cheap experiment is not the paper's experiment.** Same-family cache
  hand-off is the interesting part for us, and that is the part the paper
  explicitly did *not* do — it positions same-family transfer as prior work.
- **This is a "look into later" item**, not a plan. The first question for a
  reviewer is whether our hand-off is lossy enough to matter, and the answer to
  that is an observation, not a project.

---

## Part 1 — The evidence

### 1.1 The post

- Post: <https://x.com/HowToPrompt__/status/2125572875386294287>
- Author: How To Prompt (@HowToPrompt__), "Trustworthy AI education", 45,433
  followers
- Posted: 2026-11-25 12:50:39 UTC
- Engagement at capture: 12,141 views, 285 likes, 65 reposts, 23 quotes, 280
  bookmarks, 34 replies
- Media: one image, 1008x1322 — a screenshot of the paper's first page

Reproduce the capture:

```bash
curl -sSL "https://api.fxtwitter.com/HowToPrompt__/status/2125572875386294287"
```

`x.com` itself serves an anti-bot page to plain HTTP clients; the FxTwitter
API returns the same post as JSON with no key.

### 1.2 The downloaded artifact

The post image is kept with the run artifacts, outside version control:

| File | SHA-256 |
| --- | --- |
| `artifacts/how-to-prompt-swarm-telepathy-20261125/post-image.jpg` | `24152e0638db7341930624860dff680a58d7f4a97fcb88d1ed106880021fdb7c` |

```bash
mkdir -p artifacts/how-to-prompt-swarm-telepathy-20261125
curl -sSL -o artifacts/how-to-prompt-swarm-telepathy-20261125/post-image.jpg \
  "https://pbs.twimg.com/media/HX-NPzQbEAATA9H.jpg?name=orig"
sha256sum artifacts/how-to-prompt-swarm-telepathy-20261125/post-image.jpg
```

The image is the paper's title page, abstract, Figure 1 and the opening of the
introduction — so the post is a summary of a specific preprint, not of
something else wearing its name.

### 1.3 The paper

- *Swarm Telepathy: Prefill-Free KV-Cache Transfer Across Families*
- Abdulrahman Alabdulkareem, Irene Tenison, Yang Zhang, Yada Zhu, Boris Katz,
  Dan Gutfreund — MIT CSAIL and the MIT-IBM Computing Research Lab
- arXiv:2610.15095v1 [cs.LG], submitted 10 October 2026
- Project page: <https://github.com/Ar-Kareem/SwaT>

```bash
curl -sSL "https://arxiv.org/abs/2610.15095" -o swat-abs.html
curl -sSL "https://arxiv.org/html/2610.15095v1" -o swat.html
```

### 1.4 What the paper does

A sender model and a receiver model are both **frozen**. A small learned
mapper, SwaT, is trained between them:

- The mapper has `B ∈ {7, 8, 9}` blocks with `D = 1024`, `H = 16`, `F = 4096`,
  giving **about 300M trainable parameters**.
- Block `b` cross-attends to the sender's KV-cache for layer group `S_b` and
  writes the receiver's KV-cache for group `R_b`; receiver RoPE is re-applied
  to the emitted keys.
- It is trained on **44M unique tokens of English text only**, in under six
  GPU-hours (under 50M tokens), with AdamW and bf16.
- The receiver **never prefills the prompt**. It starts from the transferred
  cache and decodes as if it had read the text itself.

Measured results, from the abstract and the paper's own figure captions:

- **17 benchmarks across 12 LLMs and 6 model families** (3B to 32B).
- Retention: a receiver reading SwaT's cache keeps **over 90%** of the score it
  would get from the real text, and **over 100%** when the sender is the larger
  model.
- Against text-to-text summaries at matched budgets, SwaT **combined with
  Attention Matching (AM) KV-cache compaction** gives a mean of **40% higher
  accuracy** and **4x faster wall-clock time**.
- Zero-shot capability transfer despite English-only training: a VLM sender
  gives a text-only receiver vision, and Qwen3 gives Llama 3 its Chinese
  benchmarks.

### 1.5 The post against the paper

| Post says | Paper says | Verdict |
| --- | --- | --- |
| MIT built telepathy for AI | MIT CSAIL with MIT-IBM | accurate |
| paper called "Swarm Telepathy" (SwaT) | arXiv:2610.15095 | accurate |
| deletes text from the equation | prefill-free | accurate |
| extracts raw internal state (KV-cache) | maps the sender's KV-cache into the receiver's cache space | accurate |
| tiny 300M-parameter translator | "approximately 300M trainable parameters" | accurate |
| less than a single GPU-day to train | "under 6 GPU-hours on under 50M tokens" | accurate |
| 17 benchmarks, 12 LLMs, 6 families | "17 benchmarks across 12 LLMs and 6 families" | accurate |
| 40% higher accuracy than text summaries | mean 40% higher accuracy, with AM compaction, against text-to-text | accurate, narrower than it sounds |
| 4x faster wall-clock | mean 4x faster wall-clock, same conditions | accurate, same caveat |
| zero prefill | prefill-free | accurate |
| trained exclusively on English text | trained on English text only | accurate |
| a blind text-only LLM gained sight and beat text descriptions | vision transferred to a text-only receiver, exceeding text-to-text | accurate |
| transferred Chinese zero-shot | Qwen3 passes Chinese tasks to Llama 3 | accurate |
| backs up the Platonic Representation Hypothesis | the hypothesis is cited in the introduction as motivation | accurate as framing |
| "Until today, direct mind-to-mind transfer only worked between clones of the exact same model" | prior work "either require the LLMs to be within the same family or cannot function across context" | **imprecise** |

That last row is the one correction worth making. The bound the paper breaks is
*same family*, not *same weights*: the paper's own words are that models in one
family (Qwen 3 at 4B, 8B, 14B, 32B) share a team, a pipeline and a data mix, so
translating between them is a reasonable task. Later related work also lists
several cross-family translators already in the literature — HeteroFold,
Cache-to-Cache, PrefillShare, Latent Cache Flow, token-level routing and a
universal context-reuse layer (see arXiv:2611.12062) — so "until today" is too
strong. The paper's contribution is prefill-free *and* cross-family together.

### 1.6 What the numbers do not say

The honest reading, because these are the parts that decide whether this
matters to us:

1. **The 40% and 4x are SwaT plus Attention Matching, against text-to-text
   summaries.** It is not "latent transfer beats the original text" and not
   "SwaT alone beats plain text". A text-to-text summary is lossy by
   construction; the comparison says that a lossy channel can be beaten by a
   less lossy one, which is unsurprising and still useful.
2. **The transferred cache is not as good as the real thing.** Retention is
   over 90% of the receiver's own text score, over 100% only when the sender
   happens to be the larger model. The receiver is usually slightly worse off
   than if it had read the text.
3. **One mapper per sender-receiver pair.** Nothing in the paper trains a
   single mapper that spans pairs. That is the cost that makes this a research
   item rather than a feature: a 300M-parameter mapper, under a GPU-day of
   training, for every pair of models that ever needs to talk.
4. **A preprint.** arXiv v1, not peer-reviewed as far as we can tell.
5. **The "telepathy" name is marketing.** The mechanism is a trained
   cross-attention mapper between two KV-cache spaces.

### 1.7 The rest of the literature

SwaT is one paper in a dense field. Part 2.5 leans on the rest, so they are listed
here with their primary sources. Every number quoted in Part 2.5 comes from one of
these, not from a summary of a summary.

| Work | arXiv | What it contributes |
| --- | --- | --- |
| Cross-Model KV Cache Transfer in LLM Families | [2608.03893](https://arxiv.org/abs/2608.03893) | Closed-form per-head ridge mapper for same-family pairs; matched KV head count and head dimension are the precondition |
| Think Before You Speak (CacheFuse) | [2610.16165](https://arxiv.org/abs/2610.16165) | Training-free latent communication when the two models share identical KV geometry |
| Latent Cache Flow | [2605.22863](https://arxiv.org/abs/2605.22863) | Low-dimensional bottleneck for cache transfer; cross-context transfer without token alignment |
| Prefill-Free Cross-Family KV Cache Transfer (HeteroFold) | [2609.32259](https://arxiv.org/abs/2609.32259) | First prefill-free cross-family transfer with explicit cross-tokenizer alignment |
| CacheBridge | [2609.00891](https://arxiv.org/abs/2609.00891) | Serving-system view; within-family transfer supported, cross-family left as future work |
| A Universal Context-Reuse Layer | [2608.30963](https://arxiv.org/abs/2608.30963) | "Context mobility" as a systems abstraction; layer compatibility is selective |
| Mixture-of-Translators (MoT) | [2607.28979](https://arxiv.org/abs/2607.28979) | Token-level routing across several translators |
| Latent Space Communication via K-V Cache Alignment | [2601.06123](https://arxiv.org/abs/2601.06123) | One global shared KV space that any model in a pool can read from and write to |
| Thinking in Different Spaces | [2603.20406](https://arxiv.org/abs/2603.20406) | Affine compatibility across architectures, with the scale-and-bias caveat |
| Ventriloquist LLMs | [2603.18908](https://arxiv.org/abs/2603.18908) | Tokenizer compatibility governs alignment quality; the effect localizes to the last layers |
| Improving Relative Representations with Learned Anchors | [2605.30596](https://arxiv.org/abs/2605.30596) | Anchor-based, affine-invariant shared interface |
| The Platonic Representation Hypothesis | [2405.07987](https://arxiv.org/abs/2405.07987) | The hypothesis itself (Huh et al.) |
| Plato's Key | [blog](https://hazyresearch.stanford.edu/blog/2026-11-25-platos-key) | A rotation and one global scale, fit in closed form, transfer factual representations across 12 base LLMs from 8 families |
| Rotational Dynamics of Factual Constraint Processing | [2603.13259](https://arxiv.org/abs/2603.13259) | Where the rotation-based geometry of factual processing appears, and at what scale |
| Proving and Improving the PRH with JEPAs | [2610.39302](https://arxiv.org/abs/2610.39302) | A theorem for JEPA-trained models, and why next-token prediction reaches alignment inefficiently |
| Making open models work for long-horizon agentic workloads (Ollama) | [blog](https://registry.ollama.com/blog/open-models-long-horizon-agents) | Prefix caching as the thing that saves the work in an agent session, and how the cache is matched and kept alive |
| GPU Housekeeper architecture (this repository) | [reference](../reference/gpu-housekeeper-architecture.md) | The discharge and `keep_alive` policy that decides when our own prefix cache survives |

```bash
for id in 2608.03893 2610.16165 2605.22863 2609.32259 2609.00891 2601.06123 \
          2603.20406 2603.18908 2608.30963 2605.30596 2610.39302 2405.07987; do
  curl -sSL -o /dev/null -w "$id %{http_code}\n" "https://arxiv.org/abs/$id"
done
```

---

## Part 2 — Why this could matter to Pyash

### 2.1 The gap in our runtime

Pyash runs work across agents: a manager and workers, the Housekeeper queue,
channels, the newspaper, refineries. When one agent's findings reach the next
agent today, they travel as text — a summary, a transcript, a `.pya` artifact,
a sentence in a channel.

That is exactly the bottleneck the paper names. The sender holds a KV-cache
that encodes far more than the words it chose for a reader, and the receiver
spends compute re-reading a lossy encoding of it. Our hand-offs pay that cost
on every handoff.

The Pyash-specific version of the question is therefore not "can we do
SwaT". It is: **how much of our agent-to-agent bandwidth is lost in the
writing, and what would it cost to recover it?**

### 2.2 Why the paper's own experiment is not ours

Our agents are local, small, and mostly one family: the Housekeeper serves
`qwen3.5:9b` and other local models. The paper's cross-family mapper is the
expensive part, and the part we do not need: **same-family transfer is the
cheap case**, and the paper treats it as prior work rather than as its
contribution. If anything here is worth doing, the order is:

1. Measure whether our handoff is lossy enough to matter.
2. Only then consider whether a cache path is worth opening.
3. Only then consider training a mapper.

### 2.3 The Platonic Representation Hypothesis

The post leans on the hypothesis that models built by different labs converge
on the same internal map of reality. The paper cites it as motivation for why
cross-family translation could work at all.

For the knowledge-core work this is suggestive and currently unconnected: the
paper is about *translating* between two representation spaces, not about two
models sharing one. A shared, cross-model latent space would be a much larger
claim, and nothing here establishes it. If the knowledge core is to be
represented in a form several models can share, this paper is a reason to keep
looking, not a reason to build.

Part 2.5 takes that question up against the rest of the literature, because there
is more behind the hypothesis than this one paper provides — and because the
evidence points at a different layer of the stack than the viral summary suggests.

### 2.4 What would have to exist first

The GPU Housekeeper does not currently expose KV-caches to the agent runtime;
the inference path hands back text. Opening a cache path would mean:

- capturing and transporting cache tensors per model family, with the VRAM cost
  that implies (the housekeeper has its own VRAM calibration notes),
- keeping the sender's cache alive while the receiver consumes it,
- a policy for cache lifetime, invalidation and multi-consumer fan-out,
- and a fallback when the two models are not a trained pair.

That is a real interface, not a script.

---

## Part 2.5 — The common language: what is actually held in common

The post's framing invites a bigger question than the paper answers: *if two models
can share a KV cache, what exactly do they share?* The honest answer is narrower
than "a shared language of thought", and being precise matters here, because the
precision is what decides whether any of this is useful to us.

In one line: two models' KV caches share no coordinates and no token boundaries.
What they share is the content, an approximately affine-comparable geometry, and a
position-free subspace — and turning that into a usable channel has to be paid for
per model pair.

### 2.5.1 Three different senses of "common language"

| Sense | What it claims | Strongest evidence | What it costs |
| --- | --- | --- | --- |
| Shared geometry | Different models' representation spaces are the same space up to a rotation and scale, so one model's state can stand in for another's | Plato's Key: a rotation plus one global scale, fit in closed form, moves factual representations between 12 base LLMs from 8 families at a median 41% transfer accuracy | Fitted per pair, on facts both models already know |
| Shared reference frame | Models need not share coordinates; they can share anchors, and a state is represented by its similarities to them | Relative representations, and the learned-anchor refinements | Needs an anchor set and a similarity function; applies to embeddings, not to per-layer KV tensors |
| Shared KV space | One learned space that every model in a pool can read from and write to | Latent Space Communication via K-V Cache Alignment: per-model adapters into and out of a single global space | Two adapters per model, trained |

The first two are about *representations*. Only the third is about caches as such,
and it is the one SwaT belongs to.

### 2.5.2 What is held in common

1. **The content, not the coordinates.** Two models given the same context compute
   different tensors. What they agree on is the *content* they encode — the same
   facts, in the same order, at the same positions. Everything else is a change of
   coordinates, and every method in this literature is a way of undoing that change.
2. **An approximately affine-comparable geometry.** Across architectures with no
   shared weights, a single linear map from a teacher's activation space into a
   student's coordinate system explains about half the target variance on TruthfulQA
   and about 40% on GSM8K, over 20 independent model pairs — but the map needs a
   scale and a bias, not a pure rotation, because architectures differ
   systematically as well as in orientation.
3. **A position-free content subspace.** The transferable part of a key is the part
   that does not encode *where* it sits. Strip RoPE before mapping and let the
   receiver apply its own positions afterwards, and a fit stops being tied to one
   context length. Both the closed-form family mapper and the cross-family mapper
   do this.
4. **A shared reference frame, if one is built deliberately.** Expressing a state by
   its similarities to a fixed anchor set is invariant to rotation, scaling and
   translation — the distortions that actually separate independently trained spaces
   — and it is the most robust interface in the literature. It is also the slowest,
   and none of the cache-transfer methods use it.

### 2.5.3 What is not held in common

- **Token boundaries.** Tokenizer compatibility governs how well cross-model
  alignment works: exact token match rate between model pairs correlates with
  downstream alignment quality at r = 0.898, and cross-tokenizer work has to fall
  back on character-boundary heuristics or on pooled summaries.
- **Layer count and KV geometry.** The cheap cases are precisely defined. Identical
  KV head count and per-head dimension are enough for a closed-form per-head ridge
  mapper, where one source layer explains 56% of a target layer's key variance and
  32% of its value variance on Qwen3 14B→32B, rising to 79% and 65% with several
  source layers. Fully identical geometry — same KV head count, head dimension and
  depth — is what the training-free linear interpolation needs.
- **The middle of the network.** Cross-model alignment has been localized to the
  final one or two layers: a late-stage, output-space effect rather than evidence of
  shared internal reasoning. The mid-layer cache mappings that do work are per-layer
  ridge fits, and even within one family, four of six pairs retained 73–98% of the
  receiver's standalone-prefill accuracy while two degraded sharply.
- **Scale below roughly 1.6B parameters.** A separate measurement of four
  decoder-only models finds the rotation-based geometry of factual processing
  absent in a 1.5B model and present from 1.6B upward, strengthening with scale.
  A common language between two small models is a common language with less in
  it.

### 2.5.4 Pyash already has a common language — in symbols

This is the part worth sitting with. Pyash already builds an explicit shared
conceptual layer: the SUMO knowledge core, with 10,686 concepts decided and 7,084
links promoted. It is a common language in the strict sense — model-family
independent, inspectable, auditable, and readable by every agent that looks it up.

The KV literature is the same idea made implicit and higher-bandwidth. The
knowledge core's own proposal says plainly that it is "not a vector store",
because similarity search cannot answer whether two claims are the same. The
representation line of work is the vector-store cousin: it can carry more than a
summary, but it cannot tell you what is true, and it cannot tell you which claim is
which.

So the question is not whether Pyash should have a common language. It has one.
The question is whether the common language should *also* exist at the
representation level, as a second and higher-bandwidth channel beside the symbolic
one — and the answer has to be paid for per model pair.

### 2.5.5 Why our cheap case is the one the paper skipped

The fleet is mostly one family. The model tags this repository uses are
`qwen3.5:9b`, `qwen3.5:27b`, `qwen3.8:9b`, `qwen3.8:27b`, `qwen3:8b`,
`qwen2.5:7b`, `llama3.2:3b` and a `Qwen3.8-9B-Distill-GGUF` build.

Two things follow.

**First, a same-family pair with matching KV geometry is exactly the case where
the literature says the cheapest thing works**: no trained mapper and no adapter,
just a linear map fit in closed form — or, when the geometry is identical, a
linear interpolation. The tags do not tell us the KV head count, the head
dimension or the tokenizer, so that has to be read off the GGUF metadata on the
host that serves them. That is one command and no new infrastructure.

**Second, and more important: the serving stack already avoids most of the prefill
we would be trying to avoid — except where our own policy throws it away.**

Ollama caches the KV state of the prompt it processes and reuses it when a later
request shares a prefix, which its own documentation describes as the thing that
saves most of the work in a long-horizon agent session. The cache matches from the
start of the prompt up to the first token that differs, so appending to the end is
free and changing anything earlier re-processes everything after it. The cache
lives as long as the model stays loaded, which is governed by `keep_alive`.

Our Housekeeper does two things that cut against it. It discharges every warm
model that is not the current target with `keep_alive: 0`, which drops that
model's cache entirely, and it runs the target model with a default
`keep_alive: 300`, so five idle minutes are enough to lose the prefix. A hand-off
that crosses a model swap therefore re-prefills from nothing, and a hand-off that
crosses five idle minutes does the same.

That is the accounting to do first, and it is answerable from the repository's own
architecture notes rather than from a paper: for a representative hand-off, how
much of the receiver's prefill is being recomputed today, and is it lost to a
model swap, to an idle gap, or to the sender's summary being lossy? The first two
are scheduling problems we already own. Only the third is the one this paper
attacks.

### 2.5.6 What can be measured before anything is built

Three checks, in increasing order of cost. None of them needs a mapper, a trained
adapter, or a paper to be replicated.

1. **Prefill accounting.** Take a real agent hand-off and measure the receiver's
   time-to-first-token against the same call with the shared prefix already warm.
   The gap is the ceiling on what any cache-transfer scheme could win.
2. **Geometry check.** Read the KV head count, the head dimension and the tokenizer
   for the two local models of a candidate pair. If the geometry matches and the
   tokenizer matches, the training-free path exists on paper.
3. **Text-channel quality.** Measure how much of the sender's state survives the
   summary the sender writes for the reader. If the summary loses little, a latent
   channel has nothing to recover, and the honest conclusion is that our hand-off is
   already efficient enough.

The third is the one that can end this proposal, and it is the one that should be
run first.

---

## Part 3 — Shape of a proposed change

If a reviewer accepts this as a direction, the work would land in pieces
rather than as one change, and only after the questions in Part 4 are
answered:

- **A facts note** under `documentation/reference/` recording the paper, the
  verified claims and the corrections, so nobody re-reads the post and believes
  the prior-work line.
- **A decision entry** in `documentation/decisions.md` only if we commit to
  running the observation below.
- **An experiment package** in `program/runtime/work/roadmap.mjs`, and its
  measurements in `documentation/workbook/`, if the observation justifies it.

The observation worth running, if any, is deliberately smaller than the paper:
take two local agents that already share a model, hand one agent's findings to
the other both ways — as a text summary, and as a cache hand-off — and measure
the difference in task accuracy and wall-clock. If the difference is small, the
paper does not concern us and the note stays a note.

Before any of that, the three cheap checks in 2.5.6 come first, in that order:
prefill accounting, the geometry check, and the text-channel quality measurement.
The last of those can end the proposal on its own, and it is cheaper than any
experiment the paper would ask for.

### Exclusions

This proposal does not propose, and a reviewer should not read it as proposing:

- any change to the agent protocol, the newspaper format, or channel payloads;
- adopting SwaT, depending on the paper's code, or training a mapper;
- any claim that our agents are conscious, or that latent transfer is
  telepathy — the name is marketing and the mechanism is a trained mapper;
- a benchmark suite, or a claim that our runtime is "telepathic";
- bringing cross-family transfer into scope. If the same-family observation is
  worthwhile, cross-family is a separate, larger question with a different
  cost model.

---

## Review questions

1. **Is our hand-off actually lossy enough to matter?** Where in the runtime
   does an agent's work get summarised into text for another agent, and how
   much of the sender's state does that destroy? Answer this by pointing at
   concrete hand-offs, not in principle.
2. **Which pair of models would we even measure?** The Housekeeper serves
   `qwen3.5:9b` and other local models. Are two of them a same-family pair we
   could hold in cache at once, and is a second family available locally at all?
3. **Would the Housekeeper have to change to allow this?** Does the inference
   path need a new cache-capture and cache-transport surface, and what does
   that do to the VRAM budget and to the queue's fairness guarantees?
4. **Is a same-family observation worth doing before this work is replicated or
   reviewed?** If the paper's own comparison is against lossy text summaries,
   the honest first step may be improving our summaries instead.
5. **Where should this land if it lands?** A reference note, a decision, or a
   roadmap package — and what is the acceptance criterion that would tell us
   the observation is done?
6. **Do two of our local models share KV geometry and a tokenizer?** The cheap
   path in this literature needs either identical geometry, where a training-free
   linear interpolation works, or matched KV head count and head dimension, where a
   closed-form ridge mapper can be fit. Reading those numbers off the GGUF metadata
   decides whether the cheap path exists at all, and it costs one command.
7. **Do we want a second common language, or one good one?** We already have a
   shared conceptual layer in the SUMO knowledge core. A latent channel would be a
   second, higher-bandwidth, less auditable one. What does it buy that better
   summaries and a sharper knowledge core do not?
