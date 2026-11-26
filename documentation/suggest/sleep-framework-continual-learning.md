# Sleep and Consolidation: What the Google Framework Changes for Pyash

**Status:** proposal awaiting review. Nothing in Pyash changes today. This
document records a paper, checks a viral summary of it against the paper itself,
and states what it would mean for this repository if it were worth pursuing.

## Purpose

A post from [@HowToPrompt__](https://x.com/HowToPrompt__) claims that Google
built an AI that rewrites its own weights while "sleeping": a wake phase where it
works and a sleep phase where it consolidates short-term memory into long-term
weights and then "dreams" synthetic scenarios to improve itself — with no
catastrophic forgetting, no loss across a ten-million-token window, new
languages learned for free, and AIME accuracy near 80%.

The claim points at a real paper — *Language Models Need Sleep: Learning to
Self-Modify and Consolidate Memories* (arXiv:2606.03979, Behrouz, Hashemi and
Mirrokni, Google and Cornell, with the Google Research blog post of 27 October
2026). The interesting question for this repository is not whether the paper is
good. It is **whether Pyash already answers the problem it attacks, and if so,
whether the answer is better or worse than the paper's.**

The short answer stated up front so a reviewer can stop early if it is wrong:

- **The paper is real and the post's headline numbers are accurate**, with one
  averaging detail and one condition it leaves out.
- **The post sells the part the paper is most worried about.** "Continuous,
  autonomous self-improvement" is presented as the benefit. The paper's own
  related-work analysis names iterated self-improvement as the *risk* —
  privileged-information leakage, training collapse, up to 40% out-of-
  distribution degradation — and the framework's design exists to contain it.
- **We do not train models, so this is not our problem today.** Every part of
  the mechanism is a training-time mechanism: parameter expansion, on-policy
  distillation, reinforcement learning, a continual-learning curriculum.
- **Pyash already does this job at the artifact level.** The knowledge core is
  the durable, queryable, auditable memory the paper tries to build inside the
  weights. The refineries are the dreamers. And the quiz suite is the
  consolidation gate — which is the part the paper had to invent parameter
  expansion to obtain.
- **So the honest outcome is a note, not a project.** What is worth taking is
  the argument that an external, inspectable memory is preferable to an
  internal one, and the design principle that consolidation and self-modification
  must be separated.

---

## Part 1 — The evidence

### 1.1 The post

- Post: <https://x.com/HowToPrompt__/status/2122973973730513351>
- Author: How To Prompt (@HowToPrompt__), "Trustworthy AI education", 45,480
  followers
- Posted: 2026-11-18 08:43:32 UTC — a week before the other two posts by the
  same author that this repository has documented
- Engagement at capture: 42,582 views, 958 likes, 105 reposts, 73 replies, 789
  bookmarks, 31 quotes — the largest reach of the four
- Media: one image, 1756x1200 — a figure from the paper

Reproduce the capture:

```bash
curl -sSL "https://api.fxtwitter.com/HowToPrompt__/status/2122973973730513351"
```

`x.com` itself serves an anti-bot page to plain HTTP clients; the FxTwitter
API returns the same post as JSON with no key.

### 1.2 The downloaded artifact

The post image is kept with the run artifacts, outside version control:

| File | SHA-256 |
| --- | --- |
| `artifacts/how-to-prompt-sleep-framework-20261118/post-image.jpg` | `cee62d8ac5a7407e6a48465b5733651abf8cc4b0373c6e4c2f4d54de28a12e4a` |

```bash
mkdir -p artifacts/how-to-prompt-sleep-framework-20261118
curl -sSL -o artifacts/how-to-prompt-sleep-framework-20261118/post-image.jpg \
  "https://pbs.twimg.com/media/HXZRc6vaUAAHu4x.jpg?name=orig"
sha256sum artifacts/how-to-prompt-sleep-framework-20261118/post-image.jpg
```

### 1.3 The paper

- *Language Models Need Sleep: Learning to Self-Modify and Consolidate Memories*
- Ali Behrouz (Google and Cornell), Farnoosh Hashemi (Cornell), Vahab Mirrokni
  (Google). The Google Research blog also credits Adel Javanmard (Google and
  USC)
- arXiv:2606.03979v1 [cs.LG], 2 June 2026. A version has been publicly
  available on OpenReview since September 2025
- Blog: *The sleep framework: A new way for LLMs to retain knowledge in
  continual learning*, Google Research, 27 October 2026, by Ali Behrouz and
  Vahab Mirrokni

```bash
curl -sSL "https://arxiv.org/abs/2606.03979" -o sleep-abs.html
curl -sSL "https://arxiv.org/html/2606.03979v1" -o sleep.html
curl -sSL "https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/" -o sleep-blog.html
```

The framework is called **Hope** in the paper, which the post does not mention.

### 1.4 What the paper does

The problem the paper names: models are static after deployment. They have a
fixed knowledge cutoff, they cannot integrate new facts, and the only way to
learn is a parameter update, which brings catastrophic forgetting.

The answer is a periodic lifecycle with two states.

- **Active (wake) phase.** The model receives and processes input, storing
  temporary information in fast, short-term memory components.
- **Sleep phase.** The model takes no new input and spends its compute on its
  own memory, in two stages:
  - **Memory consolidation.** Knowledge Seeding: an *upward* distillation in
    which the memories of a smaller self are distilled into a larger network,
    which provides more capacity while preserving the knowledge. The
    implementation is a Generalized Distillation — on-policy distillation
    combined with reinforcement-learning-based imitation learning — over a
    **Continuum Memory System**, a chain of MLP blocks each with its own update
    frequency, where the slowest block defines the unit of time.
  - **Dreaming.** The model uses reinforcement learning to generate a
    *curriculum* of synthetic data with which it rehearses new knowledge and
    refines existing capabilities, without human supervision. The blog
    describes two mechanisms: **random expert selection**, where the
    mixture-of-experts router activates non-standard experts during synthetic
    generation, and **curated rehearsal**, where generated samples are filtered
    by gradient-based data selection.

The order matters and is the framework's central design choice: consolidation
first, then dreaming. The paper is explicit that this ordering reduces the risk
that self-training overwrites useful prior capabilities.

### 1.5 The post against the paper

| Post says | Paper says | Verdict |
| --- | --- | --- |
| Google built an AI that rewrites its own weights to get smarter | a research framework called Hope, from a paper and a blog post | imprecise: a framework, not a product |
| ...and it does it by sleeping | the Sleep paradigm with active and sleep phases | accurate |
| Every AI model you use has a fatal flaw: catastrophic forgetting | forgetting arises in *continual parameter updates*; a deployed model is static, not forgetting | overstated framing |
| When you train a model on new data, it suffers from catastrophic forgetting | the paper's premise | accurate |
| If you bypass it with a massive context window, the AI forgets everything the second you close the chat | not a paper claim; losing context is not the same phenomenon as forgetting under training | conflates two things |
| The wake phase stores new information in a fragile, short-term memory bank | "storing temporary information in fast, short-term memory components" | accurate |
| The sleep phase unlocks dormant parameters and transfers short-term experience into long-term memory | "unlocks pre-allocated Mixture-of-Experts memory blocks"; consolidation into expanded lower-frequency parameters | accurate |
| It learns forever without overwriting the past | the design "reduces the risk" that self-training overwrites prior capabilities | overstated |
| During sleep it activates random, unusual neural pathways, generates synthetic scenarios and tests itself | random expert selection plus an RL-generated synthetic curriculum | accurate |
| It retained perfect knowledge across a 10-million-token window | "almost perfect score in scaling to 10M of tokens" | accurate, and the fine-tuning condition is missing |
| It learned entirely new, unseen languages with zero performance drop | Hope-3 "nearly recovers its single-language performance"; in-context learning alone "reverts largely to pre-trained behavior" | nearly, not zero |
| It crushed elite math benchmarks (AIME), jumping to nearly 80% accuracy | AIME-24 79.2 for Qwen3-8B, from a base of 73.8 | accurate for AIME-24; AIME-25 moves only 68.1 → 69.0 |
| Zero catastrophic forgetting. Continuous, autonomous self-improvement. | the paper's own analysis names iterated self-improvement as the risk to be contained | overstated, and inverted |
| It's about letting the machine process its experiences after you log off | the blog's own framing: endpoints and models that keep learning between sessions | accurate |

### 1.6 The paper's own numbers

**Mathematical reasoning (Tables 1 and 2).** Average over 16 samples.

| Method | AIME-24 | AIME-25 | HMMT-25 |
| --- | --- | --- | --- |
| Qwen3-8B Base (Instruct) | 73.8 | 68.1 | 42.4 |
| Qwen3-8B SFT | 75.5 | 66.4 | 43.7 |
| Qwen3-8B GRPO | 76.4 | 68.1 | 44.9 |
| Qwen3-8B OPSD | 76.6 | 67.4 | 45.1 |
| **Qwen3-8B Sleep** | **79.2** | **69.0** | **46.1** |
| Qwen3-1.7B Base (Instruct) | 49.8 | 34.5 | 25.7 |
| **Qwen3-1.7B Sleep** | **53.2** | **40.2** | **29.3** |

The post's "nearly 80%" is the AIME-24 figure. The honest reading of the table
is that the gain concentrates on AIME-24 (+5.4 points) and is close to flat on
AIME-25 (+0.9). Ablations on Qwen3-8B: without imitation learning 76.8, without
semantic reward 78.9, without parameter expansion 78.2, and the consolidation
step alone (OPSD + expansion) 77.9 — so dreaming contributes roughly 1.3 points
on AIME-24 over consolidation alone.

**Knowledge incorporation (Table 3).** Integrating SQuAD facts, single passage
versus continued pretraining over 200 passages.

| Method | Single passage | Continued pretraining (n = 200) |
| --- | --- | --- |
| Base model | 31.9 | 31.9 |
| Fine-tuned model with no Dreaming | 33.4 | 32.0 |
| SEAL | 46.7 | 43.2 |
| Sleep (Transformer) | 48.1 | 44.3 |
| Sleep (Transformer + four-level) | 48.9 | 46.2 |
| ...removing gradient-based selection | 47.1 | 45.2 |
| ...removing random expert | 48.0 | 44.7 |
| ...removing Dreaming | 35.7 | 36.2 |

Removing dreaming costs about 12 points, and without it the model is barely
above the base. Dreaming is not the garnish here; it is most of the mechanism.

**Few-shot abstract reasoning (Table 4).** ICL 0, test-time training 10, SEAL
72.5, Sleep 80.

**Continual translation of a novel language (CTNL).** Two previously unseen
languages (Manchu and Kalamang) exposed in context. In the single-language
setting every Hope variant matches or exceeds in-context learning. Sequentially,
in-context learning "exhibits a sharp performance drop, largely reverting to
pre-trained behavior", while Hope "retains substantially more of its gains",
improving monotonically with the number of consolidation stages, with Hope-3
"nearly recover[ing] its single-language performance despite sequential
exposure". Notably, both Cartridges and supervised fine-tuning faced
catastrophic forgetting in at least one language, doing worse than in-context
learning.

**Long context (BABILong).** Hope "remains stable even at extreme lengths up to
10M tokens"; GPT-4 and GPT-4o-mini "fail beyond 128K-256K tokens"; Titans and
ARMT "degrade sharply" beyond roughly 1M. With one important condition the post
omits: "all small models, including Hope, suffer substantial performance drops
without fine-tuning". The 10M result is a fine-tuned model under the BABILong
protocol, not a zero-shot model.

### 1.7 What the numbers do not say

1. **It is a training framework, and it needs a training setup.** Continual
   learning datasets, parameter expansion into mixture-of-experts blocks,
   on-policy distillation, reinforcement learning, and a synthetic curriculum.
   Nothing here runs against an inference server.
2. **The self-improvement loop is the risk, not the gift.** The paper's own
   related-work analysis of its precursor reports that conditioning a teacher on
   privileged information can suppress a model's epistemic verbalisation with
   out-of-distribution drops of up to 40%, and that naively iterating
   self-distillation in a long-horizon pipeline can leak privileged information
   and collapse training. The Sleep design exists to contain that, by
   consolidating first and dreaming second.
3. **The gains are not uniform.** AIME-25 barely moves, and the language result
   is "nearly recovers", not "no drop".
4. **The 10M-token result requires fine-tuning.**
5. **The post's premise is about deployed models, and the paper's is about
   training.** A model that is not being updated does not suffer catastrophic
   forgetting; it suffers a stale knowledge cutoff, which is a different
   problem with a different set of answers.

---

## Part 2 — Why this could matter to Pyash

### 2.1 We do not train models, so the mechanism is out of scope

Every component is a training-time component: parameter expansion, upward
distillation, reinforcement learning, a synthetic curriculum, a continual-
learning dataset. This repository serves models. It does not fine-tune them, and
no roadmap package proposes to.

That means the paper cannot be adopted, and the proposal in Part 3 is not
"implement a sleep phase". It is a note plus two things worth carrying.

### 2.2 The problem the paper attacks, we solved differently

The paper's complaint — models are static, have a knowledge cutoff, cannot
integrate new facts, and hold only fragile short-term context — is exactly the
complaint behind the knowledge core. The difference is where the memory lives.

| The paper | Pyash |
| --- | --- |
| Long-term memory in the weights, written by consolidation | Long-term memory in the knowledge core: canonical claim identities, evidence and provenance, validity intervals, adjudication outcomes |
| Short-term memory in fast, low-frequency parameters | Short-term state in the house, the channels and the holding lanes |
| Memories organised by *update frequency* | Memory organised by *lifetime*: held, contested, current, promoted |
| Consolidation is invisible; you inspect the weights, or you do not | Consolidation is inspectable: `current`, `contested` and `provenance` are resolver views, and the lifecycle outcomes are held, rejected and promoted |
| Knowledge is in parameters, so it cannot be retracted | A claim can be retracted, and the retraction is recorded |

The paper's Continuum Memory System is a hierarchy of memory at different
frequencies inside one model. Pyash's world is a hierarchy of memory at
different lifetimes outside the model. The shapes rhyme; the substrate does not.

And on the question the paper is really asking — *is memory better inside the
model or outside it?* — the paper is evidence for the outside. A weight you
cannot inspect, cannot adjudicate, and cannot retract is a claim you cannot
audit. The knowledge core's whole design is the opposite bet.

### 2.3 We already dream — the refineries

The dreaming stage generates synthetic data and rehearses against it. That is
what the refineries do: the chip refinery generates candidates and selects
against a deterministic strategy; the Chinese character atom and grammar
refineries generate synthetic training material for models that have no such
material.

The differences are the interesting part. The paper's dreamer is
reinforcement-learned, with a curriculum and a gradient-based data selector; our
refineries are human-specified pipelines with deterministic selection and
inspectable outputs. Ours is auditable; theirs is better at discovering
patterns nobody wrote down. If we ever wanted the second kind, this paper
would be a place to start reading — but it would be a different project with a
different cost model, and the honest answer today is that our version is
enough.

### 2.4 The quiz suite is the consolidation stage

This is the one transferable idea, and it is worth stating precisely because
the paper had to build a great deal of machinery to obtain it.

The paper's insight is that consolidation and self-modification must be
*separated*: consolidate first, so that when the model later modifies itself,
it cannot overwrite what was just consolidated. The danger it is managing is
that a self-improving loop erodes its own prior capabilities.

Pyash has the same danger and the same answer, one level up. The repository's
ambition is that "new implementations can be proposed by LLMs or mutation" and
that "only code that passes quizzes is kept". A program that is proposed,
consolidated into the library and then allowed to propose its own successor is
exactly the paper's iterated self-improvement loop. The quiz suite is what makes
that safe: the successor is measured against the same gate before it is kept.

So the paper's central design decision — separate the consolidating step from
the self-modifying step — is a decision this repository has already made, for
the same reason, with a cheaper mechanism. The generalisation worth carrying is
not the sleep phase. It is the *separation*, and the fact that our gate is
executable rather than statistical.

### 2.5 The day we train something, this becomes relevant

Today it does not. But three things would change that:

- if we ever fine-tuned or distilled a local model on our own runs,
- if we ever wanted a model that knows *this* repository rather than a
  repository of facts about it,
- if we ever let a model modify its own tooling.

On any of those, catastrophic forgetting becomes a real risk, and this paper's
shape — consolidate into expanded capacity first, then self-modify — plus its
warning about iterated self-improvement is a good starting point. The
alternative would be to keep durable knowledge outside the model, which is what
we already do, and which the paper's results do not argue against.

### 2.6 The measurement, if any, is about us

The paper's own measurement tasks are cheap to read: does a newly learned fact
survive, and does it survive *sequentially*? Our version of that question is
not about weights. It is: when an agent learns something, where does it end up,
and does it survive a session boundary, a model swap and an adjudication?

That is the knowledge core's question, and it is answerable today from the
claim records. The paper is a reminder that it is worth asking, and a warning
that the alternative — putting memory in weights — is the one that cannot be
audited.

---

## Part 3 — Shape of a proposed change

If a reviewer accepts this as a direction, the work would land in pieces, and
only after the questions in the review section are answered:

- **A facts note** under `documentation/reference/` recording the paper, the
  verified claims and the corrections, so nobody re-reads the post and believes
  the self-improvement loop is free of risk.
- **A cross-reference** from `documentation/suggest/knowledge-core.md` to this
  note, because the two are two answers to one question and the comparison is
  the useful part.
- **Nothing else**, unless a reviewer decides we are about to train something.
  No sleep phase, no dreaming stage, no curriculum.

If the reviewer thinks the separation insight deserves to be written down
somewhere durable, the natural home is the quiz gate itself — a sentence in
the specification that says a consolidated artefact is protected from the
self-modifying loop that follows it. That is a documentation change, not a
code change.

### Exclusions

This proposal does not propose, and a reviewer should not read it as proposing:

- any training, fine-tuning, distillation or curriculum;
- a sleep phase, a dreaming stage, a parameter expansion, or any change to how
  a served model is loaded or unloaded;
- putting durable knowledge into model weights, which would make it
  unauditable;
- any claim that our agents are conscious, or that sleep and dreaming are
  literally what our agents do;
- a benchmark suite;
- treating the paper's self-improvement loop as risk-free, when the paper's own
  analysis identifies iterated self-distillation as a source of training
  collapse.

---

## Review questions

1. **Is the knowledge core's answer to this better or just cheaper?** The paper
   puts memory in weights; we put it in a claim store. The paper's results
   argue that memory inside the model can be made to work. What do we lose by
   keeping it outside — and is the answer "we can inspect and retract it", or is
   that too thin to carry the weight?
2. **Does the separation insight apply to our evolutionary loop?** The paper
   consolidates before it self-modifies, so the self-modification cannot
   overwrite what was just consolidated. Our quiz gate is supposed to do the
   same for programs. Is that actually true of the current loop, or can a
   proposed implementation erode the behaviour that let it pass?
3. **Would we ever train anything?** If the answer is no, this note exists only
   as background, and the review question is whether it belongs in
   `documentation/reference/` rather than `documentation/suggest/`. If the
   answer is yes, the paper's ordering constraint becomes a design requirement
   before it is a literature question.
4. **Is our refinery pipeline a dreamer without the reward?** The paper's
   dreaming stage learns a curriculum; ours is written by hand. What would it
   take to move from hand-written selection to learned selection, and would the
   audit trail survive?
5. **What is the honest headline?** If a summary of this paper said only true
   things, what would it be — and would that summary be worth a place in this
   repository at all?
6. **Where should this land if it lands?** A reference note, a cross-reference
   from the knowledge core, or a roadmap package — and what is the acceptance
   criterion that would tell us the observation is done?
