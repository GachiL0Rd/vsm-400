# node:24 — LTS из .nvmrc. bookworm-slim, не alpine:
# schema-engine Prisma 7 (migrate deploy) — нативный бинарь под OpenSSL/glibc,
# его качает postinstall @prisma/engines под платформу сборки.
# argon2 0.45.1 (пакет подключит auth) на этой базе грузит glibc-prebuild
# без компилятора; на node:24-alpine prebuild тоже есть, но musl-engine
# Prisma пришлось бы держать отдельным базовым образом.

FROM node:24-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps

COPY package.json package-lock.json .npmrc ./
COPY prisma.config.ts ./
COPY prisma ./prisma

# generate не ходит в БД, но prisma.config.ts требует непустой DATABASE_URL.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

RUN npm ci

FROM deps AS build

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY content ./content

RUN npx prisma generate && npm run build

FROM base AS prod

COPY package.json package-lock.json .npmrc ./
COPY prisma.config.ts ./
COPY prisma ./prisma

ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

# postinstall корня зовёт prisma generate, а CLI — devDependency, поэтому
# npm ci идёт с --ignore-scripts. Повторный npm install CLI в npm 11 тоже
# не выполняет postinstall @prisma/engines (allowScripts), а без schema-engine
# migrate deploy не стартует. Качаем бинарь явным вызовом.
RUN npm ci --omit=dev --ignore-scripts \
  && npm install --no-save --omit=dev prisma@7.10.0 \
  && node node_modules/@prisma/engines/scripts/postinstall.js \
  && ./node_modules/.bin/prisma --version

FROM base AS runtime

ENV NODE_ENV=production
ENV PATH=/app/node_modules/.bin:$PATH

COPY --from=prod --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/content ./content
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
