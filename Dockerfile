FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/packages/db/migrations ./packages/db/migrations
USER node
EXPOSE 3000
CMD ["node","apps/web/server.js"]

FROM node:24-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node","apps/worker/dist/index.js"]

FROM node:24-bookworm-slim AS migrate
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node","packages/db/dist/migrate.js"]
