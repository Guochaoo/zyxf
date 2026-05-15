# Debian slim (glibc) so better-sqlite3 uses its prebuilt binary — no C++ compile.
# Faster build, larger image (~150MB vs 50MB) — worth it.
FROM node:20-slim AS builder
WORKDIR /app
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
