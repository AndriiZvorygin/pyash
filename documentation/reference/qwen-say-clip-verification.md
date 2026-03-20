# qwen say Clip Verification

## Goal
Reduce clipped sentence endings in Qwen TTS chunk synthesis by adding an internal verification loop.

## Behavior
- Runs inside `qwen_say` chunk generation (no pipeline changes required).
- For each chunk:
  - Generate chunk audio.
  - Run a cheap hot-tail suspicion check on the last window.
  - If suspicious, run Qwen ASR on that chunk and verify expected tail words exist.
  - If ASR tail check fails, regenerate the chunk and repeat.
  - Hard fail when retries are exhausted.

## Config
- `qwen say clip verify enabled` (bool, default `lie`)
- `qwen say clip verify max retries` (num, default `3`)
- `qwen say clip verify tail words` (num, default `2`)
- `qwen say clip verify window ms` (num, default `120`)
- `qwen say clip verify peak db` (num, default `-12`)
- `qwen say clip verify delta db` (num, default `1`)

ASR verification uses:
- `hear qwen host`
- `hear workflow root`
- `hear workflow default`

## Cost
Cheaper than ASR-on-every-chunk:
- ASR runs only on suspicious chunks.
- Non-suspicious chunks only pay hot-tail probe cost.

## Observability
- Per-chunk verification data is saved in chunk manifest when `qwen say keep chunks` is enabled:
  - `verification.suspect`
  - `verification.retries`
  - `verification.asrPass`
  - `verification.asrTranscript`
  - `verification.hotTail`
