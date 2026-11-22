---
name: pyash-comfyui-housekeeper
description: "Use or troubleshoot ComfyUI workflows through Pyash GPU Housekeeper, including runtime discovery, managed job submission, workflow selection, and host routing."
---

# Pyash ComfyUI through GPU Housekeeper

Use this skill when an agent needs to run or debug a ComfyUI-backed Pyash task, or connect a Pyash caller to a ComfyUI runtime managed by GPU Housekeeper.

## Choose the existing path first

- For image generation, follow the existing Pyash `draw` flow and `command/draw_comfyui_runner.mjs`.
- For audio transcription, use `command/hear_comfyui_runner.mjs`; it packages bounded audio input for Housekeeper to upload from the provider network.
- For other configured ComfyUI workflows, inspect the relevant Pyash verb/example and reuse its workflow contract. Supported Housekeeper job kinds are `comfyui-draw`, `comfyui-say`, `comfyui-hear`, and `comfyui-prompt`.
- Do not submit inference prompts directly to ComfyUI `/prompt` when the task is meant to be Housekeeper-managed. The Housekeeper owns queueing, device admission, host placement, and runtime lifecycle.

## Discover the configured runtime

1. Resolve the Housekeeper URL from `PYA_GPU_HOUSEKEEPER_URL` or the Pyash `gpu housekeeper url` configuration value. The repository default is `http://localhost:18886`; use the configured trusted-network address when the Housekeeper is remote.
2. Check `GET <housekeeper>/health` and `GET <housekeeper>/runtime`. Confirm that `comfyui` is registered and available before submitting work. Check the deployment's workflow/model requirements too; workflows are host-specific and are not catalogued centrally.
3. If the runtime is missing or unreachable, follow the operator guide's Linux host or SSH peer setup. Do not work around a missing managed runtime by silently switching to direct ComfyUI calls.

The Housekeeper API has no authentication by default. Keep it on loopback or a trusted private/overlay network; never expose it publicly.

## Select a workflow

ComfyUI workflows are deployment-owned API prompt graphs. In Pyash, the canonical workflow directory is `draw/comfyui/`; a workflow's companion `.pya` file maps prompt, size, and output-prefix fields into graph nodes. Inspect the actual workflow and its companion mapping instead of assuming a node ID, model, or workflow name.

For the normative draw selection and prompt rules, read `documentation/specifications/25-teaching-video.md` sections 4 and 6.3. For the speech `hear` example, read `documentation/specifications/09-speech-and-hear.md`.

## Submit managed work

For repository code, prefer the shared `submitManagedGpuJob()` helper in `program/runtime/gpu/managed-ollama.mjs`; the ComfyUI runners already use it. It submits to Housekeeper `/submit` with the repository's transient transport/readiness retry behavior, polls `/job/<remoteJobId>`, and handles cancellation. Avoid hand-written submit/poll loops.

A custom caller uses the same shape as the existing runner:

```js
const result = await submitManagedGpuJob({
  managerUrl: process.env.PYA_GPU_HOUSEKEEPER_URL,
  runtimeName: "comfyui",
  profileName: workflowName,
  jobSpec: {
    kind: "comfyui-draw",
    prompt: apiPromptGraph,
  },
});
```

`prompt` must be a ComfyUI API prompt map, not an unconverted UI workflow export. Use `comfyui-hear` with the existing runner for audio input; its `audioInput` contract includes the prompt path and encoded bytes, and Housekeeper performs the provider-side upload. If targeting a specific federated host is required, pass `targetHostId` only when that host is known to have the requested ComfyUI runtime and workflow assets; otherwise let Housekeeper place the job.

Set a VRAM request only from a measured or workflow-specific need. The runners and helper have repository defaults; do not replace those with guessed fleet-wide capacity values. Independent work may queue normally; do not submit duplicates just because a job is waiting.

## Handle results and multi-host output

Housekeeper returns the ComfyUI `promptId` and history result. The standard draw runner then downloads the generated file from ComfyUI's `/view` endpoint using its configured draw host. ComfyUI output files live on the execution host, so a federated custom caller must retrieve the file from the host that ran the job. Do not assume the history result contains image bytes or that every peer shares the same output directory. Check the Housekeeper job record for its execution host when placement matters.

## Troubleshoot in order

1. Confirm the client has the intended Housekeeper URL and can reach `/health`.
2. Check `/runtime` for `comfyui`, then `/queue` and `/job/<id>` for accepted/running/failed work. A queued job is normal; do not resubmit it with a new handle.
3. Confirm the selected workflow graph and `.pya` mapping match the installed ComfyUI nodes and models.
4. For Linux Docker deployments, verify the Housekeeper is on the ComfyUI network. Defaults are `GPU_HOUSEKEEPER_COMFYUI_DOCKER_NETWORK=comfyui_default` and `COMFYUI_RUNTIME_URL=http://comfyui:8188`.
5. For a remote/federated run, confirm the selected host has ComfyUI and that the caller can retrieve output files from that host.

Read these repo references when needed:

- `container/gpu-housekeeper/README.md` — Linux setup, SSH peer permissions, networking, and runtime availability.
- `documentation/reference/gpu-housekeeper-architecture.md` section 3.3 — ComfyUI job kinds and Housekeeper execution behavior.
- `documentation/specifications/25-teaching-video.md` — draw workflows and prompt mapping.
- `command/draw_comfyui_runner.mjs` and `command/hear_comfyui_runner.mjs` — working managed callers and artifact handling.
