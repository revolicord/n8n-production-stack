# syntax=docker/dockerfile:1.7
# Multi-stage build para apps/api
# Build context: raíz del monorepo

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# ──────────────── deps ────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ──────────────── build ────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN pnpm -r build

# ──────────────── runtime ────────────────
FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/.npmrc ./
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/packages/db/package.json ./packages/db/
COPY --from=build /repo/packages/shared/package.json ./packages/shared/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist

WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
