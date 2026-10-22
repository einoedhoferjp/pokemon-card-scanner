# API (Fastify + Drizzle) fuer den Betrieb: Build-Stufe kompiliert TypeScript,
# die Laufzeit-Stufe enthaelt nur das Noetige.
#
# Migrationen laufen beim Start, wenn MIGRATE_ON_START=1 gesetzt ist.

FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# Nur die Manifeste zuerst: dieser Layer bleibt bei Codeaenderungen im Cache.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @app/api build \
    # tsc kopiert keine .sql-Dateien -> Migrationen neben das gebaute JS legen
    && cp -r apps/api/src/db/migrations apps/api/dist/db/migrations

# --- Laufzeit -------------------------------------------------------------

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

# Als Host-Nutzer laufen, damit hochgeladene Fotos im Volume nicht root gehoeren.
# Beim Bauen anpassen: --build-arg PUID=$(id -u) --build-arg PGID=$(id -g)
ARG PUID=1000
ARG PGID=1000

WORKDIR /repo

# sharp (Bildverarbeitung) und @node-rs/argon2 bringen vorkompilierte Binaries
# mit - es ist kein Build-Werkzeug im Image noetig.
#
# Wichtig: pnpm legt die Abhaengigkeiten eines Workspace-Pakets als Symlinks in
# `apps/api/node_modules` ab (Ziele im Store `node_modules/.pnpm`). Beide muessen
# mit, sonst findet Node die Module nicht. `@shared/types` zeigt auf
# `packages/shared` - das Paket wird deshalb ebenfalls kopiert (Laufzeit braucht
# es nicht, die API nutzt nur Typen daraus).
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/src ./packages/shared/src
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist

RUN groupadd --gid "${PGID}" pcs \
    && useradd --uid "${PUID}" --gid "${PGID}" --create-home --shell /usr/sbin/nologin pcs \
    && mkdir -p /repo/data/uploads \
    && chown -R "${PUID}:${PGID}" /repo/data

USER pcs

WORKDIR /repo/apps/api

EXPOSE 3000

# Healthcheck ohne zusaetzliche Werkzeuge (Node 22 hat fetch)
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
