# FROM node:16.17.0-bullseye-slim
# ENV NODE_ENV production
# ENV PORT 8080
# EXPOSE 8080
# WORKDIR /usr/src/app
# COPY --chown=node:node . /usr/src/app
# RUN npm ci --only=production
# USER node
# CMD "npm" "start"

FROM node:22.9.0 AS build

COPY . /app

WORKDIR /app

RUN npm ci --omit=dev

FROM gcr.io/distroless/nodejs22-debian12

COPY --from=build /app /app

WORKDIR /app

CMD ["src/index.js"]