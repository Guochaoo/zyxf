# Debian slim (glibc). better-sqlite3 normally ships a prebuilt binary, but
# when GitHub download fails it falls back to source compile — so the builder
# stage installs the toolchain (python3/make/g++) as a fallback.
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm config set registry https://registry.npmmirror.com
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown node:node /data

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/data.db

USER node
EXPOSE 4000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
