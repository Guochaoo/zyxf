# better-sqlite3 v12 requires Node >= 22 — no prebuilt binary exists for
# node 20, so we build on node:24-slim and pull the prebuilt binary from the
# npmmirror mirror (GitHub releases are unreachable from the server, and
# compiling from source needs a toolchain that slim images lack).
FROM node:24-slim AS builder
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
ENV npm_config_better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:24-slim
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
