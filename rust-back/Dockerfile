FROM rust:1 AS build

WORKDIR /app

COPY . .

# bundled duckdb compiles the C++ engine into the binary — no runtime .so needed
# -j 2: bundled duckdb's single giant C++ TU peaks ~5GB; default parallelism OOMs a small docker VM
RUN CXXFLAGS="-O1" cargo build --release -j 2

# debian13: the rust:1 build stage is trixie-based — cc-debian12's older
# glibc/libstdc++ rejects the binary (GLIBC_2.38 not found)
FROM gcr.io/distroless/cc-debian13:nonroot

COPY --from=build /app/target/release/rust-back /rust-back

ENV PORT=8080 \
    DUCKDB_PATH=/data/clicks.duckdb

ENTRYPOINT ["/rust-back"]

# Image builds: .gitea/workflows/build-deploy.yml (tag = git SHA, registry per orbstack mode).
# rebuilt for the polyglot split (nodejs->libsql, +rust/duckdb, react 19)
