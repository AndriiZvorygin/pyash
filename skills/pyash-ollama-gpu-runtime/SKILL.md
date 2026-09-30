---
name: pyash-ollama-gpu-runtime
description: "Diagnose and configure hardware-compatible Ollama GPU runtimes and verify Pyash GPU-housekeeper placement."
---

# Pyash Ollama GPU Runtime

Use this skill when Ollama rejects a GPU, falls back to CPU, or Pyash's GPU
housekeeper reports zero or partial VRAM residency.

## Diagnose by Hardware Profile

1. Record the exact GPU model, compute capability, driver version, Ollama
   version, selected backend, and CUDA runtime version.
2. Keep the installed driver and hardware fixed unless the user explicitly
   requests a hardware change. Select or build a runtime compatible with the
   existing driver instead of treating the newest runtime as universally
   appropriate.
3. Compare a successful host's runner discovery with the failing host. Check
   for mixed CUDA libraries in container paths, not only the selected library
   name or environment variable.
4. Keep the GPU housekeeper's CPU/partial-offload rejection enabled.

## Prove the Fix

1. Test in a disposable container using the same Ollama version and model
   store as production.
2. Verify the inference log identifies the expected CUDA runtime and GPU.
3. Make a short real model request; check `ollama ps` for `100% GPU`, nonzero
   scheduler `runner.vram`, and GPU memory activity during the request.
4. Only then update the production runtime and run one single-flight Pyash GPU
   pipeline. Confirm its child stages complete and the final output exists.
5. Remove only disposable test containers/images created for the investigation.

## swac RTX 3060 Profile

The tested software profile for swac's RTX 3060 and driver 535.247.01 is in
[`ops/ollama/swac-rtx3060-cuda122/README.md`](../../ops/ollama/swac-rtx3060-cuda122/README.md).
It uses Ollama 0.34.1 with a CUDA 12.2 runner compiled for `sm_86`; it does not
modify the host driver.
