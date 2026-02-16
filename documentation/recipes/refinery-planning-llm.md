# Refinery Planning Recipe (For LLM Codegen)

Purpose: give an LLM a stable pattern for generating multi-stage Pyash refinery code where one mind first plans and later stages execute/verify.

## 1. When to use this pattern

Use a refinery when you need:
- deterministic stage order,
- explicit intermediate artifacts (plan, draft, check),
- easy replay/newspaper visibility.

Use `verify loop` when you need bounded retries with guarantee checks.

## 2. Generation contract for the LLM

When asked to generate refinery code, the model should:
- output only valid `.pya` code,
- define minds first (`exists su name ... be mind ... ya`),
- define exactly one refinery block (`su name <name> be refinery def ... prah`),
- keep stage names unique,
- keep each stage single-purpose,
- pass data through named facts (`to name text <name>`),
- include one invocation (`from name <refinery> be refinery do` or with `ob ... to name ...`).

## 3. Stage template

Recommended stage sequence:
1. plan
2. execute
3. verify
4. summarize

This keeps plan generation separate from action generation.

## 4. Minimal planning refinery template

```pyash
exists su name planner prompt ob text "You are a planner. Return a short numbered plan." be text ya
exists su name worker prompt ob text "Execute the provided plan. Return concrete output only." be text ya
exists su name checker prompt ob text "Check whether output satisfies task and plan. Return PASS or FAIL with one reason." be text ya

exists su name planner be mind as name "qwen3-vl:8b-instruct" fromtext name planner prompt ya
exists su name worker be mind as name "qwen3-vl:8b-instruct" fromtext name worker prompt ya
exists su name checker be mind as name "qwen3-vl:8b-instruct" fromtext name checker prompt ya

su name plan execute verify be refinery def
su name plan stage ob name input for name planner to name text plan text be write do
su name execute stage ob name plan text for name worker to name text draft text be write do
su name verify stage ob name draft text for name checker to name text verdict text be write do
su name summarize stage ob name verdict text be write do
prah

ob text "Task: draft a three-step migration checklist for scheduler health reporting." from name plan execute verify to name text final output be refinery do
ob name final output be write do
```

## 5. Prompting instructions you can hand to an LLM

Use this prompt shape when asking an LLM to generate refinery code:

```text
Generate valid Pyash only.
Create a refinery with stages: plan, execute, verify, summarize.
Use named mind definitions first.
Use unique stage subjects.
Persist stage outputs in to-name text bindings.
Include one final refinery invocation for the given task.
Do not include prose.
```

## 6. Common failure modes

- Reusing the same `su name` for multiple stage outputs unintentionally.
- Mixing planning and execution in one stage.
- Omitting a final refinery invocation.
- Returning prose/explanations around code.
- Using tool signatures that do not exist.

## 7. Validation checklist

Before running generated code:
- refinery has `def ... prah`,
- all stage names are unique,
- all referenced names were defined earlier,
- final invocation exists,
- optional: run `node command/vocab_suggest.mjs "<new token>"` for newly introduced Pyash tokens.

## 8. References

- Normative pipeline contract: `documentation/specifications/10-pipelines.md`
- Full pipeline draft details: `documentation/recipes/spec-archive/10-pipelines.full.md`
- Working examples:
  - `examples/pyash/refinery-basic.pya`
  - `examples/pyash/refinery-inline-input.pya`
  - `examples/pyash/reviewer-circle.pya`
  - `examples/pyash/coding-loop-guarantee.pya`
