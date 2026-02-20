# 25. Teaching Video

Purpose: define a lean v0 refinery pipeline for slideshow-style teaching videos using sentence-shaped media steps.

## 1. Scope

This spec covers:
- manuscript-first pipeline,
- telling-first timing,
- itinerary/cut timeline units,
- photograph generation per cut,
- deterministic video assembly.

This spec does not cover:
- branching timelines,
- live avatar video,
- advanced transition libraries.

## 2. Keyword and verb table

| Surface | Meaning | Application |
| --- | --- | --- |
| `fromstate ... become ... be draw do` | generate teaching media | text/photo/video to photograph/video |
| `be footnote do` | derive footnote/timing text from telling | footnote/timestamp output |
| `be cut do` | split telling timeline into cuts | 5-7s unit extraction |
| `be concatenate do` | assemble media units into final video | slideshow/video composition |
| `be itinerary def` | ordered timeline container | teaching timeline source of truth |
| `su name <x> be cut ya` | single timeline unit | photograph/text/audio window metadata |

## 3. Canonical v0 refinery flow

Order is normative for v0:
1. create manuscript text,
2. generate telling audio,
3. derive footnote/timing output,
4. cut into 5-7 second units,
5. draw one teaching photograph (or teaching video) per cut,
6. concatenate into final video.

The flow should be declared and executed as a refinery (`be refinery def ... prah`, then `be refinery do`).

Dependency link encoding:
- use `from name <dependency>` for one dependency,
- use `from ve name <dep1> name <dep2> ...` for multiple dependencies.

Canonical signatures (v0 quick block):
- `ob text <prompt> fromstate wo text become wo photograph to filename <path> be draw do`
- `from filename <path> ob text <prompt> fromstate wo photograph become wo photograph to filename <path> be draw do`
- `from filename <path> ob text <prompt> fromstate wo photograph become wo video to filename <path> be draw do`
- `from name <itinerary> ob text <prompt> fromstate wo text become wo photograph to name itinerary <name> be draw do`
- `from filename <audio> become wo srt to filename <path> be footnote do`
- `from filename <audio> become wo srt to name text <out> be footnote do`
- `from filename <srt> during num <seconds> to name itinerary <name> be cut do`
- `from name <itinerary> fromstate wo itinerary become wo video to filename <path> be concatenate do`
- `from ve name <itinerary> name <dependency> fromstate wo itinerary become wo video to filename <path> be concatenate do`

## 4. Starter signatures

### 4.1 Draw

Text to teaching photograph:
```pyash
ob text "prompt text"
fromstate wo text
become wo photograph
to filename "artifacts/draw/shot-001.png"
be draw do
```

Photograph to teaching photograph:
```pyash
from filename "artifacts/draw/source.png"
ob text "prompt text"
fromstate wo photograph
become wo photograph
to filename "artifacts/draw/shot-002.png"
be draw do
```

Photograph to teaching video:
```pyash
from filename "artifacts/draw/source.png"
ob text "motion prompt text"
fromstate wo photograph
become wo video
to filename "artifacts/draw/shot-003.mp4"
be draw do
```

Cuts to photograph itinerary:
```pyash
from name teaching cuts
ob text "Generate one photograph per cut from its footnote text."
fromstate wo text
become wo photograph
to name itinerary photographs
be draw do
```

Workflow selection:
- `as text "<workflow name>"` selects a named draw workflow,
- `with filename "<workflow file>"` may override with an explicit workflow file path.

### 4.2 Footnote

Audio to SRT file:
```pyash
from filename "artifacts/say/teaching.wav"
become wo srt
to filename "artifacts/footnote/teaching.srt"
be footnote do
```

Audio to SRT text:
```pyash
from filename "artifacts/say/teaching.wav"
become wo srt
to name text footnote out
be footnote do
```

### 4.3 Cut

SRT to itinerary:
```pyash
from filename "artifacts/footnote/teaching.srt"
during num 6
to name itinerary teaching cuts
be cut do
```

Behavior:
- `during num` is target cut duration in seconds,
- implementation should keep each cut near target (default 6),
- hard bounds should be 5-7s when feasible.

### 4.4 Concatenate

Itinerary to video:
```pyash
from name teaching cuts
fromstate wo itinerary
become wo video
to filename "artifacts/video/teaching.mp4"
be concatenate do
```

## 5. Itinerary/cut schema (v0)

The itinerary is the source of truth for assembly.

