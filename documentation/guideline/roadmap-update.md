---
title: Roadmap Update Rules
---

# Roadmap Update Rules

- Roadmap is future-only; completed work belongs in `CHANGELOG.md`.
- When unsure of a completion date, use `git log --date=short` as the source of truth.
- Keep a `# TODO` header immediately before the first upcoming Week block.
- Week blocks are sequential and contiguous: Week N starts the day after the previous Week ends.
- When shifting Week blocks, update their date ranges and headings together.
- When work completes, remove it from the roadmap and append a dated entry in `CHANGELOG.md`.
