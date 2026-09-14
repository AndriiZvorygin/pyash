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
    },
}


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
        "metadata": {
            "engine": "huggingface",
            "modelId": model_id,
            "modelRevision": revision,
            "tokenizerRevision": revision,
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
            "loadTimeMs": load_ms,
        },
    }


def generate(state, request):
    prompt = str(request.get("input") or request.get("prompt") or "")
    tokenizer = state["tokenizer"]
    model = state["model"]
    torch = state["torch"]
    generation = state["generation"]
    limit = int(generation.get("maxInputTokens") or 4096)
    all_tokens = tokenizer(prompt, add_special_tokens=True, truncation=False)["input_ids"]
    truncated = len(all_tokens) > limit
    started = time.perf_counter()
    encoded = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=limit)
    encoded = {key: value.to(state["device"]) for key, value in encoded.items()}
    input_tokens = int(encoded["input_ids"].shape[-1])
    with torch.inference_mode():
        output = model.generate(
            **encoded,
            num_beams=int(generation.get("numBeams") or 1),
            min_length=int(generation.get("minOutputTokens") or 1),
            max_length=int(generation.get("maxOutputTokens") or 142),
            length_penalty=float(generation.get("lengthPenalty") or 1.0),
        )
    text = tokenizer.decode(output[0], skip_special_tokens=True).strip()
    elapsed_ms = (time.perf_counter() - started) * 1000
    output_tokens = int(output.shape[-1])
    return {
        "text": text,
        "effectiveThink": False,
        "reasoningMode": "direct",
        "metadata": {"truncated": truncated, "inputLimit": limit},
        "timing": {
            "promptTokens": input_tokens,
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
