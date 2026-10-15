# One image for the web app and the operator scripts (migrations, classifier
# import, demo seed, retention). See DEPLOY.md.
FROM node:22-bookworm-slim AS base
# Prisma's query engine needs OpenSSL; ca-certificates for the classifier download.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
# Dev dependencies stay: tsx runs the import and maintenance scripts in production.
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
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
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
