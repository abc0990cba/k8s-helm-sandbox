FROM golang:1.21.0

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# CI builds from a clean checkout have no .env (gitignored); godotenv
# log.Fatals without it — real config comes from pod env anyway
RUN test -f .env || printf 'PORT=8081\n' > .env

RUN CGO_ENABLED=0 GOOS=linux go build -o /main ./cmd/main.go

CMD ["/main"]