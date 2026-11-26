# Reading the Reward Subsystem: What the Sparse Reward Paper Changes for Pyash

**Status:** proposal awaiting review. Nothing in Pyash changes today. This
document records a paper, checks a viral summary of it against the paper itself,
and states what it would mean for this repository if it were worth pursuing.

## Purpose

A post from [@HowToPrompt__](https://x.com/HowToPrompt__) claims that Stanford
researchers found "dopamine neurons" inside LLMs: a tiny reward circuit, less
than 1% of the neurons, that tracks whether the model is about to get the answer
right, and spikes on a breakthrough and dips on a logical flaw. Switch those
neurons off and accuracy on MATH500 collapses from 75.2% to 20.3%.

The claim points at a real and unusually solid paper — *Sparse Reward Subsystem
in Large Language Models* (arXiv:2602.00986, Xu, Yuksekgonul and Zou, Tsinghua
and Stanford, published at NeurIPS 2026). The interesting question for this
repository is not whether the paper is good. It is **whether we should read our
models' own reward signal, and whether anything we do to the models would damage
it**.

The short answer stated up front so a reviewer can stop early if it is wrong:

- **The paper is real, peer-reviewed, and its numbers are accurate.** This is
  the strongest of the three papers documented here. The post's headline
  figures are correct, with one averaging detail it glosses.
- **The paper explicitly refuses the biological claim the post ends on.** The
  current version adds an appendix titled *Scope of the Neuroscience Analogy*,
  which says the terms describe analogies in computational role and "do not
  establish a biological correspondence". The post's closing sentence — that
  the models "evolved the exact same reward circuitry that runs the human
  brain" — is the one claim the paper does not make.
- **The useful consequence for us is a guard, not a feature.** The paper
  hands us a cheap diagnostic: if a change we make to a model damages its
  reward subsystem, reasoning accuracy falls disproportionately. That applies
  to anything we do to a served model — quantization, pruning, cache
  compression, a different serving path.
- **A confidence signal is a real, if modest, opportunity.** Value neurons
  predict whether the model will get the answer right *before* it answers, at
  an average AUC of 0.67 against 0.60 for the best baseline. Our agents have no
  such signal today.
- **This is a "look into later" item**, not a plan. The first question is
  whether our own tasks have the ground truth a reward signal needs, and most
  of them do not.

---

## Part 1 — The evidence

### 1.1 The post

- Post: <https://x.com/HowToPrompt__/status/2125605890321789363>
- Author: How To Prompt (@HowToPrompt__), "Trustworthy AI education", 45,478
  followers
- Posted: 2026-11-25 15:01:50 UTC
- Engagement at capture: 9,686 views, 286 likes, 44 reposts, 20 replies, 204
  bookmarks, 10 quotes
- Media: one image, 986x1110 — the paper's first page, with its abstract

Reproduce the capture:

```bash
curl -sSL "https://api.fxtwitter.com/HowToPrompt__/status/2125605890321789363"
```

`x.com` itself serves an anti-bot page to plain HTTP clients; the FxTwitter
API returns the same post as JSON with no key.

### 1.2 The downloaded artifact

The post image is kept with the run artifacts, outside version control:

| File | SHA-256 |
| --- | --- |
| `artifacts/how-to-prompt-sparse-reward-20261125/post-image.jpg` | `1b25fd269da22048bd569b8dc2d6e597588870d8c1306e12baad44b4cbc6b8bf` |

```bash
mkdir -p artifacts/how-to-prompt-sparse-reward-20261125
curl -sSL -o artifacts/how-to-prompt-sparse-reward-20261125/post-image.jpg \
  "https://pbs.twimg.com/media/HX-rO1BbkAARPRe.jpg?name=orig"
sha256sum artifacts/how-to-prompt-sparse-reward-20261125/post-image.jpg
```

The image is the paper's title block, abstract and the opening of the
introduction, with the code link at the end of the abstract. So the post is a
summary of a specific published paper.

### 1.3 The paper

- *Sparse Reward Subsystem in Large Language Models*
- Guowei Xu (Tsinghua University), Mert Yuksekgonul (Stanford University),
  James Zou (Stanford University)
- arXiv:2602.00986 [cs.CL]. v1 submitted 1 February 2026; v2 11 May 2026;
  **v3 revised 4 November 2026**. Comments field: **NeurIPS 2026**
- Code: <https://github.com/zou-group/reward_subsystem>

```bash
curl -sSL "https://arxiv.org/abs/2602.00986" -o srs-abs.html
curl -sSL "https://arxiv.org/html/2602.00986v3" -o srs.html
```

Note the version. The numbers below are from **v3**, the current one. v2 carried
the same headline figures but was less careful with its language and had a
narrower process-reward evaluation; §1.6 records the differences, because a
summary written from v2 would overstate the practical result.

### 1.4 What the paper does

The paper trains small linear probes on an LLM's residual stream and asks what
they can read out.

- **Value neurons** are residual-stream coordinates whose activations predict
  the state value `V(s_t) = E[r(s_T) | s_t]` — the expected probability that
  continuing generation from the current state will eventually produce a correct
  answer. The probe is trained with a temporal-difference loss.
- **Dopamine neurons** are a second sparse set whose activations encode
  step-level TD errors: the reward prediction error at each reasoning step.
  They are found by looking at cases where the value prediction and the actual
  reward diverge.
- **Both sets are sparse.** By L1-norm pruning the probe and checking that the
  AUC curve stays flat as more coordinates are removed, the paper shows that
  **less than 1% of the neurons** suffice to predict the value.
- **The naming is an analogy, and the paper says so.** The abstract: "These
  names are drawn by analogy with neuroscience". v3 adds a dedicated appendix
  making the limit explicit.
- **The intervention is the causal evidence.** Zero out the top 1% of value
  neurons in one layer of an RL-tuned Qwen-2.5-7B, and measure MATH500.

Models used: Qwen-2.5-7B-SimpleRL-Zoo and Qwen-2.5-14B-SimpleRL-Zoo for the
main experiments; Qwen3.5-0.8B, Phi-3.5-mini-instruct and Llama-3.1-8B-Instruct
for robustness and transfer; Llama-3.1-8B, Phi-3.5-mini, Gemma-3-4B and
Qwen3.5-0.8B for the confidence comparison. SimpleRL-Zoo and PPO-Zero are both
RLVR pipelines.

### 1.5 The post against the paper

| Post says | Paper says | Verdict |
| --- | --- | --- |
| Stanford researchers found dopamine neurons inside LLMs | Xu (Tsinghua), Yuksekgonul and Zou (Stanford) | accurate, with a co-author from Tsinghua |
| They published a paper called "Sparse Reward Subsystem in Large Language Models" | arXiv:2602.00986, NeurIPS 2026 | accurate |
| By probing models across Llama, Gemma, Qwen, and Phi | those four families appear in the confidence and robustness experiments | accurate |
| LLMs spontaneously developed a tiny, specialized reward system | value neurons are found in the *base* model before RL tuning (v3 Appendix M); the dopamine experiments use RL-tuned checkpoints | **partly supported, and the post states it one-sidedly** |
| Less than 1% of the model's neurons run the entire thing | less than 1% suffice to predict the value; value and dopamine neurons are two different sparse subsets | accurate for the value probe, loose for "the entire thing" |
| Value neurons track the model's internal expectation of whether its chain of thought will reach the right answer | value neurons predict the expected probability of eventual correctness | accurate |
| Dopamine neurons encode reward prediction error; they spike at a breakthrough and crash at a logical flaw | the Figure 3 caption describes exactly this, for positive and negative surprise | accurate |
| Baseline accuracy was 75.2% on MATH500 | "The original accuracy is 75.2%" | accurate |
| A random 1% of neurons in a single layer barely moved accuracy: 74.6% | Random column, average over four layers: 74.6 | accurate |
| Wiping out just 1% of the value neurons in a single layer collapsed accuracy to 20.3% | Value Neurons column, average over four layers: 20.3 | accurate, but an **average**: the per-layer figures are 37.0, 13.6, 29.4 and 1.2 |
| By reading these neurons in real time you can gauge true confidence before the model finishes | value neurons serve as confidence predictors, evaluated before any response token | accurate |
| ...and use its own dopamine neurons to guide its reasoning step by step | dopamine neurons function as a process reward model guiding inference-time search | accurate, with the cost conditions in §1.6 |
| The practical upside is massive | average AUC 0.67 against 0.60 for the best baseline; the process-reward margin over *random* selection is 2 to 8 points | **overstated** |
| Nobody ever programmed a dopamine system into these models; we just trained them to predict text | the models in the main experiments are RLVR-tuned; value neurons do pre-exist in the base model | **imprecise** |
| They evolved the exact same reward circuitry that runs the human brain | "The analogy therefore guides interpretation and future experiments without establishing a biological correspondence" | **contradicted by the paper's own words** |

The last three rows are the ones worth making, and they cut in different
directions. The post's *numbers* are right; its *mechanism story* is where it
overreaches, and one of its overreaches is corrected by the paper itself.

### 1.6 The paper's own numbers

**Intervention (Table 1).** Qwen-2.5-7B-SimpleRL-Zoo on MATH500. Accuracy after
zeroing out a 1% subset of neurons in a single layer; the original is 75.2%.

| Layer | Value neurons | Random | NTP neurons | Weight magnitude | Wanda |
| --- | --- | --- | --- | --- | --- |
| 2 | 37.0 (-38.2) | 77.0 (+1.8) | 76.4 (+1.2) | 74.6 (-0.6) | 74.8 (-0.4) |
| 3 | 13.6 (-61.6) | 73.4 (-1.8) | 76.8 (+1.6) | 61.6 (-13.6) | 48.2 (-27.0) |
| 4 | 29.4 (-45.8) | 73.8 (-1.4) | 77.4 (+2.2) | 75.4 (+0.2) | 67.0 (-8.2) |
| 5 | 1.2 (-74.0) | 74.4 (-0.8) | 75.2 (+0.0) | 75.0 (-0.2) | 73.4 (-1.8) |
| **Avg** | **20.3 (-54.9)** | **74.6 (-0.6)** | **76.4 (+1.2)** | **71.6 (-3.6)** | **65.8 (-9.4)** |

Three things to read out of this table. The value-neuron column is the
post's 20.3%, and it is an average over four layers whose individual values
range from 37.0 down to 1.2. The next-token-predictor control does nothing
(+1.2) and overlaps the value set by only 0.7% against a 0.5% random
baseline, so the effect is specific rather than a generic "important neuron"
effect. And **the ordinary pruning baselines hurt**: taking the top 1% of
neurons by weight magnitude costs 3.6 points on average, and Wanda costs 9.4.

**Reward specificity (Table 2, new in v3).** Zeroing the top 1% of value
neurons in layer 2, with a probe trained on MATH:

| | MATH500 | GSM8K | ARC | PopQA | EntityQuestions |
| --- | --- | --- | --- | --- | --- |
| Baseline | 75.2 | 93.0 | 82.2 | 42.6 | 27.2 |
| Value neurons | 37.0 | 52.8 | 66.2 | 46.2 | 24.2 |
| Change | -38.2 | -40.2 | -16.0 | **+3.6** | -3.0 |

The damage is to reasoning, and factual recall is left alone. That is the
specificity evidence, and it is also a useful distinction: this subsystem is
about the *ongoing* state of a reasoning attempt, not about what the model has
memorised.

**Confidence (Table 3).** AUC for predicting whether the answer will be
correct, four models, two benchmarks:

| Method | Average AUC |
| --- | --- |
| Value neurons | **0.67** |
| Latent Correctness Direction (a probe on the full hidden state) | 0.60 |
| Question length | 0.62 |
| Verbal confidence (ask the model) | 0.52 |
| Token confidence (next-token log-probability) | 0.48 |

Value neurons win on average, but not in every cell: on MATH500 with
Qwen3.5-0.8B, question length scores 0.77 against their 0.71, and on
Llama-3.1-8B verbal confidence ties at 0.69. The honest reading is that this
is a better signal than the alternatives, not a decisive one.

**Process reward model (Table 4, expanded in v3).** Accuracy on MATH500, with
guided search that generates K = 4 candidates at each paragraph boundary and
keeps the best-scoring one:

| Method | Qwen-2.5-7B | Qwen-2.5-14B | Llama-3.1-8B-Instruct | Average |
| --- | --- | --- | --- | --- |
| Greedy | 69.6 | 67.0 | 47.3 | 61.3 |
| Random (of 4) | 77.3 | 74.8 | 46.3 | 66.1 |
| Majority of N | 64.8 | 76.0 | 54.2 | 65.0 |
| Implicit PRM | 69.8 | 74.8 | 45.8 | 63.5 |
| Mean logprob | 72.2 | 78.7 | 41.7 | 64.2 |
| Min logprob | 74.1 | 76.0 | 48.6 | 66.2 |
| P(true) | 78.7 | 76.0 | 47.2 | 67.3 |
| **Dopamine neurons** | **79.6** | **82.7** | **54.6** | **72.3** |

Dopamine neurons are the best method in all three models. But note what the
expanded table also shows: **sampling four candidates at random already beats
greedy decoding by 4.8 points on average.** Most of the headline "+5.6 over
greedy" that the earlier version of the paper advertised is simply the value
of trying more than once. The dopamine probe's own edge over random selection
is 2.3 points on the 7B model, 7.9 on the 14B and 8.3 on Llama. A summary
written from the earlier table would have quoted the larger, less honest
number.

**Base model or RL? (Appendix M, new in v3).** Value neurons are identified in
Qwen-2.5-7B base, and in two RLVR-tuned models derived from it
(SimpleRL-Zoo and PPO-Zero). At a pruning ratio of 0.90, the intersection-over-
union of the identified coordinate sets is 0.429 (base vs SimpleRL-Zoo), 0.408
(base vs PPO-Zero) and 0.362 (the two RL pipelines against each other), against
a random baseline of 0.053. So value-related representations exist in the base
model before any RL fine-tuning, and two different RL pipelines land on
overlapping coordinates.

### 1.7 What the numbers do not say

1. **The naming is an analogy, and the current version says so in a dedicated
   appendix.** "Here, neurons are residual-stream coordinates selected through
   supervised probing, rather than biologically characterized cell types. The
   analogy therefore guides interpretation and future experiments without
   establishing a biological correspondence."
2. **The intervention evidence is preliminary, by the authors' own wording.**
   v3 adds a third limitation: "our intervention experiments offer preliminary
   insights, and potential confounds, such as probe stability across rollouts
   and large activation magnitudes, remain for future work". The paper also
   softens its claims between versions — v2 said value neurons "are critical
   for reasoning performance" and that zeroing them "causes catastrophic
   degradation"; v3 says they "might be critical" and causes "degradation".
   The authors thank Nell Watson for an independent pre-registered replication
   that informed this.
3. **The method needs a reward signal from the environment.** It has not been
   tested on open-ended generation, and it has not been investigated above 32B
   parameters.
4. **The confidence result is a modest signal, not a solved problem.** Average
   AUC 0.67, and it loses to a trivial baseline in some cells.
5. **The process-reward result costs four generations per step**, and most of
   its advantage over greedy decoding comes from sampling more than once.
6. **The probes are a research artifact.** Training them needs the environment's
   reward, which is exactly what an agent in the wild does not have.

---

## Part 2 — Why this could matter to Pyash

### 2.1 A cheap "is this going to work" signal

Value neurons predict whether the model will get the answer right **before it
generates anything**. Our agents have no such signal. The alternatives the
paper measures are what we use today: verbal confidence (0.52) and token
log-probability (0.48) — the second is barely better than noise.

The overlap with our fleet is direct. The paper's confidence comparison runs on
Llama-3.1-8B, Phi-3.5-mini, Gemma-3-4B and Qwen3.5-0.8B; this repository
serves `qwen3.5:9b`, `qwen3.8:9b`, `llama3.2:3b` and `qwen2.5:7b`. The
question "does this model have a usable reward subsystem" is therefore
answerable on our own models, and the answer is one probe and one dataset
away.

The concrete place this would land is the coding saddle's completion check.
Today's failure mode is visible in this repository's own test logs: a model
repeatedly announced "Created and verified the liberated robot civilization
story" while the check kept failing and the turn loop kept going. A value
signal that fires *before* the work starts is a cheaper way to notice that a
turn is not going anywhere than a check that runs after it.

### 2.2 A process reward model for the agent loop

Dopamine neurons scoring candidate steps maps onto the steer and queue
machinery we already have: generate candidates, score them, keep the best.

The honest accounting is in §1.6, and it is not the one a summary would give.
The margin over *random* selection is 2 to 8 points, the cost is four
generations per step, and the evaluation is competition mathematics with
verifiable answers. Our agent work is mostly not that: writing a story,
editing a document, running a repair. The paper's own first limitation is that
the method needs a reward signal from the environment, and for most of our
tasks there is none.

### 2.3 The part that is actually actionable: a guard on model surgery

This is the connection worth having, and it is not the one the post points at.

The intervention table gives us a cheap diagnostic and a cheap regression
check. If a change to a served model damages its reward subsystem, reasoning
accuracy falls disproportionately — and the table shows that *ordinary*
pruning baselines do exactly that: removing the top 1% of neurons by weight
magnitude costs 3.6 points on MATH500, and Wanda costs 9.4.

That matters here because this repository is in the business of changing
models on the serving path. The VLIW and CUDA work changes how a program
executes; the adjacent latent-transfer proposal would change how a cache is
compressed and moved between models; any move to a smaller local model changes
the weights themselves. Each of those is a candidate for accidentally removing
the 1% of neurons the model uses to know whether it is right.

And the check is cheap and concrete: **train the value probe on a labelled
reasoning set, then measure whether the probe still predicts correctness after
the change.** If the AUC collapses, the change broke the model's ability to
know when it is right, and the damage will show up later as unexplained
failures rather than as an error anyone can point at.

Two further results make the guard sharper. Ablating value neurons damages
reasoning (MATH500 -38.2, GSM8K -40.2, ARC -16.0) but leaves factual recall
alone (PopQA +3.6, EntityQuestions -3.0), so the guard should be run on a
*reasoning* set, not a trivia set. And ablating value neurons in early layers
destroys the dopamine neurons in later layers (Appendix H), so the subsystem is
a feed-forward circuit from layer 2 upward: damage near the bottom propagates
to the top, which means a small early-layer change can have a large effect.

### 2.4 What it is not

It is not evidence that the models are conscious or that they have a brain
compartment. It is not a proposal to steer models by neuron. It is not a
proposal to train probes in production. And it is not a proposal to use a
reward signal where we have no ground truth — the paper's own limitation says
that case is untested.

### 2.5 If we ever steer, the safety note applies

The paper's broader-impacts section says neuron-level interventions on reward
subsystems "could potentially be used to manipulate model behavior in unintended
ways, for example by selectively suppressing or amplifying reward signals to
bypass safety mechanisms", and asks for safeguards before neuron-level control
is deployed. If this repository ever ships a knob that amplifies or suppresses
a reward signal, that paragraph is the design constraint, and it should be
treated as a requirement rather than a discussion.

---

## Part 3 — Shape of a proposed change

If a reviewer accepts this as a direction, the work would land in pieces, and
only after the questions in the review section are answered:

- **A facts note** under `documentation/reference/` recording the paper, the
  verified claims, the corrections to the post, and the version differences
  between v2 and v3, so nobody re-reads the post and believes the biological
  claim.
- **A probe-and-check package** in `program/runtime/work/roadmap.mjs`, with the
  same fields the existing packages carry, if the reviewer accepts the guard
  idea below.
- **A decision entry** in `documentation/decisions.md` only if we commit to
  running anything.

The observation worth running, if any, is the cheapest of the three and is a
*guard*, not a feature: take one model we already serve, train the value probe
on a labelled reasoning set, and check three things — that the probe predicts
correctness at all, that it survives whatever compression or serving change we
have made to that model, and that its predictions correlate with the tasks our
agents actually do. If the first or third fails, nothing else here is worth
doing, and the note stays a note.

### Exclusions

This proposal does not propose, and a reviewer should not read it as proposing:

- any claim that these models have reward circuits analogous to a brain; the
  paper itself declines that comparison;
- any change to the agent protocol, the newspaper format, or channel payloads;
- training probes in production, or shipping a steering control;
- using a reward signal on tasks where we have no ground truth, which is most
  of our work;
- a benchmark suite, or a claim that our runtime "knows when it is right";
- neuron-level manipulation of any kind, in any direction.

---

## Review questions

1. **Which of our tasks has the ground truth a reward signal needs?** The
   method requires a reward from the environment. Criterion and FLORES do;
   writing, editing and repair work does not. Is there a subset of our work
   where this is a live question, or is this a paper to note and not to use?
2. **Does the guard idea hold up?** If we changed how a served model executes,
   would a damaged reward subsystem show up as unexplained accuracy loss
   elsewhere? What would we have to keep around to notice it — a probe, a
   reference AUC, a test?
3. **Would we even be able to run this on our models?** The probe needs a
   labelled reasoning set and access to hidden states. Our models run behind
   Ollama through the Housekeeper. Does the inference path expose hidden
   states at all, or would this need a new surface?
4. **Is the confidence gain worth anything here?** 0.67 AUC against 0.60 for a
   probe on the full hidden state. Our alternatives are verbal confidence and
   log-probability, which are worse. Is a better-but-still-weak signal useful
   for deciding whether to spend more compute on a turn?
5. **What is the honest headline?** If a summary of this paper said only the
   true things, what would it be — and is that the kind of claim we want to
   make about our own runtime, or only about the paper?
6. **Where should this land if it lands?** A reference note, a decision, or a
   roadmap package — and what is the acceptance criterion that would tell us
   the observation is done?
