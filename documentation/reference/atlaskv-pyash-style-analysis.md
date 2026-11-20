# AtlasKV and Pyash style analysis

Status: working reference. Written 2026-11-19 from arXiv:2510.17934v2
("AtlasKV: Augmenting LLMs with Billion-Scale Knowledge Graphs in 20GB VRAM",
Huang, Tsang, Bai, Peng, Zhang, Song; ICLR 2026; v1 2025-10-20, v2 2026-04-13).
Read in full: main body (10 pages) and appendices A-J (16 pages). This is an
analysis of the paper against the current Pyash codebase, not a claim that the
paper's own evidence is stronger than it is.

## 1. What the paper actually does

AtlasKV is a *parametric* knowledge-integration method for LLMs. It does not
retrieve text at inference time and does not retrain when a new knowledge base
arrives. Instead it:

1. **KG2KV** turns each KG triple `(h, r, t)` into a query/key/value triple.
   The head or tail entity is masked, the relation is rewritten into a noun
   chosen by mask position (`because` becomes `cause` when the tail is masked,
   `result` when the head is masked), and the key is the surviving entity plus
   that noun. The masked entity is the value the model must produce.
   Query strings are built by prefixing questioning forms to the key.
2. **HiKVP** clusters the resulting key embeddings with UMAP + GMM into three
   layers with cluster size `S = M^(1/3)`. At inference, root-layer keys stay on
   GPU, the rest are offloaded to CPU; top-k selection descends root -> inter ->
   leaf, and only the selected leaf values are fetched for attention.

Claimed complexity is `O((C_t * M^(1/3) + N) * N * D)` time and
`O((C_m * M^(1/3) + N) * (N + D))` memory, giving sub-20GB VRAM at 1B triples.
The only learned parameters are KG-specific query and projection heads
(`W_Q`, `W_K`, `W_V`), trained for 3K steps on 20K sampled triples with the
original LLM objective. Baselines are ICL/RAG, KBLaM, and zero-shot.

## 2. The central relationship

| Pyash idea | AtlasKV artifact | What actually transfers |
| --- | --- | --- |
| claim identity: `su` / `be` / `as` + `mood`, canonicalized by `deriveClaimKey` (`program/library/knowledge_core.mjs`) | triple `(h, r, t)` split into key (unmasked entity + relation) and value (masked entity) | the decomposition itself: a fact's identity is a canonical text key, and the answer is the masked slot |
| predicate normalization via `resolveVerbAlias` (`program/library/verbAliases.mjs`, `program/library/verb_aliases.json`) | relation rewritten to a noun by mask position, via an LLM prompt (Appendix H) | the *idea* that relation phrasing carries the enquiry attribute; Pyash already does this deterministically |
| `evidential` (`direct`/`reported`/`inferential`) and required `fromtext` source anchor on every claim | grounding measured from KG-branch attention mass at layer 15 | Pyash's evidence discipline is the stronger form of the same idea, enforced at write time instead of measured after the fact |
| Kwon lookup sidecar indexes over English terms, Pyac forms, POS-qualified senses, raw synsets (`documentation/reference/kwon-lookup-indexes.md`) | UMAP+GMM hierarchical key index with a resident root tier | hierarchical *shape* is reusable; the embedding machinery is not needed at Pyash scale |
| Housekeeper VRAM admission and residency policy (`documentation/reference/gpu-housekeeper-vram-calibration.md`, `documentation/reference/gpu-housekeeper-architecture.md`) | CPU/GPU tiering with per-query offload | the tiering pattern is the one genuinely reusable systems idea |
| iWSP plan requires inspectable candidate semantics and reproducible provenance (`documentation/suggest/iwsp-pyash-implementation-plan.md` 4.1, 6.4) | knowledge injected into attention parameters | nothing transfers; injected KV cannot be read back or replayed |

## 3. Why the paper's motivation does not bind on Pyash

**Control of the model.** AtlasKV needs the weights and the attention
implementation in one process. In Pyash the mind is a separate service: Ollama
or `llama-server` reached over HTTP through `program/motor/ollama.mjs` and the
Housekeeper runtime (`container/gpu-housekeeper`). Pyash chooses the model and
`num_ctx`; it does not own the attention stack. Injecting KV pairs is therefore
not implementable in Pyash without replacing the mind server, which would
discard the property the whole design depends on: the mind is disposable and the
facts are not.

