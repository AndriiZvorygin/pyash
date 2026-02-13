# 04. Runtime Primitives

Purpose: define low-level runtime primitives and IR contracts used by interpreter and compiler targets.

## 1. Primitive keyword table

| Primitive | Meaning | Application |
| --- | --- | --- |
| `duty` | task/work handle | long-running lifecycle state |
| `stream` | ordered incremental output | chunked/ongoing transfer |
| `chip` | one stream chunk | deterministic stream consumption unit |

## 2. Lifecycle concepts

| Lifecycle concept | Typical marker |
| --- | --- |
| begin/start | `vyah start` |
| ongoing stream | `vyah stream` |
| await completion | `vyah await` |
| clean complete | `vyah finish success` |
| canceled | `vyah cancel success` |
| failed | `vyah fail` |

## 3. IR boundary

Runtime IR must preserve:
- sentence structure,
- typed case values,
- signature derivation inputs,
- deterministic lowering parity between interpreter and compiled outputs.

## 4. Canonical usage examples

Duty fact:
```pyash
su name task_1 as name running be duty ya
```

Stream fact:
```pyash
su name transcript as name open ob ve text hello world be stream ya
```

Read one chunk:
```pyash
su name transcript vyah eval be chip do
```

## 5. Logging and traceability

Primitive transitions should be observable in run newspaper/event records when enabled.

## 6. Conformance

Implementation conforms when primitive behavior is semantically equivalent across interpreter/JS/C targets for identical input.

## 7. Full draft reference

`documentation/recipes/spec-archive/04-runtime-primitives.full.md`
