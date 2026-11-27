# Vocabulary operations on dev-vocab

This is the operator guide for agents maintaining Pyash atoms, compounds, English
forms, WordNet links, Chinese character links, and the active WordNet compound
sweep. Follow it without relying on earlier chat history. The related skills and
technical references explain subsystem details; this guide controls the safe
order of operations.

## 1. Confirm the checkout before acting

Vocabulary work belongs on dev-vocab. Do not edit it on dev,
dev-vliw-backend, or the separate /home/htaf/pyash checkout.

In the local workspace, check:

~~~sh
git branch --show-current
git status --short
~~~

For the vocabulary checkout on zvorygin, check:

~~~sh
ssh zvorygin 'cd /home/htaf/pyash-vocab-sweep && git branch --show-current && git status --short'
~~~

The expected remote checkout is /home/htaf/pyash-vocab-sweep on
dev-vocab. Stop before editing or running a sweep if the host, path, or branch
does not match. Preserve every existing change in git status; sweep-owned
catalogs may be changing while the process runs. Never reset, clean, stash, or
switch the active sweep checkout to make it look clean. The /home/htaf/pyash
checkout is a different branch and is not the vocabulary workspace.

Use the configured GPU Housekeeper for every model call. Do not call Ollama or
another model endpoint directly. For real work, ensure fixture variables such
as PYA_MIND_RESPONSE and PYA_*_FIXTURE are unset.

## 2. Pick the operation and its source of truth

| Need | Start here | How to read the result |
| --- | --- | --- |
| Look up an English term or one WordNet sense | <code>kwon TERM</code> or <code>kwon n:07558676-n</code> | A WordNet link is sense-specific; a lemma match alone does not prove a link. |
| Count currently linked WordNet senses | <code>node command/wordnet_link_coverage.mjs</code> | Read atom links, compound links, overlap, and unresolved bridge rows separately. |
| Check the running compound sweep without starting work | Run the read-only <code>inspectWordnetSweep</code> command below | <code>state</code> and <code>remainingSenseCount</code> describe the configured run; inspect the artifact timestamp and lock too. |
| Inspect a sweep decision or prompt | Read the run's <code>.pya</code> artifact with <code>node command/pya_to_json.mjs PATH --pretty</code> | Use <code>progress.pya</code>, <code>component-compositions.pya</code>, <code>sense-compound-decisions.pya</code>, and <code>translation-failures.pya</code>; avoid dumping a large newspaper. |
| Inspect a translation-to-VLIW run | <code>node command/read_translation_refinery.mjs RUN_ID [CHECKPOINT_CWD]</code> | This reads saved checkpoints; it does not rerun the translation. |
| Add an atom, compound, or sense link | Follow “Add or update a vocabulary entry” below | Write to the canonical catalog, then run the narrow validation and refresh derived indexes if needed. |

From the repository root on zvorygin, the sweep status command is:

~~~sh
node --input-type=module -e 'import { inspectWordnetSweep } from "./world/house/refinery-watchdog/program/run-wordnet-sweep-watchdog.mjs"; console.log(JSON.stringify(await inspectWordnetSweep(), null, 2));'
~~~

It reads the configured run's lock and durable artifacts. It does not submit a
model job or restart the sweep. To check the whole linked-sense total, use
wordnet_link_coverage.mjs; that total is not the same as the sweep's remaining
queue.

## 3. Monitor or recover the existing sweep

The configured run id, artifact path, newspaper, recovery policy, and model are
in <code>world/house/refinery-watchdog/conduct/wordnet-sweep-recovery.pya</code>.
The refinery configuration is in
<code>program/library/translation/wordnet_sense_compound_refinery.pya</code>.

1. Check the read-only sweep status and confirm the run id.
2. If state is healthy, leave the process alone. New durable writes and an
   active lock mean it is working, even when the Housekeeper queue is busy.
3. If state is complete, do not restart it.
4. If it is stopped or stalled, run
   node world/house/refinery-watchdog/program/run-wordnet-sweep-watchdog.mjs.
   This command can submit a recovery decision through Housekeeper and resume
   the same configured run. Inspect its saved status and verify new progress
   before reporting success.
