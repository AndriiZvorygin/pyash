# 08. Tools And MCP

Purpose: define mind invocation, tool-calling envelope, and MCP integration contract.

## 1. Mind invocation

Mind calls are sentence-driven and model-configured through registered mind maps.

Invocation must support:
- prompt input
- optional context/history window
- optional tool exposure
- deterministic logging hooks

## 2. Tool calling envelope

Tool calls must use a canonical envelope with:
- tool identity
- normalized call payload
- deterministic produce payload
- explicit defect path

Adapters may differ by backend wire format, but canonical envelope remains stable.

## 3. Tool registry and default tools

Runtime should support:
- explicit `with name <tools map>`
- default tools when `with wo tools` is requested

Tool names/signatures exposed to minds must be valid registered signatures.

## 4. MCP contract

MCP integration must provide:
- discovery snapshot
- tool identity mapping
- schema-to-Pyash facade mapping
- invocation with timeout/cancel boundaries
- deterministic failure surfacing

## 5. Permissions and policy

Tool/MCP execution must honor command/tool safety policy (`19-ops-safety.md`).

## 6. Logging and replay

Mind requests/responses and tool events should be recorded in run newspaper with enough detail for replay diagnostics.

## 7. Conformance

Implementation conforms when mind/tool/MCP calls preserve canonical envelope and deterministic policy-bounded behavior.

## 8. Full draft reference

Detailed adapter matrices and appendices are preserved at:
`documentation/recipes/spec-archive/08-tools-and-mcp.full.md`
