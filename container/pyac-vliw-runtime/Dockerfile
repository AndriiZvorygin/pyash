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

RUN cargo build --release \
    --manifest-path /src/rust/pyac-gpu/worker/Cargo.toml \
    --bin pyac-vliw-gpu-worker \
    --bin pyac-vliw-runtime \
  && cargo gpu build --auto-install-rust-toolchain \
    --shader-crate /src/rust/pyac-gpu/shader \
    --target spirv-unknown-vulkan1.2 \
    --output-dir /src/rust/pyac-gpu/target/generated/vulkan

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV PYAC_VLIW_RUNTIME_HOST=0.0.0.0 \
    PYAC_VLIW_RUNTIME_PORT=18887 \
    PYAC_VLIW_WORKER_PATH=/service/pyac-vliw-gpu-worker \
    PYAC_VLIW_SPIRV_PATH=/service/pyac_vliw_gpu_kernel.spv \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics \
    VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libvulkan1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /service
COPY --from=vliw-build /src/rust/pyac-gpu/worker/target/release/pyac-vliw-gpu-worker /service/pyac-vliw-gpu-worker
COPY --from=vliw-build /src/rust/pyac-gpu/worker/target/release/pyac-vliw-runtime /service/pyac-vliw-runtime
COPY --from=vliw-build /src/rust/pyac-gpu/target/generated/vulkan/pyac_vliw_gpu_kernel.spv /service/pyac_vliw_gpu_kernel.spv

EXPOSE 18887
ENTRYPOINT ["/service/pyac-vliw-runtime"]
