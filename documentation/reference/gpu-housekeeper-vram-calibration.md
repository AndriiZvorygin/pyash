# GPU Housekeeper VRAM Calibration

Housekeeper estimates are cold-load admission requirements, not measurements of
current device occupancy. On NVIDIA hosts, the current fallback is:

```text
ceil(model_size_MiB * 1.10 + 256 + ceil(context_tokens / 4096) * 160)
```

The model-size term preserves a 10% margin for runtime allocation. The fixed
and context terms were reduced after comparing the estimate with real Qwen
3.5 9B Q4_K_M deployments. The estimate remains above both observed process
footprints while avoiding the earlier multi-gigabyte overstatement at 32K.
Other memory backends retain their previous conservative estimate until they
have independent measurements.

The default Ollama request context is 32,768 tokens, above the 16K minimum
operating target. Mriczo has a measured 32K Qwen deployment; the calibrated
admission estimate is 8,454 MiB. SWAC's 12 GiB GPU currently reports 11,934 MiB
free, so the same request fits with 3,480 MiB remaining by the admission
estimate. Explicit per-job `num_ctx` settings continue to override the default.

## Measurements

Both hosts reported the same Ollama model digest:
`6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`.

| Host | GPU | Context | `llama-server` VRAM | Total GPU used |
| --- | --- | ---: | ---: | ---: |
| SWAC | RTX 3060, 12 GiB | 4,096 | 6,448 MiB | 6,558 MiB |
| Mriczo | RTX 3090, 24 GiB | 32,768 | 7,656 MiB | 8,057 MiB |

Mriczo's installed Ollama catalog reported 6,594,474,711 model bytes. The
calibrated estimate is 7,334 MiB at 4K and 8,454 MiB at 32K. These are 886 MiB
(13.7%) and 798 MiB (10.4%) above the respective measured Ollama process
allocations. At the 32K measurement, the 3090 had 16,196 MiB reported free.

The 4K SWAC observation and 32K Mriczo observation are resident process memory
from `nvidia-smi --query-compute-apps`; total device use includes other GPU
processes. Ollama's `/api/ps` `size_vram` is also useful residency evidence,
but it is not the full `llama-server` process allocation.

## Reading Live Evidence

Use `GET /snapshot` on the host Housekeeper:

- `ollamaRunningModels.models[].contextLength` is the context of the loaded
  Ollama model when `/api/ps` provides it.
- `ollamaRunningModels.models[].sizeVram` is Ollama's model-residency report.
- `ollamaRunningModels.models[].processVramMb` is attached only when exactly
  one GPU-resident Ollama model can be matched to the managed NVIDIA process
  allocation. This avoids attributing a multi-model total to one model.
- `gpuProcesses.runtimes.ollama.usedMemoryMb` reports the total GPU memory used
  by processes belonging to the Ollama runtime.
- `devices[].vramUsedMb` and `devices[].vramFreeMb` report the whole device,
  including other managed and unmanaged workloads.

For new model families or quantizations, compare the estimated admission
requirement with these live readings before changing the calibration. A
single model's measurements should not be treated as a universal cache-size
constant for unrelated architectures.
