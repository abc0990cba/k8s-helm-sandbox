FROM rust:1 AS build

WORKDIR /app

COPY . .

# bundled duckdb compiles the C++ engine into the binary — no runtime .so needed
RUN cargo build --release

FROM gcr.io/distroless/cc-debian12:nonroot

COPY --from=build /app/target/release/rust-back /rust-back

ENV PORT=8080 \
    DUCKDB_PATH=/data/clicks.duckdb

ENTRYPOINT ["/rust-back"]

# Image builds: .gitea/workflows/build-deploy.yml (tag = git SHA, registry per orbstack mode).
# rebuilt for the polyglot split (nodejs->libsql, +rust/duckdb, react 19)
