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

## 4. MCP contract requirements

MCP layer must provide:
- discovery snapshot,
- schema -> Pyash facade mapping,
- invocation with timeout/cancel behavior,
- deterministic denial/error surfaces.

## 5. Permissions and policy

Tool and MCP execution must honor `19-ops-safety.md` policy hierarchy.

## 6. Conformance

Implementation conforms when mind/tool/MCP flows preserve canonical sentence envelopes and deterministic policy-bounded behavior.

## 7. References

- Full details: `documentation/recipes/spec-archive/08-tools-and-mcp.full.md`
- Interpreter adapter mapping: `documentation/recipes/pyash-interpreter-adapter.md`
