FROM golang:1.25 AS build

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /main ./cmd/main.go

# static + nonroot (uid 65532) — matches the runAsNonRoot the chart applies
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /main /main

USER nonroot:nonroot

ENTRYPOINT ["/main"]

# Image builds: .gitea/workflows/build-deploy.yml (tag = git SHA, registry per orbstack mode).