5. If state is lock_conflict, or recovery reports a live conflicting process,
   stop and inspect the process and lock owner. Never delete the lock by hand or
   start a second sweep.

<code>node world/house/refinery-watchdog/program/resume-wordnet-sweep.mjs</code> is the
configured resume entry point. Use it only for the same stable run id under a
persistent supervisor, after confirming no live process owns the lock. A raw
<code>node command/wordnet_sense_compound_refinery.mjs</code> invocation starts refinery
work; it is not a status command. Do not launch it to find out how much work is
left.

The batch limit is configured in Pyash and is currently 64 senses. Preserve the
stable run id and append-only artifacts across resumes. Do not expand the batch
to the full backlog. An uncertain or rejected decision is not a transient
failure; do not automatically rerun it. Retry only a specifically identified
sense after reading its failure or decision evidence.

The watchdog cron cadence comes from
<code>world/house/refinery-watchdog/conduct/calendar.pya</code>. The current configured
value is every 10 minutes; the installer reads that calendar. The watchdog
only seeks recovery after its health checks indicate a stopped, stalled, or
conflicting run. Confirm the installed crontab when schedule state matters.

## 4. Read outcomes correctly

For the broad sense-compound sweep:

- accepted means the sense has an accepted compound promoted to the active
  derived catalog, or the same accepted compound was already active.
- uncertain means the semantic composition could not be selected confidently.
- rejected means the proposed composition failed a semantic or deterministic
  check.
- no-compound-candidate means the current covered atoms supplied no usable
  decomposition; it is not a model rejection.
- failed means an operational, provider, parser, or persistence failure.
  Inspect translation-failures.pya, the relevant decision artifact, and the
  Housekeeper error before deciding whether to retry.
- pending means the sense has not reached a recorded outcome.

Keep the denominators straight. The accepted-candidate percentage is over
senses that produced compound candidates, not the entire worklist. Total linked
WordNet senses, current queue remaining, completed sense outcomes, and component
candidate decisions are different counts.

For English document translation, sense selection and sense linking are
separate stages. A selected WordNet sense with status: review and link: null
is not linked. A failed Housekeeper job is neither an uncertain nor a rejected
model decision. Nonselectable WordNet relation anchors are evidence only; they
are not allowed link choices. A selectable anchor can still be a bad semantic
match, so inspect its meaning before trusting a proposed attachment.

### Example: the Love paragraph attachment attempt

That run selected seven WordNet senses, but saved all seven as review with no
link. The attachment review calls failed with a Housekeeper 400 reporting that
the handle id was already registered with different job content. No model
verdict was returned.

The saved anchors illustrate why candidate presence is not success. For
caring, the only selectable entries were existing Pyash compounds glossed
dry nurse, attend, and realise; for marriage, the selectable entry was
natural law. They are not good links for the selected senses. Other listed
entries, such as nurse, nurture, married, and monogamy, were nonselectable
relation evidence. Do not count these as linked words.

That refinery has a compound-candidate builder, but it only runs when there is
no accepted direct link, no exact covered anchor, and no selectable existing
anchor, and a verifier is configured. It derives closed candidates from
existing dictionary and morphology coverage; it is not an open-ended semantic
composer. Weak selectable relation compounds can therefore block new
compound generation. The separate translation pipeline stage named
refine compounds translates compounds already in the catalog; it does not
invent new ones. When these limits leave a sense uncovered, report the gap
rather than treating a related atom or compound as an equivalent.

## 5. Add or update a vocabulary entry

First inspect the intended meaning with
<code>node command/vocab_suggest.mjs "ENGLISH TERM"</code>, <code>kwon TERM</code>,
and, for a specific sense, <code>kwon n:07558676-n</code>. Prefer the
POS-qualified synset as
the identity when linking to WordNet.

