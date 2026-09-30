FROM ollama/ollama@sha256:0c0a83210471fb50226bcdc2d6611d20ab13ae87e024cc304c94a6a5765c5e65
RUN rm -rf /usr/lib/ollama/cuda_v12
COPY cuda_v12 /usr/lib/ollama/cuda_v12
ENV OLLAMA_LLM_LIBRARY=cuda_v12
