FROM ubuntu:24.04

LABEL org.opencontainers.image.title="Pyash ZIM tools"
LABEL org.opencontainers.image.description="ZIM creation, inspection, full-text search, and serving tools for Pyash"
LABEL org.opencontainers.image.source="https://gitlab.com/pyac/pyash"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends kiwix-tools zim-tools \
    && rm -rf /var/lib/apt/lists/*

COPY archive-illustration.png /usr/share/pyash/zim/archive-illustration.png

WORKDIR /work
CMD ["bash"]