**Scale.** The paper targets 1B triples. Pyash's knowledge surface is the
WordNet/SUMO sense catalog, the Kwon translation catalogs, and per-house fact
stores - orders of magnitude smaller, and queried by exact name plus POS, not
by embedding similarity. The paper's binding constraint (VRAM for KG size) is
not Pyash's binding constraint (context budget and lookup latency in the
coding saddle).

**Inspectability.** The iWSP plan is explicit that a candidate must be
inspectable source plus named facts, that history must be reproducible and
auditable, and that the text-bottleneck test applies. A parametric knowledge
store satisfies none of these by construction: there is no artifact to print,
diff, replay, or checkpoint. Pyash's answer to the same problem is the opposite
design choice - knowledge stays in sentences, so it can be read.

## 4. What is worth taking

**a. The relation-rewriting lever, in Pyash's own deterministic form.** The
paper's ablation (B.2, F.3) shows attribute phrasing matters: rewriting
relations into attribute nouns improves grounding, and dropping it costs
accuracy at large KG sizes. That is the same lever as Pyash's `be` predicate
normalization, and Pyash already pulls it with a table instead of a prompt.
The practical lesson is inverted relative to the paper: use the deterministic
normalizer, and treat an LLM-rewritten vocabulary as a last resort, since it
invents nouns outside `program/library/pyashWords.json` and would have to pass
`command/vocab_suggest.mjs` anyway.

**b. Hierarchical keys, if and only if the flat index stops being enough.** The
Kwon reference already records the deferred item: "Binary VLIW encoding is
deferred until the `.pya` indexes have been measured against real `kwon`
workloads." HiKVP is prior art for what a tiered version of that looks like -
clustered keys with `M^(1/3)` resident and the rest staged. The correct order
is still measure first, then build, because Pyash's queries are exact surface
names: a hash or prefix hierarchy over the existing postings would deliver the
same asymptotics without an encoder, UMAP, or GMM in the path.

**c. The tiering pattern for Housekeeper.** Root keys resident, remainder
staged, only selected leaves fetched - that is a residency policy for the
Housekeeper's admission layer, and it composes with the existing
`residencyName` / `residencyRequired` duty fields. It is only worth building if
Pyash ever holds a knowledge store large enough to matter, which today it does
not.

**d. Coverage beats noise, and the shape of the ablation.** Appendix B.5 shows
the larger sub-KG scores markedly better even with more injected noise. The
Pyash analogue is that widening linked senses and compounds helps grounding
more than it adds confusion - provided the links stay inspectable, which is the
one thing parametric injection cannot offer.

**e. Entity/event mixing.** Table 4 is the most transferable result in the
paper: named-only and event-only KG2KV both degrade grounding, and mixing them
is best. The reading for Pyash is that a sense link is worth more when it
connects a concrete entity to an abstract concept, which is the same shape as
Pyash's compound coverage and bridge links between a Pyash name and its
WordNet sense.

## 5. Where Pyash is already stronger

