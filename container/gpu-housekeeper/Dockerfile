FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    docker.io \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /service

COPY container/gpu-housekeeper/service/server.py /service/server.py
COPY container/gpu-housekeeper/service/strata_context_helper.py /service/strata_context_helper.py
COPY container/gpu-housekeeper/service/strata_context_client.py /service/strata_context_client.py

EXPOSE 18886

ENTRYPOINT ["python3", "/service/server.py"]
CMD ["--host", "0.0.0.0", "--port", "18886", "--host-id", "gpu-housekeeper"]
