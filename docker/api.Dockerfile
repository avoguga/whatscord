# WhatsCord API — built from the monorepo root.
#
# Coolify builds this on the same VPS that runs the app, so the build stays
# deliberately cheap: no native toolchain, no Rust, and the runtime image
# carries only production dependencies.

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
# The web and desktop workspaces are not needed to build the API, but npm
# resolves the whole workspace graph, so they get placeholder manifests.
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root || npm install --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
# Coolify passes the app's env into the build, and NODE_ENV=production makes npm
# skip devDependencies — which is where typescript and the @types live. Forcing
# it back to development here is what keeps `tsc` available at build time.
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN npm install --include=dev
COPY apps/api ./apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npx tsc -p apps/api/tsconfig.json

FROM node:22-alpine AS runtime
WORKDIR /app
# curl is here for the healthcheck: Coolify replaces the image's own HEALTHCHECK
# with a curl/wget probe, and node:alpine ships neither by default.
RUN apk add --no-cache openssl tini curl \
 && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY apps/api/package.json ./package.json
COPY apps/api/prisma ./prisma

USER app
EXPOSE 3001

# No HEALTHCHECK here on purpose. Coolify honours the image's own probe when it
# finds one and then ignores its configured settings, which hides the real path
# (/health) and the grace period the boot migration needs.

ENTRYPOINT ["/sbin/tini", "--"]
# Migrations run at boot: the database is only reachable from inside the
# Docker network, so there is no other moment to apply them.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/server.js"]
