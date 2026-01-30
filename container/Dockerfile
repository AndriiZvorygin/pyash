FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dnsutils \
    git \
    gnupg \
    dialog \
    fd-find \
    file \
    iproute2 \
    iputils-ping \
    jq \
    less \
    netcat-openbsd \
    tree \
    yq \
    pandoc \
    poppler-utils \
    python3 \
    python3-pip \
    python3-venv \
    tmux \
    vim \
    build-essential \
    cmake \
    pkg-config \
    unzip \
    zip \
    xz-utils \
    ffmpeg \
    espeak-ng \
    libasound2-dev \
    libpulse-dev \
    libsdl2-dev \
    libsndfile1 \
    xdotool \
    ripgrep \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
  && rm -rf /var/lib/apt/lists/*

# Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && npm install -g @openai/codex \
  && npm install -D typescript eslint prettier \
  && rm -rf /var/lib/apt/lists/*

COPY caterer/wasmtime/bin/wasmtime /usr/local/bin/wasmtime
COPY caterer/quickjs-wasi/qjs.wasm /usr/local/share/pyash/qjs.wasm
RUN chmod +x /usr/local/bin/wasmtime

WORKDIR /workplace