| Entry type | Use | Acceptance boundary |
| --- | --- | --- |
| New atom | <code>node command/vocab_atom_suggest.mjs "CONCEPT"</code> | This is a proposal. Add to <code>program/library/pyashWords.json</code> only when the concept, form, and encoding are supported and do not collide. Stop on semantic ambiguity. See “Atom word proposals” in the translation README for the accepted record shape. |
| Compound from existing atoms | <code>node command/compound_catalog_add.mjs "TARGET" "GLOSS" MODIFIER HEAD</code> | Components must be existing atoms; order them head-final, with the head last. |
| WordNet sense link or review status | Create a one-entry .pya map and run <code>node command/vocabulary_entry_review.mjs ENTRY.pya</code> | Record the POS-qualified sense, target, Pyash sequence, evidence, and status. A review-needed entry is not an active link. |
| Chinese character link | Follow <code>skills/pyash-chinese-character-atom-refinery/SKILL.md</code> | Update the accepted overlay; do not edit acquired source data or generated indexes. |
| English form, spelling, or inflection | Update the appropriate anchor or <code>english_lemmas.pya</code> mapping | Do not create a duplicate atom just to cover a form. |

For a manually curated review of one exact sense, the input map must contain
<code>target</code>, <code>gloss</code>, <code>pyash</code>, <code>sense-id</code>,
<code>review-status</code>, and <code>evidence</code>. Add
<code>model-status</code> only to preserve a prior model decision. Use
<code>review-needed</code> to record review without creating an active link;
<code>accepted-curated</code> is a curated link decision. Do not use a manual
curated entry to convert a failed or uncertain automatic decision into an
acceptance.

accepted-llm is an accepted vocabulary outcome in this workflow; do not add a
second manual approval step when that status has already been promoted into its
canonical active catalog. Verify the active catalog row before reporting it as
available. Keep uncertain or rejected proposals out of the active catalog.

The canonical sources include <code>program/library/pyashWords.json</code>,
<code>compound_coverage_curated.pya</code>,
<code>compound_coverage_wordnet_verified.pya</code>,
<code>english_wordnet_bridges.pya</code>,
<code>english_wordnet_compound_glosses.pya</code>,
<code>english_lemmas.pya</code>, and
<code>chinese_character_atom_links.pya</code>. Generated
<code>kwon_*_index.pya</code> files are
sidecars, not source records. Run node command/vocab_lookup_index.mjs after a
canonical edit when the new entry needs to be visible to Kwon immediately;
never hand-edit an index.

## 6. Validate, publish, and commit

Run the narrow checks for the edited entry type:

~~~sh
# Atoms and Pyac encodings
node --test quiz/translation_atom_word_generation.test.mjs quiz/vliw_word_code.test.mjs

# Curated compounds and lookup coverage
node --test quiz/translation_compound_catalog.test.mjs quiz/translation_compound_lexicon.test.mjs quiz/translation_compound_coverage.test.mjs quiz/vocab_suggest_compounds.test.mjs

# WordNet sense links and attachment review
node --test quiz/translation_english_wordnet_linker.test.mjs quiz/translation_english_wordnet_refinery.test.mjs quiz/translation_vocabulary_queue.test.mjs quiz/translation_english_wordnet_bridges.test.mjs

# English anchors and Chinese character links
node --test quiz/translation_anchor_words.test.mjs quiz/translation_chinese_character_atom_refinery.test.mjs
~~~

Then query the entry through <code>kwon</code> or <code>pyash dict</code> and
rerun <code>node command/wordnet_link_coverage.mjs</code> when a WordNet link
changed. Rebuild the VLIW reference snapshot only when the task includes
publishing that dictionary:
<code>node program/library/dictionary/build_reference_source.mjs</code>.

Before committing:

1. Check <code>git status --short</code> and stage only the intended code and promoted
   vocabulary. Do not add ignored run artifacts, newspapers, prompts, responses,
   or bulk decision history for rejected, uncertain, or failed candidates. If a
   tracked decision ledger changes, isolate the minimum accepted promotion
   record required by the active catalog; report a conflict with the
   promoted-vocabulary-only policy instead of staging the whole ledger.
2. Confirm every accepted entry is present in its canonical active catalog and
   every generated index or dictionary projection is reproducible.
3. Commit on dev-vocab with a short lower-case imperative message. Push with
   <code>bash command/push_all.sh</code>; never force-push or publish these
   changes to dev or dev-vliw-backend.

### Committing promoted output while a sweep is running

A healthy sweep keeps writing. Commit the vocabulary it has already produced
without disturbing it, and expect the working tree to stay dirty afterwards.

