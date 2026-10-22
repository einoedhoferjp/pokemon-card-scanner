# Edge-Container: baut die PWA und liefert sie ueber Caddy aus, der zugleich
# Reverse-Proxy fuer die API und TLS-Endpunkt ist.
#
# Web + API liegen dadurch auf **einer** Herkunft: keine CORS-Sonderfaelle,
# Cookies bleiben erst-parteiisch und `Secure` funktioniert.

FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

# Leere Basis = Anfragen laufen relativ (siehe apps/web/src/lib/api.ts)
ENV VITE_API_URL=same-origin

RUN pnpm --filter @app/web build

# --- Caddy ----------------------------------------------------------------

FROM caddy:2-alpine

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv

EXPOSE 80 443
