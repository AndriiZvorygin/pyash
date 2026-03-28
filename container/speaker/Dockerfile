FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel

# Pin a CUDA-compatible torch stack and SpeechBrain API behavior.
RUN python3 -m pip install --no-cache-dir \
  "numpy" \
  "torch==2.6.0" \
  "torchaudio==2.6.0" \
  --index-url https://download.pytorch.org/whl/cu124

RUN python3 -m pip install --no-cache-dir \
  "speechbrain==1.0.3" \
  "huggingface_hub<1.0"

WORKDIR /workplace
