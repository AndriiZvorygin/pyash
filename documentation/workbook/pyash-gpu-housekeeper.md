# Pyash GPU Housekeeper Workbook

Status: working guide for agents authoring Pyash jobs for GPU Housekeeper.
This records the current call shapes and operational handoff; the runtime
contracts remain in the [GPU Housekeeper architecture reference](../reference/gpu-housekeeper-architecture.md)
and [operator guide](../../container/gpu-housekeeper/README.md).

## Choose the right Pyash path

| Work | Pyash surface | Completion behavior |
| --- | --- | --- |
| Text generation | `vyah start future be gpu mind do` | Returns a durable Pyash handle. The caller later uses `vyah await` or checks `vyah status`. |
| Image generation from a text description | `be draw do` | Uses the configured ComfyUI workflow and, when Housekeeper is configured, submits a managed ComfyUI job and waits for the generated file. |
| Low-level queued ComfyUI job | `vyah start future be gpu draw do` | Returns a durable handle, but requires a complete ComfyUI API prompt graph as the job spec; a plain image description is insufficient. |

Use the high-level `draw` ceremony for ordinary image generation. It loads the
workflow profile, inserts the description at that workflow's positive-prompt
field, submits through Housekeeper, waits for the completed ComfyUI history,
and writes the returned image to the requested filename. The default workflow
is `Z-Image-TSV`; deployments may configure a different default or pass a
workflow name with `as text`.

## Text generation: durable future duty

Give each job a stable, unique subject name. `start future` puts the work on
Pyash's durable GPU queue and returns promptly with that handle. The configured
`command/gpu_worker.mjs` claims it and submits it to Housekeeper; Housekeeper
controls runtime admission and placement.

```pyash
su name fraction explanation duty ob text "Explain why equivalent fractions represent the same value in two concise sentences." vyah start future be gpu mind do

accordingto text "fraction explanation duty" during num 120000 vyah await be gpu do
```

Check a job without waiting for it:

```pyash
accordingto text "fraction explanation duty" vyah status be gpu do
```

The await result reports terminal state in `ob.text`; the generated payload is
in `result.text`. An await timeout does not cancel the duty. Check status or
await the same handle again. Independent work can be enqueued under separate
names before awaiting, allowing Housekeeper to schedule it within device
capacity.

The worker must be running with the Housekeeper URL configured. For example:

```sh
export PYA_GPU_HOUSEKEEPER_URL=http://mriczo:18886
node command/gpu_worker.mjs --world world
```

The repository config may already provide `gpu housekeeper url`; the
environment variable overrides it. See the operator guide for worker service
setup and host-specific URLs.

For another complete text-duty source example, see
[`teaching-video-gpu-queue-mind-duty.pya`](../../examples/pyash/teaching-video-gpu-queue-mind-duty.pya).

## Image generation: workflow-aware draw

The high-level `draw` ceremony uses the configured workflow and saves the
result. This runnable example uses the current default `Z-Image-TSV` workflow
and the supplied description:

```pyash
ob text "a 28-year-old Caucasian American woman with a grown-up angular face, defined cheekbones and a strong jawline, pale skin and light freckles, a glossy black blunt jaw-length bob with heavy straight bangs and one clay-orange streak through the bangs, a small flat clay-orange eight-pointed star hair clip, a thin headset microphone at her cheek" fromstate wo text become wo image to filename "examples/out/housekeeper-generated-character.png" as text "Z-Image-TSV" be draw do
```

The equivalent source is [`examples/pyash/housekeeper-image-generation.pya`](../../examples/pyash/housekeeper-image-generation.pya).
Run it with the repository runner:

```sh
./run examples/pyash/housekeeper-image-generation.pya
```

This `draw` call is a synchronous Pyash action: the managed job itself is
queued and monitored by Housekeeper, while the ceremony returns after saving
the image. Its completion handle is internal to the managed client. Prefer
`vyah start future be gpu mind do` when the caller needs an explicit durable
Pyash handle and later `await`/`status` calls.

## Low-level image duties

The explicit `gpu draw` future surface is for a ComfyUI API prompt graph that
is already prepared. Its `ob` must be a Pyash map or JSON object with
`kind: "comfyui-draw"`, a deployment-valid `profileName`, and `prompt` (or
`workflow`) containing the complete API graph. A node fragment containing
only `inputs.text` is not a complete ComfyUI graph. Use the high-level `draw`
ceremony when starting from a natural-language description so the selected
workflow can be loaded and its prompt node patched correctly.

## Agent checklist

- Use a unique, descriptive `su name` for every durable GPU handle.
- For text generation, pass the plain prompt as `ob text`; use a JSON job spec
  only when model/runtime fields need to be explicit.
- Include `vyah start future` to enqueue a durable GPU duty. Await or check
  status using exactly the same handle name.
- For normal image generation, use `be draw do` with a description, output
  filename, and optional configured workflow name.
- Ensure Housekeeper configuration is available. A queued durable handle also
  needs the local GPU worker to be running.
- Keep returned text or image output under ignored output locations such as
  `examples/out/`; do not commit generated artifacts unless requested.
- Do not call Ollama or ComfyUI directly for GPU inference when the Housekeeper
  path is available.
