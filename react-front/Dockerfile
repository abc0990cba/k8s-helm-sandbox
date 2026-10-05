FROM node:20-alpine AS build

WORKDIR /app

COPY package.json .

RUN npm install

# Vite bakes VITE_* at build time — override per environment with --build-arg
# (defaults reproduce the *.test minikube/LAN deployment; see scripts/build-front.sh)
ARG VITE_KEYCLOAK_URL=http://auth.test/
ARG VITE_KEYCLOAK_REALM=demorealm
ARG VITE_KEYCLOAK_CLIENT=reactclient
ARG VITE_REDIRECT_URL=http://grogu.test/

COPY . .

RUN npm run build

# non-root runtime: /app (and dist) owned by `node` so vite's config loader can
# write its temp bundle next to vite.config.ts at preview startup
FROM node:20-alpine

WORKDIR /app

COPY --from=build --chown=node:node /app /app

USER node

EXPOSE 8080

CMD [ "npm", "run", "preview" ]
