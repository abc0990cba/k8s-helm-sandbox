FROM golang:1.21.0

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /main ./cmd/main.go

ENV PORT 8080
EXPOSE 8080

CMD ["/main"]