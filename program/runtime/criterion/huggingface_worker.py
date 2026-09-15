#!/usr/bin/env python3
"""Line-oriented Transformers worker used by the Criterion Node adapter."""

import json
import os
import sys
import time


MODEL_DEFAULTS = {
    "ahmeddeldalyyy/meeting-summarizer-meetingbank": {
        "maxInputTokens": 1024,
        "minOutputTokens": 56,
        "maxOutputTokens": 142,
        "numBeams": 4,
        "lengthPenalty": 2.0,
    },
    "Shaelois/MeetingScript": {
        "maxInputTokens": 4096,
        "minOutputTokens": 56,
        "maxOutputTokens": 142,
        "numBeams": 4,
        "lengthPenalty": 2.0,
        "doSample": False,
        "chunkLongInputs": True,
        "chunkOverlapTokens": 128,
    },
    "MingZhong/DialogLED-large-5120": {
        "maxInputTokens": 5120,
        "minOutputTokens": 1,
        "maxOutputTokens": 256,
        "numBeams": 4,
        "lengthPenalty": 1.0,
        "doSample": False,
        "chunkLongInputs": True,
        "chunkOverlapTokens": 128,
    },
}


def chunk_ranges(total_tokens, limit, overlap):
    """Return deterministic token windows without silently dropping long input."""
    total = max(0, int(total_tokens))
    size = max(1, int(limit))
    shared = max(0, min(size - 1, int(overlap)))
    if total <= size:
        return [(0, total)]

    ranges = []
    start = 0
    while start < total:
        end = min(total, start + size)
        ranges.append((start, end))
        if end >= total:
            break
        next_start = end - shared
        start = next_start if next_start > start else end
    return ranges


def resolved_revision(tokenizer, model, requested_revision):
    tokenizer_revision = getattr(tokenizer, "_commit_hash", None)
    if not tokenizer_revision:
        tokenizer_revision = getattr(tokenizer, "init_kwargs", {}).get("_commit_hash")
    model_revision = getattr(getattr(model, "config", None), "_commit_hash", None)
    return model_revision or tokenizer_revision or requested_revision


