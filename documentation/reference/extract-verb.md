# Extract Verb

This note defines the lightweight text-boundary extraction surface.

## Goal

`be extract` slices text using explicit marker boundaries.

Use it when a refinery needs to:

- keep only the session body from a downloaded page,
- take a section from a document starting at a heading,
- trim a footer or boilerplate region,
- prepare source text before chipping.

## Surface

Required start marker:

- `from text <source> since text <marker> to name text <output> be extract do`
- `from name text <source> since text <marker> to name text <output> be extract do`

Head trim:

- `from text <source> until text <marker> to name text <output> be extract do`
- corresponding `name text` variants

Optional stop marker:

- `from text <source> since text <start> until text <stop> to name text <output> be extract do`
- corresponding `name text` variants

## Semantics

- `since` is inclusive: the extracted result starts at the matched `since` marker.
- `until` without `since` returns the head of the source before the matched `until` marker.
- `until` is exclusive: if present and found after the start marker, extraction stops immediately before the `until` marker.
- if `until` is absent, extraction runs to the end of the source text.

## Failure

`be extract` should fail when:

- source text is missing,
- `since` marker is missing,
- the `since` marker is not found in the source.

If `until` is provided but not found, extraction continues to the end of the source.
