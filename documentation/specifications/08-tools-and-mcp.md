# 08. Tools And MCP

Purpose: define mind invocation, tool-calling envelope, and MCP integration contracts.

## 1. Core keyword table

| Keyword/case | Meaning | Application |
| --- | --- | --- |
| `for name <target>` | mind/helper target | choose mind/refinery target |
| `with name <tools>` | explicit tools map | restricted tool exposure |
| `with wo tools` | default tools set | stable standard tools |
| `under name <conduct>` | run-scoped policy/config | verify loop / guardrails |
| `to name text <out>` | bind output fact | deterministic downstream use |
| `be discharge ... do` | provider teardown | free backend/runtime resources |

## 2. Canonical invocation forms

Mind invoke:
```pyash
ob text "task" for name helper to name text output be evoke do
```

Mind invoke with tools:
```pyash
ob text "task" for name helper with name saddle tools to name text output be evoke do
```

Mind invoke with conduct:
```pyash
ob text "task" for name helper with name saddle tools under name verify loop configure to name text output be evoke do
```

## 3. Tool envelope requirements

Tool events must preserve:
- tool identity,
- normalized call sentence,
- surfaced produce/error sentence,
- deterministic ordering with run newspaper.

## 4. Provider lifecycle and exclusivity

Provider classes such as `mind` and `draw` should support explicit discharge.

Canonical discharge forms:
```pyash
be discharge as wo mind do
be discharge as wo draw do
be discharge for name helper do
```

GPU exclusivity rule (single-GPU runtime):
- At most one GPU-heavy provider class may stay active at a time.
- Activating `draw` should discharge active `mind` providers when auto-discharge is enabled.
- Activating `mind` should discharge active `draw` providers when auto-discharge is enabled.
- Auto-discharge policy must be deterministic and observable in run records.

## 5. MCP contract requirements

MCP layer must provide:
- discovery snapshot,
- schema -> Pyash facade mapping,
- invocation with timeout/cancel behavior,
- deterministic denial/error surfaces.

## 6. Permissions and policy

Tool and MCP execution must honor `19-ops-safety.md` policy hierarchy.

## 7. Conformance

Implementation conforms when mind/draw/tool/MCP flows preserve canonical sentence envelopes, deterministic lifecycle behavior, and policy-bounded execution.

## 8. References

- Full details: `documentation/recipes/spec-archive/08-tools-and-mcp.full.md`
- Interpreter adapter mapping: `documentation/recipes/pyash-interpreter-adapter.md`
