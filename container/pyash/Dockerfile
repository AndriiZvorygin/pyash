FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    docker.io \
    docker-buildx \
    docker-compose-v2 \
    dnsutils \
    git \
    openssh-client \
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
    yt-dlp \
    pandoc \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-fonts-recommended \
    texlive-plain-generic \
    lmodern \
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
    libcurl4-openssl-dev \
    libpulse-dev \
    libsdl2-dev \
    libsndfile1 \
    libgomp1 \
    libyaml-dev \
    xdotool \
    ripgrep \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
  && (apt-get install -y --no-install-recommends nvidia-utils-550 || apt-get install -y --no-install-recommends nvidia-utils-535) \
  && rm -rf /var/lib/apt/lists/*

# uvx (MCP helpers)
RUN python3 -m pip install --no-cache-dir --break-system-packages uv

# Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Playwright CLI + browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/playwright
RUN npx --yes playwright install --with-deps chromium firefox webkit

# Whisper.cpp shared libraries (for caterer/hear binaries)
RUN git clone --depth 1 --branch v1.8.2 https://github.com/ggml-org/whisper.cpp.git /tmp/whisper.cpp \
  && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -D BUILD_SHARED_LIBS=ON -D CMAKE_BUILD_TYPE=Release \
  && cmake --build /tmp/whisper.cpp/build -j \
  && find /tmp/whisper.cpp/build -type f -name 'libwhisper.so*' -print0 | xargs -0 -I {} cp {} /usr/local/lib/ \
  && find /tmp/whisper.cpp/build -type f -name 'libggml*.so*' -print0 | xargs -0 -I {} cp {} /usr/local/lib/ \
  && ldconfig \
  && rm -rf /tmp/whisper.cpp

COPY caterer/wasmtime/bin/wasmtime /usr/local/bin/wasmtime
COPY caterer/quickjs-wasi/qjs.wasm /usr/local/share/pyash/qjs.wasm
RUN chmod +x /usr/local/bin/wasmtime

WORKDIR /workplace

ARG CODEX_VERSION=latest
ARG CODEX_REFRESH=0
RUN echo "codex-refresh=${CODEX_REFRESH}" >/tmp/codex_refresh \
  && npm install -g @openai/codex@${CODEX_VERSION}
