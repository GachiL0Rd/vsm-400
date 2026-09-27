# node:24 — LTS из .nvmrc. Сборка кладёт в dist/ самодостаточный сервер
# (vite ssr noExternal), браузерный клиент и versioned content bundle,
# поэтому runtime-образу node_modules не нужны.

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV GAME_SERVER_HOST=0.0.0.0
ENV GAME_SERVER_PORT=4174

WORKDIR /app

COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 4174

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GAME_SERVER_PORT||4174)+'/ready').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/main.mjs"]
