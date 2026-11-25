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