The decision ledger is intentionally larger on the host than in the commit. The
host keeps the full campaign history; the commit carries only the accepted
promotion records. Never rewrite, reset, restore, or clean the ledger to make
the tree tidy, and never commit the whole file. Do not restart a healthy sweep
and do not stage anything the sweep is writing at that moment.

Derive the required ledger rows instead of guessing them:

1. Take the rows of <code>compound_coverage_wordnet_verified.pya</code> whose
   sense id is absent from the committed version. These are the newly promoted
   senses.
2. Read their <code>verificationDecisionId</code> and
   <code>verificationDecisionIds</code> values.
3. Resolve every referenced id in the ledger and confirm each one is
   <code>accepted-llm</code>, <code>accepted-deterministic</code>, or
   <code>repaired-llm</code>. If a referenced row is rejected, uncertain, or
   missing, stop and report it instead of staging it.
4. Stage only those accepted rows. Do not rewrite the live ledger file: the
   sweep holds an in-memory offset index over it, so a rewrite would point that
   index at the wrong lines. Build the isolated file from the committed ledger
   plus the accepted rows above, confirm it still parses with
   <code>parseEnglishWordNetCompoundDecisions</code>, and stage it as a blob
   while leaving the working file as the sweep wrote it:

   ~~~sh
   git hash-object -w /tmp/filtered_ledger.pya
   git update-index --cacheinfo <mode>,<blob>,program/library/translation/english_wordnet_compound_decisions.pya
   ~~~

Record the count checks in the commit body: promoted catalog rows added, gloss
rows added, isolated ledger rows added, and the number of referenced decisions
verified accepted. Keep the subject short and lower case.

Refresh the lookup indexes from the catalogs that are about to be committed:

~~~sh
node command/vocab_lookup_index.mjs
~~~

The hourly refresh in <code>conduct/calendar.pya</code> can run before the
newest catalog writes, so its output can be one batch stale. Run the rebuild
after a stable batch, confirm the index files are newer than the catalogs they
were built from, and confirm the newly promoted sense ids appear in the rebuilt
wordnet index.

The generated dictionary snapshot is a separate blocked task.
<code>program/library/dictionary/reference.pya</code> is built from the promoted
catalogs plus the SUMO mapping source
<code>know/sumo/pyash_wordnet_mappings.pya</code>. A host without that source
cannot rebuild it. Do not fabricate the input and do not hand-edit the
generated snapshot. Rebuild it in an environment that has the source, then
verify that it matches the promoted catalogs before publishing it.

The generated catalogs exceed GitHub's 50 MB recommendation. Treat any move to
Git LFS as its own decision, taken separately from a sweep and never while one
is running.

The GitLab remote enforces a 100 MiB limit per blob, and a pre-receive hook
rejects the entire push when one file crosses it. The committed ledger
therefore stores one row per decision id: keep the last row for each id, drop
the superseded ones, and confirm that the parsed state is identical before
staging. A compacted ledger parses to exactly the same rows and the same id
set as the file it replaces, because the loader keeps the last row for an id.

Each committed row costs about 9 KB, so roughly 10,500 rows fit under the
limit. When the remaining sense count would push the committed ledger past
that, stop and report it instead of pushing. The remedy is a storage decision
- Git LFS for that one file, or a shorter retention window for committed
decisions - and it must be taken separately from a sweep, never while one is
running.

## 7. Run the SUMO concept sweep

The SUMO concept sweep links SUMO concepts that have no link to the Pyash
entry carrying their own meaning. It is a separate sweep from the WordNet
compound sweep: it never writes compounds, and it never restarts the WordNet
sweep. The design, the measured universe, and the relation semantics are in
[the SUMO concept sweep reference](../reference/sumo-concept-sweep.md).

The refinery configuration is in
<code>program/library/translation/sumo_concept_refinery.pya</code> and the
promoted catalog is
<code>program/library/translation/sumo_concept_links.pya</code>.

### Host inputs

The sweep needs two local-only inputs that are not in the repository:

- <code>know/sumo/pyash_wordnet_mappings.pya</code>, the SUMO crosswalk
  catalog. It is git-ignored, so copy it to the sweep host and verify its
  checksum against the source.
