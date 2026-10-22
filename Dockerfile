# One image for the web app and the operator scripts (migrations, classifier
# import, demo seed, retention). See DEPLOY.md. The repository is an npm
# workspace (apps/*, packages/*); everything runs from /app, the root.
FROM node:22-bookworm-slim AS base
# Prisma's query engine needs OpenSSL; ca-certificates for the classifier download.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
# Every workspace's manifest, so npm ci links @tasnivo/* and installs their dependencies.
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/i18n/package.json packages/i18n/
# Dev dependencies stay: tsx runs the import and maintenance scripts in production.
RUN npm ci --no-audit --no-fund

FROM base AS build
# The whole deps stage: node_modules (with the workspace links) and any per-workspace node_modules.
COPY --from=deps /app ./
COPY . .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_DEMO_URL=/demo
ARG NEXT_PUBLIC_TELEGRAM_URL=
ARG NEXT_PUBLIC_SITE_URL=
ARG NEXT_PUBLIC_SHOW_LEGAL_223=false
ARG NEXT_PUBLIC_FEATURE_MULTI_CLIENT=false
ENV NEXT_PUBLIC_DEMO_URL=$NEXT_PUBLIC_DEMO_URL \
    NEXT_PUBLIC_TELEGRAM_URL=$NEXT_PUBLIC_TELEGRAM_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SHOW_LEGAL_223=$NEXT_PUBLIC_SHOW_LEGAL_223 \
    NEXT_PUBLIC_FEATURE_MULTI_CLIENT=$NEXT_PUBLIC_FEATURE_MULTI_CLIENT \
    NEXT_TELEMETRY_DISABLED=1
# Root package.json points prisma at packages/db/prisma/schema.prisma; build runs `next build apps/web`.
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
