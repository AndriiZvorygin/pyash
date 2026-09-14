# Criterion Hugging Face Runtime

This is the GPU-managed runtime for Criterion's fine-tuned sequence-to-sequence
models. It is a Pyash GPU duty service, not a second benchmark scheduler.

Build and start it on the CUDA host:

```sh
./container/criterion-huggingface/command/begin.sh
```

The service listens on port `8020` and keeps one requested Transformers model
warm. Model files are stored in the ignored `cache/huggingface` directory.
The Pyash `gpu-housekeeper` registers this service as the `huggingface` runtime
and accepts `huggingface-generate` jobs. Criterion submits those jobs through
the ordinary durable GPU lane and writes the sample checkpoint locally.

Stop it without removing the model cache:

```sh
./container/criterion-huggingface/command/stop.sh
```

The image uses an NVIDIA CUDA runtime and the GPU Compose override. The
development machine only needs Node and access to the configured Pyash
housekeeper; Python and model packages stay inside the container.
