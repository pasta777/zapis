# ─────────────────────────────────────────────────────────────────
#  Zapis, as one container: the API and the built frontend on one
#  port, with the database on a mounted volume.
#
#  Two stages, because better-sqlite3 is a native module. The build
#  stage carries python3/make/g++ to compile it; the runtime image
#  inherits the compiled result and none of the toolchain.
# ─────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Dependencies first: this layer is cached until the lockfile changes,
# which is what keeps a code-only redeploy from recompiling SQLite.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Typechecks, then emits dist/. A build that fails here fails the deploy
# rather than shipping a stale bundle.
RUN npm run build


FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# node_modules is copied wholesale rather than reinstalled. A second
# `npm ci` here would try to build better-sqlite3 again with no compiler
# in the image, and the server runs its TypeScript through tsx — a dev
# dependency — so there is nothing meaningful to prune anyway.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY server ./server
COPY src ./src
COPY tsconfig.json ./

# Where the Fly volume gets mounted; override DB_PATH to put it elsewhere.
ENV DB_PATH=/data/zapis.db
ENV PORT=8080
EXPOSE 8080

RUN mkdir -p /data && chown -R node:node /data /app
USER node

CMD ["npx", "tsx", "server/index.ts"]
