# Smart Search Service — Production Image
# Model ONNX (@huggingface/transformers) di-BAKE ke image agar cold-start = 0
# (tanpa menunggu download model saat request pertama).
FROM oven/bun:1-slim AS base

WORKDIR /app

# ---- deps ----
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- source ----
COPY src ./src

# ---- pre-bake model (Xenova/multilingual-e5-small q8) ke image ----
COPY prebake-model.ts ./
ENV HF_HOME=/app/.cache \
    LOCAL_MODEL_ID=Xenova/multilingual-e5-small \
    LOCAL_MODEL_DTYPE=q8
RUN bun run prebake-model.ts

ENV NODE_ENV=production \
    SEARCH_PORT=4000

EXPOSE 4000

CMD ["bun", "run", "src/server.ts"]
