# Единственная точка входа контура: TLS (ACME), статика кабинета и прокси
# на Backend и Game Server. Контекст сборки — корень репозитория.

FROM node:24-bookworm-slim AS spa

WORKDIR /app

COPY Frontend/package.json Frontend/package-lock.json Frontend/.npmrc ./
RUN npm ci --include=dev

COPY Frontend/ ./
# Пустой VITE_API_URL — API на том же origin (/api).
ENV VITE_API_URL=
RUN npm run build

FROM caddy:2.10

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=spa /app/dist /srv/spa
