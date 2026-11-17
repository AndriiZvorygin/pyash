FROM rust:1.99.1-bookworm AS vliw-build

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates build-essential libvulkan-dev \
  && rm -rf /var/lib/apt/lists/* \
  && rustup toolchain install nightly-2026-08-15 --profile minimal --component rust-src \
  && cargo install --git https://github.com/rust-gpu/rust-gpu --tag v0.11.0 cargo-gpu --locked

WORKDIR /src
COPY rust-toolchain.toml /src/rust-toolchain.toml
COPY rust/pyac /src/rust/pyac
COPY rust/pyac-vliw-core /src/rust/pyac-vliw-core
COPY rust/pyac-gpu /src/rust/pyac-gpu

RUN cargo build --release --manifest-path /src/rust/pyac-gpu/worker/Cargo.toml \
  && cargo gpu build --auto-install-rust-toolchain --shader-crate /src/rust/pyac-gpu/shader --target spirv-unknown-vulkan1.2 \
    --output-dir /src/rust/pyac-gpu/target/generated/vulkan

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    docker.io \
    libegl1 \
    libvulkan1 \
    libx11-6 \
    libxext6 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /service

COPY container/gpu-housekeeper/service/server.py /service/server.py
COPY container/gpu-housekeeper/service/kubernetes_runtime.py /service/kubernetes_runtime.py
COPY container/gpu-housekeeper/service/strata_context_helper.py /service/strata_context_helper.py
COPY container/gpu-housekeeper/service/strata_context_client.py /service/strata_context_client.py
COPY --from=vliw-build /src/rust/pyac-gpu/worker/target/release/pyac-vliw-gpu-worker /service/pyac-vliw-gpu-worker
COPY --from=vliw-build /src/rust/pyac-gpu/target/generated/vulkan/pyac_vliw_gpu_kernel.spv /service/pyac_vliw_gpu_kernel.spv

EXPOSE 18886

ENTRYPOINT ["python3", "/service/server.py"]
CMD ["--host", "0.0.0.0", "--port", "18886", "--host-id", "gpu-housekeeper"]
