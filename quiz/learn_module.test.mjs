import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("learn module exports text and filename learning ceremonies", async () => {
  const text = await fs.readFile(new URL("../module/learn.pya", import.meta.url), "utf8");

  assert.match(text, /exists su name learning source support verify mind be mind fromtext name learning source support verify prompt ya/u);
  assert.match(text, /Do not flatten the source into generic academic, managerial, sociological, dictionary, or textbook language\./u);
  assert.match(text, /Preserve the source's actual ontology, symbolic world, and mode of causation when distilling the teaching\./u);
  assert.match(text, /do not replace those with generic abstractions like resources, authority, compliance, leverage, enforcement, persuasion, or social control unless the source itself clearly does so\./u);
  assert.match(text, /Prefer communal declarative phrasing that states what is true, practiced, or learned\./u);
  assert.match(text, /Avoid direct second-person instruction and bare imperative phrasing when a declarative teaching line will do\./u);
  assert.match(text, /Each section should default to declarative teaching statements, not advice commands\./u);
  assert.match(text, /Prefer SEED CONCEPT and CARDINAL TRAINING SENTENCE to say what the teaching is and how it works, not mainly what it is not\./u);
  assert.match(text, /Put paradoxes, corrections, negation-heavy clarifications, and common misunderstandings mainly in SURPRISES AND MISUNDERSTANDINGS rather than loading them into SEED CONCEPT\./u);
  assert.match(text, /When the source expresses a valid idea in contrastive form, prefer rewriting it into positive declarative form for SEED CONCEPT and CARDINAL TRAINING SENTENCE/u);
  assert.match(text, /SURPRISES AND MISUNDERSTANDINGS/u);
  assert.match(text, /SEED CONCEPT: 1 short paragraph or 1-2 sentences\. Prefer positive declarative explanation of the core idea, system, or reality named by the source\./u);
  assert.match(text, /Rewrite contrast-shaped source material into positive declarative teaching whenever the meaning can stay faithful\./u);
  assert.match(text, /SEED CONCEPT: do not collapse a spiritually, symbolically, or metaphysically specific teaching into a generic definition that could fit an unrelated textbook or management guide\./u);
  assert.match(text, /CARDINAL TRAINING SENTENCE: exactly 1 short sentence, clear enough for a 12 year old, and written as a declarative teaching sentence rather than a command\. Prefer a short affirmative operating truth, not a negation-heavy warning or correction, unless the source gives no stronger declarative line\./u);
  assert.match(text, /Prefer a positive teaching sentence over contrastive wording when the same meaning can be stated cleanly\./u);
  assert.match(text, /Avoid subordinate explanation, stacked clauses, or multi-step summary inside this sentence\./u);
  assert.match(text, /CARDINAL TRAINING SENTENCE: keep the sentence native to the source's actual teaching world; do not rewrite it into generic institutional or behavioral advice that the source itself does not support\./u);
  assert.match(text, /TEACHING PROGRESSION: 3-6 short lines showing the main stages by which the concept becomes understandable and teachable\./u);
  assert.match(text, /Keep these lines about unfolding understanding, not about misunderstanding correction, polemic contrast, or downstream consequence\./u);
  assert.match(text, /SURPRISES AND MISUNDERSTANDINGS: 2-5 short lines naming source-supported paradoxes, corrections, surprises, or common misunderstandings clarified by the source\./u);
  assert.match(text, /BRIEF MEMORY PHRASES: 4-8 short lines, each 2-6 words, preferably short declarative refrain-like phrases rather than commands\./u);
  assert.match(text, /Do not restate whole teachings or explanations here\./u);
  assert.match(text, /CONCEPT RELATIONS: 2-4 short lines showing how this concept connects to nearby ideas in the same source document\./u);
  assert.match(text, /Keep these links brief and specific; do not let this section become another summary of the full concept\./u);
  assert.match(text, /exists su name learning merge prompt ob text quoted\.text\./u);
  assert.match(text, /Keep affirmative definition concentrated in SEED CONCEPT and CARDINAL TRAINING SENTENCE when the cards support it\./u);
  assert.match(text, /Rewrite contrast-shaped seed wording into positive declarative form when the merged cards already support the same meaning\./u);
  assert.match(text, /Keep CARDINAL TRAINING SENTENCE short and portable\. Do not let it absorb extra explanation that belongs in other sections\./u);
  assert.match(text, /Keep TEACHING PROGRESSION focused on the ordered unfolding of understanding\. Move correction-heavy, paradox-heavy, and consequence-heavy lines into the sections built for them\./u);
  assert.match(text, /Keep CONCEPT RELATIONS brief and local to nearby source ideas instead of using it as a second summary section\./u);
  assert.match(text, /Keep BRIEF MEMORY PHRASES genuinely brief and refrain-like; trim explanatory phrases\./u);
  assert.match(text, /Do not merge toward the lowest-common-denominator summary if the cards share a more specific spiritual, symbolic, or metaphysical teaching world\./u);
  assert.match(text, /exists su name learning refine prompt ob text quoted\.text\./u);
  assert.match(text, /Strengthen affirmative declarative wording in SEED CONCEPT and CARDINAL TRAINING SENTENCE when the draft already supports it\./u);
  assert.match(text, /Rewrite rather-than, instead-of, or not-this-but-that seed wording into positive declarative teaching when the draft already supports the same meaning\./u);
  assert.match(text, /Shorten CARDINAL TRAINING SENTENCE until it feels like one portable operating truth rather than a compressed paragraph\./u);
  assert.match(text, /Keep TEACHING PROGRESSION as ordered understanding steps, not a hidden misunderstanding section or a hidden consequence section\./u);
  assert.match(text, /Trim CONCEPT RELATIONS into brief nearby links rather than another explanatory section\./u);
  assert.match(text, /Trim BRIEF MEMORY PHRASES into short refrain-like fragments rather than mini-summaries\./u);
  assert.match(text, /Do not refine the card into a more generic, secular, institutional, or textbook-sounding artifact than the draft already is\./u);
  assert.match(text, /su name learn extract card from text source with text learning focus to name text teaching out be ceremony def/u);
  assert.match(text, /fromtext name learning distillation prompt for name mind to name text teaching raw by num 0 atmost num 1400 be write do/u);
  assert.match(text, /node command\/extract_learn_pipeline_result\.mjs" fromtext name teaching raw to name text teaching out be command do/u);
  assert.match(text, /node command\/normalize_learn_card\.mjs" fromtext name teaching out to name text teaching out be command do/u);
  assert.match(text, /learning merge prompt for name mind to name text teaching raw by num 0 atmost num 2600 be write do/u);
  assert.match(text, /learning refine prompt for name mind to name text teaching raw by num 0 atmost num 2600 be write do/u);
  assert.match(text, /node command\/validate_learn_card\.mjs" fromtext name teaching out to name text learning card valid be command do/u);
  assert.match(text, /learning focus defective: give a non-empty learning focus/u);
  assert.match(text, /su name learn merge cards from text cards with text learning focus to name text teaching out be ceremony def/u);
  assert.match(text, /fromtext name learning merge prompt for name mind to name text teaching raw by num 0 atmost num 2600 be write do/u);
  assert.match(text, /su name learn refine card from text card with text learning focus to name text teaching out be ceremony def/u);
  assert.match(text, /fromtext name learning refine prompt for name mind to name text teaching raw by num 0 atmost num 2600 be write do/u);
  assert.match(text, /node command\/learn_from_filename_pipeline\.mjs/u);
  assert.match(text, /PYA_COMMAND_TIMEOUT_MS=900000 node command\/learn_from_filename_pipeline\.mjs/u);
  assert.match(text, /su name teaching raw stage ob text of ob of learning pipeline cmd to name text teaching raw be command do/u);
  assert.match(text, /node command\/extract_learn_pipeline_result\.mjs/u);
  assert.match(text, /su name learn from text source with text learning focus to name text teaching out be ceremony def/u);
  assert.match(text, /su name learn from filename source with text learning focus to name text teaching out be ceremony def/u);
  assert.equal((text.match(/su name ollama discharge stage as wo ollama be discharge do/gu) ?? []).length, 1);
  assert.match(text, /learning source support defective/u);
  assert.match(text, /exists su name learn extract card be export ya/u);
  assert.match(text, /exists su name learn merge cards be export ya/u);
  assert.match(text, /exists su name learn refine card be export ya/u);
  assert.match(text, /exists su name learn be export ya/u);
});

test("learn example imports module and forwards source plus focus", async () => {
  const text = await fs.readFile(new URL("../examples/pyash/refinery-learn-from-filename.pya", import.meta.url), "utf8");

  assert.match(text, /from filename "\.\.\/\.\.\/module\/learn\.pya" to name learn be import do/u);
  assert.match(text, /ob ve filename text source text text learning_focus be input ya/u);
  assert.match(text, /from filename of ob of source with text of ob of learning_focus to name text teaching final be learn do/u);
});

test("learn merge refine example rechecks refined card against original source", async () => {
  const text = await fs.readFile(new URL("../examples/pyash/learn-merge-refine-cards-from-filename.pya", import.meta.url), "utf8");

  assert.match(text, /from filename "\.\.\/\.\.\/module\/learn\.pya" to name learn be import do/u);
  assert.match(text, /from filename of ob of source become wo text to name text learn source text be read do/u);
  assert.match(text, /from filename of ob of cards become wo text to name text learn cards text be read do/u);
  assert.match(text, /from text of ob of learn cards text with text of ob of learning_focus to name text merged card be learn merge cards do/u);
  assert.match(text, /from text of ob of merged card with text of ob of learning_focus to name text refined card be learn refine card do/u);
  assert.match(text, /from text of ob of learn source text with text of ob of refined card to name text learning source support pass be learning source support do/u);
  assert.match(text, /learning source support defective/u);
});
