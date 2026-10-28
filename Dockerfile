# One multi-stage build for the npm workspace; pick the service with --target:
#
#   docker build --target web    -t mxik-audit-web .      Next.js (apps/web), port 3000
#   docker build --target api    -t mxik-audit-api .      NestJS HTTP (apps/api), API_PORT 4000
#   docker build --target worker -t mxik-audit-worker .   NestJS + BullMQ (apps/worker), the
#                                                         Telegram bot and the operator scripts
#
# docker-compose.yml builds all three. Every image runs from /app, the repository root (data/,
# node_modules/dejavu-fonts-ttf and scripts/ resolve against the working directory), as user node.
# api and worker are the same image apart from the command and the healthcheck (plan, section 3).
FROM node:22-bookworm-slim AS base
# Prisma's engines need OpenSSL; ca-certificates for the classifier download and the model weights.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# The local embedding model runs on the CPU here: onnxruntime-node's install script would otherwise
# fetch the CUDA provider (hundreds of MB, from api.nuget.org) into every image.
ENV ONNXRUNTIME_NODE_INSTALL=skip
WORKDIR /app

# Only the package manifests, so the npm ci layers below stay cached until a dependency changes.
# Collected with find rather than listed, so a new workspace (apps/api, packages/contracts, ...)
# needs no edit here. COPY --from compares contents, so a source edit does not invalidate them.
FROM base AS manifests
COPY . /src
RUN mkdir /out && cd /src \
  && cp package.json package-lock.json /out/ \
  && find apps packages -mindepth 2 -maxdepth 2 -name package.json -exec cp --parents {} /out/ \;

# Everything, dev dependencies included: what the builds need.
FROM base AS deps
COPY --from=manifests /out ./
RUN npm ci --no-audit --no-fund

# Production dependencies plus tsx, which the runtime images keep: the bot, the operator scripts
# (scripts/*.ts) and the classifier update the app spawns (packages/domain/src/classifier-start.ts)
# all run TypeScript through it. tsx is a root devDependency, so it is installed on its own (same
# version as the lockfile) and copied in without overwriting anything. Then the native binaries no
# Linux container loads: onnxruntime-node ships every OS and CPU (~250 MB), Next both libc builds of SWC.
FROM base AS prod-deps
COPY --from=manifests /out ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && mkdir /tmp/tsx && cd /tmp/tsx && echo '{"private":true}' > package.json \
  && npm install --no-audit --no-fund --no-package-lock \
       "tsx@$(node -p "require('/app/package-lock.json').packages['node_modules/tsx'].version")" \
  && cp -an /tmp/tsx/node_modules/. /app/node_modules/ && cd /app && rm -rf /tmp/tsx \
  && ort=node_modules/onnxruntime-node/bin/napi-v6 \
  && arch="$(node -p process.arch)" \
  && if [ -d "$ort/linux/$arch" ]; then \
       find "$ort" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
       && find "$ort/linux" -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} +; \
     fi \
  && rm -rf node_modules/@next/swc-*-musl \
  && npm cache clean --force

# Next.js. NEXT_PUBLIC_* values are inlined into the browser bundle here: rebuild after changing.
FROM deps AS build-web
COPY . .
ARG NEXT_PUBLIC_DEMO_URL=/demo
ARG NEXT_PUBLIC_TELEGRAM_URL=
ARG NEXT_PUBLIC_SITE_URL=
ARG NEXT_PUBLIC_SHOW_LEGAL_223=false
ARG NEXT_PUBLIC_FEATURE_MULTI_CLIENT=false
# Empty = the browser calls the API on the page's own origin (Caddy routes /api/* to it).
ARG NEXT_PUBLIC_API_URL=
# next.config.ts bakes the /api/* rewrite target into the build. Behind Caddy it never fires; without
# Caddy (local compose) the default localhost:4000 would be the web container itself.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_PUBLIC_DEMO_URL=$NEXT_PUBLIC_DEMO_URL \
    NEXT_PUBLIC_TELEGRAM_URL=$NEXT_PUBLIC_TELEGRAM_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SHOW_LEGAL_223=$NEXT_PUBLIC_SHOW_LEGAL_223 \
    NEXT_PUBLIC_FEATURE_MULTI_CLIENT=$NEXT_PUBLIC_FEATURE_MULTI_CLIENT \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
# `npm run build` = `next build apps/web`. The web app has no database access (it talks to the API), so
# no Prisma client is generated for it.
RUN npm run build && rm -rf apps/web/.next/cache

# api and worker: root scripts `build:api` / `build:worker` (W1a/W1b) bundle apps/*/src and the
# @tasnivo/* sources with esbuild into apps/api/dist and apps/worker/dist; npm packages stay
# external and load from node_modules at run time. --if-present: before W1a/W1b are merged the
# scripts do not exist and this stage only generates the Prisma client.
FROM deps AS build-server
COPY . .
RUN npx prisma generate \
  && npm run build:api --if-present \
  && npm run build:worker --if-present

# What every runtime image shares: production node_modules, the Prisma client generated for this
# schema, and the sources (the packages are TypeScript source without a build step).
FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY --chown=node:node data ./data

# Pages and assets only: server components read through the API (API_INTERNAL_URL), never the database.
FROM runtime AS web
COPY --from=build-web --chown=node:node /app/packages ./packages
COPY --from=build-web --chown=node:node /app/apps/web ./apps/web
USER node
ENV PORT=3000
EXPOSE 3000
# /api/health belongs to the api service. A static file proves Next answers HTTP without waiting on
# the API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/icon.svg').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["npm", "run", "start"]

FROM runtime AS server
COPY --from=build-server --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build-server --chown=node:node /app/packages ./packages
COPY --from=build-server --chown=node:node /app/scripts ./scripts
COPY --from=build-server --chown=node:node /app/apps ./apps
USER node

# Contract with W1a: root script `start:api`, port API_PORT (default 4000), /api/health.
FROM server AS api
ENV API_PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["npm", "run", "start:api"]

# Contract with W1b: root script `start:worker`, GET /healthz on WORKER_PORT (default 4100).
# The Telegram bot runs from this image too (`npm run telegram:bot`, compose disables the check).
FROM server AS worker
ENV WORKER_PORT=4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_PORT||4100)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["npm", "run", "start:worker"]
