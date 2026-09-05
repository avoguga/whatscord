# WhatsCord web — a mesma UI que o Tauri carrega, servida por nginx.
#
# Existe por dois motivos: o app desktop usa single-instance (nao dá para abrir
# duas janelas na mesma maquina para testar uma conversa), e um navegador serve
# de segundo cliente sem instalar nada. Chrome tambem faz getDisplayMedia, entao
# o compartilhamento de tela pode ser testado por aqui.

FROM node:22-alpine AS build
WORKDIR /app
# NODE_ENV=production faria o npm pular devDependencies, e vite/typescript sao
# devDependencies — sem isso o build nao existe.
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN npm install --include=dev
COPY apps/web ./apps/web
# `vite build` recebe o root como argumento posicional, nao como --root.
# Rodar de dentro do workspace resolve: o npx acha o node_modules hoisted na raiz.
WORKDIR /app/apps/web
RUN npx vite build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  gzip on;' \
  '  gzip_types text/css application/javascript application/json image/svg+xml;' \
  '  location /healthz { return 200 "ok"; add_header Content-Type text/plain; }' \
  '  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }' \
  '  # Single-page app: qualquer rota cai no index.' \
  '  location / { try_files $uri $uri/ /index.html; }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD curl -fsS http://127.0.0.1/healthz || exit 1
