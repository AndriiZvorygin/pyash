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
    libgomp1 \
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
  && rm -rf /var/lib/apt/lists/*

# Whisper.cpp shared libraries (for caterer/hear binaries)
RUN git clone --depth 1 --branch v1.8.2 https://github.com/ggml-org/whisper.cpp.git /tmp/whisper.cpp \
  && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -D BUILD_SHARED_LIBS=ON -D CMAKE_BUILD_TYPE=Release \
  && cmake --build /tmp/whisper.cpp/build -j \
  && find /tmp/whisper.cpp/build -type f -name 'libwhisper.so*' -exec cp {} /usr/local/lib/ \\; \
  && find /tmp/whisper.cpp/build -type f -name 'libggml.so*' -exec cp {} /usr/local/lib/ \\; \
  && ldconfig \
  && rm -rf /tmp/whisper.cpp

COPY caterer/wasmtime/bin/wasmtime /usr/local/bin/wasmtime
COPY caterer/quickjs-wasi/qjs.wasm /usr/local/share/pyash/qjs.wasm
RUN chmod +x /usr/local/bin/wasmtime

WORKDIR /workplace
