# Imagen única para api y worker: mismo build, distinto entrypoint.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
RUN pnpm install --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules
COPY . .

# El código corre en TypeScript vía tsx: no hay paso de build que pueda
# quedar desincronizado con lo que testeamos.
CMD ["pnpm", "exec", "tsx", "packages/api/src/index.ts"]
