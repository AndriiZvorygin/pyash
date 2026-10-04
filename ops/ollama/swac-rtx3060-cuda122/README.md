# swac RTX 3060 Ollama Runtime

This profile runs Ollama 0.34.1 on swac's RTX 3060 (compute capability 8.6,
NVIDIA driver 535.247.01) without changing the host driver. The upstream CUDA
12.8 runner requires a newer driver, so this profile builds Ollama's matching
CUDA runner with CUDA 12.2 and targets only `sm_86`.

## Build the Runner

The patch is pinned to Ollama v0.34.1, commit
`38fdb5dd58c761f850cddd6ba1e78a7954646b4f`.

```bash
export ROOT="$HOME/.cache/ollama-swac-cuda122"
mkdir -p "$ROOT/state" "$ROOT/output"
git clone --depth 1 --branch v0.34.1 https://github.com/ollama/ollama.git "$ROOT/src"
test "$(git -C "$ROOT/src" rev-parse HEAD)" = 38fdb5dd58c761f850cddd6ba1e78a7954646b4f
git -C "$ROOT/src" apply --unidiff-zero "$PWD/ops/ollama/swac-rtx3060-cuda122/ollama-v0.34.1-cuda122-sm86.patch"

docker run -d --name ollama-swac-cuda122-buildkit --privileged \
  -v "$ROOT/state:/var/lib/buildkit" \
  -v "$ROOT/src:/src:ro" \
  -v "$ROOT/output:/out" \
  moby/buildkit:v0.20.2

docker exec ollama-swac-cuda122-buildkit buildctl \
  --addr unix:///run/buildkit/buildkitd.sock build --progress=plain \
  --frontend dockerfile.v0 \
  --local context=/src --local dockerfile=/src \
  --opt filename=Dockerfile \
  --opt target=publish-llama-server-cuda_v12 \
  --opt build-arg:CUDA12VERSION=12.2 \
  --output type=local,dest=/out/runner
docker exec ollama-swac-cuda122-buildkit \
  chown -R "$(id -u):$(id -g)" /out/runner
```

BuildKit state and output stay under `$HOME`, rather than consuming Docker's
default root partition. The CUDA compilation needs substantial temporary
storage; the exported runner itself is about 0.8 GiB. To repeat a build, use a
fresh source clone or verify the existing clone is at the pinned commit and
already has this patch.

## Package and Deploy

Make a directory outside the repository containing the built `cuda_v12`
folder and this profile's `Dockerfile`:

```bash
mkdir -p "$ROOT/image-context"
cp -a "$ROOT/output/runner/lib/ollama/cuda_v12" "$ROOT/image-context/"
cp ops/ollama/swac-rtx3060-cuda122/Dockerfile "$ROOT/image-context/"
docker build -t liberit/ollama:0.34.1-cuda12.2-sm86-clean "$ROOT/image-context"
```

The `RUN rm -rf` before `COPY` is required: Docker otherwise merges the new
runner with the base image's CUDA 12.8 files, causing Ollama to detect 12.8 and
reject driver 535 again.

In swac's Compose service, use
`liberit/ollama:0.34.1-cuda12.2-sm86-clean` and set
`OLLAMA_LLM_LIBRARY=cuda_v12`. Validate the Compose file and confirm no Ollama
job is active before recreating only the Ollama service.

## Verify GPU Placement

Check all of the following, not just container GPU visibility:

- Startup log reports `library=CUDA`, `compute=8.6`, and `driver=12.2`.
- A short Qwen request returns successfully.
- `ollama ps` reports `100% GPU` for `qwen3.5:9b`.
- Ollama's scheduler log reports nonzero `runner.vram`.
- During inference, `nvidia-smi` shows the Ollama process using VRAM.

The Pyash GPU housekeeper remains the runtime guard. If Ollama reports CPU or
partial offload, the housekeeper should reject the request; do not disable that
guard or change the host driver to mask a runtime mismatch.
