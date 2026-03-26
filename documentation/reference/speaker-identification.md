# Speaker Identification Profile

Status: reference profile for persistent speaker naming from audio slices with durable voice centroids.

## 1. Purpose

`be identify` should provide deterministic speaker ids/names from WAV input while persisting voice identity state in `world/voices/`.

Primary use:
- diarization-like speaker continuity in transcript/video pipelines,
- explicit enrollment of known speakers (for example: `Andrii Zvorygin` from `know/input/andrii_ref.wav`),
- automatic new-speaker creation when no known match exists.

## 2. Canonical signature forms

Identify from audio (auto-match / auto-create):

```pyash
su name speaker stage fromstate wo audio from filename source audio to name text speaker name be identify do
```

Identify with explicit enrollment label:

```pyash
su name speaker stage fromstate wo audio from filename source audio ob text "Andrii Zvorygin" to name text speaker name be identify do
```

Expected role of `ob text`:
- when present, treat it as enrollment label for the provided audio slice,
- update/create that named speaker centroid before returning speaker name.

## 3. Default behavior contract

For `fromstate wo audio` input:
1. accept WAV input only,
2. clip first `10` seconds for identification embedding by default,
3. use persistent voice store at `./world/voices/` by default,
4. create `speaker_NNN` when no match passes known-speaker threshold,
5. return assigned speaker key/name in `to name text`.

Speaker persistence contract:
- centroid embedding: `world/voices/<speaker>.npy`,
- metadata sidecar: `world/voices/<speaker>.json`,
- id allocator: `world/voices/index.json` with `next_speaker_id`.

Temporary audio workdir:
- `world/temporary/speaker/`.

## 4. Matching order

For standard identify calls:
1. if previous speaker context is available, compare current slice to previous speaker first,
2. if above same-speaker threshold, reuse previous speaker,
3. else compare against enrolled speakers in `world/voices/`,
4. if best known speaker exceeds known-speaker threshold, assign known speaker,
5. else allocate new `speaker_NNN`.

When a known speaker is accepted:
- update centroid + metadata sample count.

## 5. Return contract

Minimum stable output for `to name text`:
- speaker key/name only (`speaker_001`, `Andrii_Zvorygin`, etc.).

Extended diagnostics (optional implementation detail):
- similarity, matched mode (`prev`, `known`, `new`), threshold, sample count.

## 6. Resource lifecycle

`discharge` behavior:
- unload model from GPU,
- delete live CUDA references,
- run `gc.collect()`,
- run `torch.cuda.empty_cache()`,
- keep worker alive.

`stop` behavior:
- perform discharge behavior,
- terminate worker cleanly.