- <code>know/sumo/ontology</code>, a checkout of
  <code>github.com/ontologyportal/sumo</code> at the pinned revision
  <code>f0c126842d098a312e390479b38ecfbac018f8ed</code>. The loader refuses any
  other revision, so a checkout that drifts is a hard failure rather than a
  silent catalog change.

### Run a pilot first

The batch limit is 64 concepts, the same bound the WordNet sweep uses. Start
with a pilot that mixes the evidence paths, then read the artifacts before
running the backlog:

~~~sh
ssh zvorygin 'cd /home/htaf/pyash-vocab-sweep && node command/sumo_concept_refinery.mjs'
~~~

A pilot over a named set of concepts uses the same command; pass the concept
ids through the command's configuration rather than editing the config file.
The run writes its worklist, candidate rows, and decisions under
<code>artifacts/&lt;run-id&gt;/</code>.

Read <code>concept-worklist.pya</code> first, then
<code>concept-candidates.pya</code>, then <code>concept-decisions.pya</code>.
An uncertain or rejected decision is not a transient failure. Do not rerun it
without reading its evidence.

### Run the backlog under a supervisor

The backlog runs for hours, so it needs a supervisor that outlives the agent
that starts it. A user service with lingering enabled keeps it running across
sessions:

~~~ini
# ~/.config/systemd/user/pyash-sumo-concept-sweep.service
[Unit]
Description=Pyash SUMO concept sweep
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/htaf/pyash-vocab-sweep
Environment=PYA_GPU_HOUSEKEEPER_URL=http://mriczo:18886
ExecStart=/usr/bin/env -u PYA_MIND_RESPONSE node --max-old-space-size=8192 command/sumo_concept_refinery.mjs
Restart=on-failure
RestartSec=90
StandardOutput=append:/home/htaf/pyash-vocab-sweep/artifacts/logs/sumo-sweep.log
StandardError=append:/home/htaf/pyash-vocab-sweep/artifacts/logs/sumo-sweep.log

[Install]
WantedBy=default.target
~~~

Start it with <code>systemctl --user start pyash-sumo-concept-sweep.service</code>
and read progress from <code>artifacts/logs/sumo-sweep.log</code>. The
remaining count in each batch line falls as concepts leave the queue. Stop it
with <code>systemctl --user stop pyash-sumo-concept-sweep.service</code>; the
run lock is released when the process exits, and a stale lock is reclaimed on
the next start.

The service writes the promoted catalog into the working tree on every batch.
Commit that catalog separately, and never stage the run artifacts, the
newspaper, or the WordNet decision ledger with it.

### Repair a promoted relation

The relation of a promoted link is derived from the evidence, never from the
model. A catalog row whose relation does not follow from its evidence is
rewritten by one command:

~~~sh
node command/sumo_concept_link_relations.mjs
~~~

The command reports every transition it made and rewrites the catalog in
place. It changes the relation only; the identifiers, the target, and the
recorded evidence stay as they are.

### Promote and publish

Accepted links are written to
<code>program/library/translation/sumo_concept_links.pya</code>, one row per
SUMO concept, keyed by concept id so a later run replaces an earlier decision
instead of appending a duplicate. The record keeps the SUMO identifier, the
Pyash sequence, the relation, the evidence that produced it, and the
provenance. It never carries the SUMO definition: the ontology is read-only
evidence, and its definitions are model input only.

After promotion, rebuild the reference snapshot so the new source links reach
the dictionary, then rebuild the lookup sidecars:

~~~sh
node program/library/dictionary/build_reference_source.mjs
node command/vocab_lookup_index.mjs
~~~

## References

- [Translation and WordNet pipeline](../../program/library/translation/README.md)
- [Vocabulary tooling skill](../../skills/pyash-vocab-tooling/SKILL.md)
- [Translation maintenance skill](../../skills/pyash-translation-maintenance/SKILL.md)
- [Refinery recovery](./reporter-refinery-recovery.md) for the generic newspaper
  and recovery model; use the WordNet-specific procedures in this guide for the
  vocabulary sweep.
- [Kwon lookup indexes](../reference/kwon-lookup-indexes.md) for sidecar index
  formats and source data.
