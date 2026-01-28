FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    jq \
    python3 \
    python3-pip \
    python3-venv \
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
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workplace
