FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./

# npm install (not ci), from package.json only: the git lockfile is regenerated
# on the dev Mac and omits rollup's linux/arm64 native optional dep there, which
# breaks `vite build` on any other platform (npm 11 --package-lock-only gap).
# The supply-critical dep (vite) is pinned EXACT in package.json, so this stays
# deterministic enough while resolving the right platform bits.
RUN npm install

# Vite bakes VITE_* at build time — override per environment with --build-arg
# (defaults reproduce the *.test minikube/LAN deployment; see scripts/build-front.sh)
ARG VITE_KEYCLOAK_URL=http://auth.test/
ARG VITE_KEYCLOAK_REALM=demorealm
ARG VITE_KEYCLOAK_CLIENT=reactclient
ARG VITE_REDIRECT_URL=http://grogu.test/

COPY . .

RUN npm run build

# non-root runtime: /app owned by `node` so vite's config loader can write its
# temp bundle next to vite.config.ts at preview startup (COPY --chown owns the
# content but WORKDIR leaves the directory itself root-owned — chown it too)
FROM node:20-alpine

WORKDIR /app

COPY --from=build --chown=node:node /app /app

RUN chown node:node /app

USER node

EXPOSE 8080

CMD [ "npm", "run", "preview" ]