def reply(request_id, **payload):
    sys.stdout.write(json.dumps({"id": request_id, **payload}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def load_state(request):
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    model_id = str(request["model"])
    revision = request.get("revision") or None
    started = time.perf_counter()
    tokenizer = AutoTokenizer.from_pretrained(model_id, revision=revision)
    dtype_name = str(request.get("dtype") or os.environ.get("PYA_HF_DTYPE", "auto"))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = None
    if dtype_name == "float16" and device == "cuda":
        dtype = torch.float16
    elif dtype_name == "bfloat16" and device == "cuda":
        dtype = torch.bfloat16
    model_options = {"revision": revision} if revision else {}
    if dtype is not None:
        model_options["torch_dtype"] = dtype
    model = AutoModelForSeq2SeqLM.from_pretrained(model_id, **model_options)
    model.to(device)
    model.eval()
    effective_revision = resolved_revision(tokenizer, model, revision)
    parameters = sum(parameter.numel() for parameter in model.parameters())
    defaults = MODEL_DEFAULTS.get(model_id, {})
    config = request.get("generation") or {}
    generation = {**defaults, **config}
    load_ms = (time.perf_counter() - started) * 1000
    return {
        "model": model,
        "tokenizer": tokenizer,
        "torch": torch,
        "device": device,
        "generation": generation,
        "modelType": getattr(getattr(model, "config", None), "model_type", None),
        "metadata": {
            "engine": "huggingface",
            "modelId": model_id,
            "modelRevision": effective_revision,
            "tokenizerRevision": getattr(tokenizer, "_commit_hash", None) or effective_revision,
            "requestedRevision": revision,
            "modelDigest": effective_revision,
            "tokenizerName": getattr(tokenizer, "name_or_path", model_id),
            "parameterCount": parameters,
            "dtype": str(next(model.parameters()).dtype),
            "device": device,
            "cudaDevice": torch.cuda.get_device_name(0) if device == "cuda" else None,
            "maxInputTokens": generation.get("maxInputTokens"),
            "numBeams": generation.get("numBeams"),
            "minOutputTokens": generation.get("minOutputTokens"),
            "maxOutputTokens": generation.get("maxOutputTokens"),
            "lengthPenalty": generation.get("lengthPenalty"),
            "doSample": generation.get("doSample", False),
            "chunkLongInputs": generation.get("chunkLongInputs", False),
            "chunkOverlapTokens": generation.get("chunkOverlapTokens", 0),
            "modelType": getattr(getattr(model, "config", None), "model_type", None),
            "loadTimeMs": load_ms,
        },
    }


def generate(state, request):
    prompt = str(request.get("input") or request.get("prompt") or "")
    tokenizer = state["tokenizer"]
    model = state["model"]
    torch = state["torch"]
    generation = {**state["generation"], **(request.get("generation") or {})}
    limit = int(generation.get("maxInputTokens") or 4096)
    all_tokens = tokenizer(prompt, add_special_tokens=True, truncation=False)["input_ids"]
    input_token_count = len(all_tokens)
    wants_chunking = bool(generation.get("chunkLongInputs", False))
    overlap = int(generation.get("chunkOverlapTokens") or 0)
    ranges = chunk_ranges(input_token_count, limit, overlap if wants_chunking else 0)
    truncated = input_token_count > limit and not wants_chunking
    started = time.perf_counter()
    outputs = []
    processed_input_tokens = 0
    output_tokens = 0
    for start_token, end_token in ranges:
        input_ids = all_tokens[start_token:end_token]
        encoded = {
            "input_ids": torch.tensor([input_ids], dtype=torch.long).to(state["device"]),
            "attention_mask": torch.ones((1, len(input_ids)), dtype=torch.long).to(state["device"]),
        }
        if state.get("modelType") == "led":
            global_attention_mask = torch.zeros_like(encoded["input_ids"])
            global_attention_mask[:, 0] = 1
            encoded["global_attention_mask"] = global_attention_mask
        with torch.inference_mode():
            output = model.generate(
                **encoded,
                num_beams=int(generation.get("numBeams") or 1),
                min_length=int(generation.get("minOutputTokens") or 1),
                max_length=int(generation.get("maxOutputTokens") or 142),
                length_penalty=float(generation.get("lengthPenalty") or 1.0),
                do_sample=bool(generation.get("doSample", False)),
            )
        outputs.append(tokenizer.decode(output[0], skip_special_tokens=True).strip())
        processed_input_tokens += len(input_ids)
        output_tokens += int(output.shape[-1])
    text = " ".join(item for item in outputs if item).strip()
    elapsed_ms = (time.perf_counter() - started) * 1000
    return {
        "text": text,
        "effectiveThink": False,
        "reasoningMode": "direct",
        "metadata": {
            "truncated": truncated,
            "truncatedTokens": max(0, input_token_count - processed_input_tokens) if truncated else 0,
            "chunked": len(ranges) > 1,
            "chunkCount": len(ranges),
            "inputLimit": limit,
            "inputTokenCount": input_token_count,
            "inputTokens": processed_input_tokens,
            "outputTokens": output_tokens,
        },
        "timing": {
            "promptTokens": processed_input_tokens,
            "outputTokens": output_tokens,
            "promptTokensPerSecond": None,
            "generationTokensPerSecond": output_tokens / (elapsed_ms / 1000) if elapsed_ms > 0 else None,
            "totalElapsedMs": elapsed_ms,
            "loadTimeMs": state["metadata"]["loadTimeMs"],
            "samplesPerSecond": 1000 / elapsed_ms if elapsed_ms > 0 else None,
        },
        "metadataRecord": state["metadata"],
    }


def main():
    state = None
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        request_id = request.get("id")
        try:
            if request.get("type") == "init":
                state = load_state(request)
                reply(request_id, ok=True, metadata=state["metadata"])
            elif request.get("type") == "generate":
                if state is None:
                    raise RuntimeError("Hugging Face worker is not initialized")
                reply(request_id, ok=True, result=generate(state, request))
            elif request.get("type") == "shutdown":
                reply(request_id, ok=True)
                return
            else:
                raise ValueError(f"unknown worker request: {request.get('type')}")
        except Exception as error:
            reply(request_id, ok=False, error=f"{type(error).__name__}: {error}")


if __name__ == "__main__":
    main()
