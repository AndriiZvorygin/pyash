FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/cache/huggingface
ENV TRANSFORMERS_CACHE=/cache/huggingface
ENV TORCH_HOME=/cache/torch

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel

RUN python3 -m pip install --no-cache-dir \
  "torch==2.6.0" \
  --index-url https://download.pytorch.org/whl/cu124

RUN python3 -m pip install --no-cache-dir \
  "transformers==4.57.1" \
  "accelerate>=1.2,<2" \
  "safetensors>=0.5,<1" \
  "sentencepiece>=0.2,<1"

WORKDIR /service

COPY program/runtime/criterion/huggingface_worker.py /service/huggingface_worker.py
COPY container/criterion-huggingface/service/server.py /service/server.py

EXPOSE 8020

ENTRYPOINT ["python3", "/service/server.py"]