Canonical shape:
```pyash
su name teaching cuts be itinerary def
  su name cut 001 be cut ya
  su name cut 001 from num 0.0 ya
  su name cut 001 to num 6.0 ya
  su name cut 001 during num 6.0 ya
  su name cut 001 ob text "footnote text for this cut" ya
  su name cut 001 from filename "artifacts/draw/cut-001.png" ya
  su name cut 001 with filename "artifacts/say/teaching.wav" ya
prah
```

Minimum required fields per cut:
- `from num` start seconds,
- `to num` end seconds,
- `during num` duration seconds,
- `from filename` still photograph path.

Optional fields:
- `ob text` footnote text,
- `with filename` shared teaching path,
- tool-specific style/seed metadata.

## 6. Determinism rules

- Itinerary order is stable and defines render order.
- Cut boundaries are monotonic and non-overlapping.
- Concatenate consumes itinerary in declaration order.
- File outputs should use deterministic names by cut id.
- On single-GPU systems, provider switching between `mind` and `draw` should follow auto-discharge policy from `08-tools-and-mcp.md` and `23-configure.md`.

## 6.1 Draw workflow storage and resolution

Workflows are backend-owned files. Canonical root:
- `./draw/refinery/<backend>/`

ComfyUI canonical root:
- `./draw/refinery/comfyui/`

Resolution order for `draw`:
1. if `with filename` is provided, use it directly;
2. else if `as text "<workflow name>"` is provided, resolve to `./draw/refinery/<backend>/<workflow name>.json`;
3. else load compositional default workflow for (`fromstate`, `become`) from `configure/default.pya`;
4. if unresolved, emit `draw defective`.

## 7. Error classes

Implementations should report sentence-shaped errors with these names:
- `draw defective`,
- `footnote defective`,
- `cut defective`,
- `concatenate defective`,
- `itinerary defective`.

## 8. Conformance

Implementation conforms when:
- the canonical flow is executable end-to-end,
- itinerary/cut records are reproducible,
- final video assembly follows itinerary order,
- every platform surfaces sentence-shaped results/errors.

## 9. Canonical refinery template

```pyash
su name teaching video loop be refinery def
su name manuscript platform
ob text "Write a concise teaching manuscript."
for name mind
to name text manuscript out
be write do

su name telling platform
from name manuscript platform
ob name manuscript out
to filename "artifacts/say/teaching.wav"
be say do

su name footnote platform
from name telling platform
from filename "artifacts/say/teaching.wav"
become wo srt
to filename "artifacts/footnote/teaching.srt"
be footnote do

su name cut platform
from name footnote platform
from filename "artifacts/footnote/teaching.srt"
during num 6
to name itinerary teaching cuts
be cut do

su name draw platform
from name cut platform
ob text "Generate one photograph per cut from its footnote text."
fromstate wo text
become wo photograph
to name itinerary photographs
be draw do

su name concatenate platform
from ve name teaching cuts name draw platform
fromstate wo itinerary
become wo video
to filename "artifacts/video/teaching.mp4"
be concatenate do
prah

from name teaching video loop be refinery do
```

Terminology note:
- use `platform` for refinery execution nodes,
- use `scene` for media content represented by each cut.

## 10. Strict signature matrix (v0)

Valid `draw` forms:
- `ob text <prompt> fromstate wo text become wo photograph to filename <path> be draw do`
- `from filename <path> ob text <prompt> fromstate wo photograph become wo photograph to filename <path> be draw do`
- `from filename <path> ob text <prompt> fromstate wo photograph become wo video to filename <path> be draw do`
- `from name <itinerary> ob text <prompt> fromstate wo text become wo photograph to name itinerary <name> be draw do`
- `ob text <prompt> fromstate wo text become wo photograph as text <workflow> to filename <path> be draw do`
- `ob text <prompt> fromstate wo text become wo photograph with filename <workflow file> to filename <path> be draw do`

Invalid `draw` forms:
- missing `become` target kind,
- missing `fromstate` source kind,
- `fromstate wo text become wo video` in v0 (not part of starter surface).

Valid `footnote` forms:
- `from filename <audio> become wo srt to filename <path> be footnote do`
- `from filename <audio> become wo srt to name text <out> be footnote do`

Valid `cut` forms:
- `from filename <srt> during num <seconds> to name itinerary <name> be cut do`

Valid `concatenate` forms:
- `from name <itinerary> fromstate wo itinerary become wo video to filename <path> be concatenate do`
- `from ve name <itinerary> name <dependency> fromstate wo itinerary become wo video to filename <path> be concatenate do`