| Property | AtlasKV | Pyash |
| --- | --- | --- |
| grounding | post-hoc attention mass at layer 15 | evidential + mandatory `fromtext` source anchor on every recorded claim (`normalizeEvidence`, called from the bridge at `program/bridge/index.mjs:423`) |
| vocabulary control | LLM invents attribute nouns at scale | fixed controlled vocabulary, alias table, `vocab_suggest` guard |
| relation normalization | LLM prompt per relation (Appendix H) | deterministic `resolveVerbAlias` |
| graph structure | triples flattened into independent facts (paper's limitation 1) | compounds, bridges, sense links, and ceremonies keep structure |
| reproducibility | knowledge is in parameters, not replayable | claims are sentences; `pya_to_json`, traces, checkpoints |
| correctness evidence | attention proxy + GPT-4o relevance judge | claim key, shape and type checks, independent evaluator (iWSP 7.3) |

## 6. What not to take

1. **Do not attempt attention injection.** The mind is a remote service; the
   mechanism is unreachable, and the inspectability loss contradicts the plan.
2. **Do not flatten.** The paper lists graph-structure loss as its first
   limitation; Pyash's whole reason for existing next to a plain LLM is that
   its knowledge is structured and addressable.
3. **Do not read "training-free" literally.** The new-KB path still requires
   the learned heads (3K steps of tuning) plus per-relation LLM rewriting to
   build KGKV for the incoming graph. The claim is "no retraining for a new KB
   after base tuning", not "no training".
4. **Do not adopt attention mass as a correctness signal.** It measures whether
   the model attended to a key, not whether the claim it emitted is true.

## 7. Reading the paper's evidence

- **Evaluation size.** The reported accuracies are multiples of 1/110 (3.6, 5.5,
  9.1, 12.7, 16.4, 20.0, 23.6, 29.1, 41.8, 50.0, 70.9, 90.9, 100.0 ...), so
  each cell is n=110, inferred from the grid rather than stated in the paper.
  At n=110 the binomial standard error near p=0.5 is about 4.8 points, so
  differences under roughly 10 points are inside one standard deviation. Some
  headline gains survive this (e.g. +47.2 on ATLAS-Pes2o ACC@1, +27.3 on
  ATLAS-CC); others in the same tables do not (e.g. +7.3, +9.1, +12.7 on
  Enron-scale rows). The paper does not report confidence intervals.
- **One backbone, one judge.** LLaMA3.1-8B-Instruct only, bfloat16, one 48GB
  GPU, with GPT-4o as the relevance judge. The grounding metric itself is
  internal (KG-branch attention scores at layer 15, averaged over heads), which
  is cheap and repeatable but is not task correctness.
- **The sample output shows the metric tolerating corruption.** Figure 9's
  AtlasKV answer ("The opinion of MOROCCO is issue of synthetic biology should
  be considered a new frontier.") is a degraded rewrite of the correct triple,
  yet it is presented as the good outcome. An attention-grounded metric and a
  relevance judge both accept it. Pyash's shape check and source-anchored
  claim would not.
- **"1B triples in 20GB VRAM" moves cost rather than removing it.** The root
  tier is `M^(1/3)` keys, so GPU memory is small by construction, but the
  KGKV base embeddings still have to exist off-GPU: 1B triples at 384 dims in
  fp16 is roughly 768 GB of host storage, and the paper states embeddings are
  computed offline and loaded from disk. Appendix F.2 prices the offload:
  4.10s at 1e1 triples rising to 6.21s at 1e4, against 2.09s unpruned - the
  sub-linear scaling is bought with I/O latency and host memory that the
  headline number does not mention.
- **The interesting ablation is not the scalability one.** Table 4 (entity vs
  event composition) is more informative for Pyash than Table 3 (accuracy vs
  KBLaM), because it is about how knowledge should be shaped rather than about
  beating a baseline on a proxy metric.

## 8. Bounded next actions

1. **Runtime: no change.** Nothing in this paper justifies touching the mind
   path, the claim store, or the VLIW pipeline.
2. **Sense lookup, when iWSP needs it.** The gap recorded in the plan (4.4) is
   a name-to-sense runtime lookup. Build the flat exact-name-plus-POS index
   first, reusing the Kwon posting machinery; only add a hierarchy if
   measurements of real `kwon` workloads justify it - which is the same order
   the Kwon reference already prescribes for binary VLIW encoding.
3. **Housekeeper:** no action. Record the root-tier residency pattern as a
   candidate policy for a future large knowledge store; do not implement it
   speculatively.
4. **Keep the evidence discipline where it is.** Claim key, evidential, and
   source anchor remain the grounding instrument. The paper offers no stronger
   substitute, only a cheaper and weaker one.
5. **Vocabulary:** if attribute phrasing ever needs to be generated rather than
   looked up, generate it through the alias table and `vocab_suggest`, never
   through a free-form prompt.

## 9. Sources

Paper: arXiv:2510.17934v2 - abstract and method (1-10), appendix A training and
evaluation settings, appendix B extended experiments (B.1 encoders, B.2
relation rewriting, B.3 injection frequency, B.4 top-k, B.5 coverage), appendix
C attention derivation, appendix D complexity derivation, appendix F trade-offs
(F.1 accuracy vs scalability, F.2 latency, F.3 KG2KV cost), appendix H prompt
templates, appendix J limitations.

Repository paths cited: `program/library/knowledge_core.mjs`,
`program/library/verbAliases.mjs`, `program/library/verb_aliases.json`,
`program/library/pyashWords.json`, `program/library/translation/english_wordnet_linker.mjs`,
`program/motor/ollama.mjs`, `documentation/reference/kwon-lookup-indexes.md`,
`documentation/reference/gpu-housekeeper-architecture.md`,
`documentation/reference/gpu-housekeeper-vram-calibration.md`,
`documentation/suggest/iwsp-pyash-implementation-plan.md`,
`command/vocab_suggest.mjs`.
