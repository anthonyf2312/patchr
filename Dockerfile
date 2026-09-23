# syntax=docker/dockerfile:1

# Build on Debian so TypeScript's native compiler has glibc; nothing native reaches the final image.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production \
    HEALTH_PORT=3000 \
    PGLITE_DIR=/app/data/pglite
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY drizzle ./drizzle
COPY assets ./assets

# /app/data only matters when running without Postgres (PGlite). Mount a volume there to keep it.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/index.js"]
