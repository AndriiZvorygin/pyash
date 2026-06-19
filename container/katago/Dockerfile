FROM ubuntu:24.04

ARG KATAGO_VERSION=v1.16.5
ARG KATAGO_ARCH=x64

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip libgomp1 \
  && rm -rf /var/lib/apt/lists/*

RUN curl -L "https://github.com/lightvector/KataGo/releases/download/${KATAGO_VERSION}/katago-${KATAGO_VERSION}-eigen-linux-${KATAGO_ARCH}.zip" -o /tmp/katago.zip \
  && unzip /tmp/katago.zip -d /opt/katago \
  && find /opt/katago -type f -name katago -exec cp {} /usr/local/bin/katago \; \
  && chmod +x /usr/local/bin/katago \
  && rm -f /tmp/katago.zip

WORKDIR /workspace
CMD ["sleep", "infinity"]
