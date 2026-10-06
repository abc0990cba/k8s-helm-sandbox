mod config;
mod db;
mod metrics;
mod stream;

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::{routing::get, Json, Router};
use prometheus::{Encoder, TextEncoder};
use tokio::sync::watch;

use crate::config::Config;
use crate::db::Db;

#[derive(Clone)]
struct AppState {
    db: Arc<Db>,
    redis: redis::Client,
    registry: prometheus::Registry,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = Config::from_env();

    // the PVC mountpoint provides /data in-cluster; create it for local runs
    if let Some(parent) = std::path::Path::new(&cfg.duckdb_path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let db = Arc::new(Db::open(&cfg.duckdb_path)?);
    let registry = prometheus::Registry::new();
    let metrics = metrics::Metrics::new(&registry)?;
    let redis_client = redis::Client::open(cfg.redis_url.clone())?;
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // the analytics consumer lives in the same process as the API: DuckDB is
    // in-process, one binary owns the file — single writer by construction
    let consumer = stream::Consumer::new(cfg.click_stream.clone(), cfg.consumer_group.clone());
    let consumer_task = tokio::spawn(consumer.run(
        redis_client.clone(),
        Arc::clone(&db),
        metrics,
        shutdown_rx.clone(),
    ));

    let state = AppState {
        db: Arc::clone(&db),
        redis: redis_client,
        registry,
    };
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/ready", get(ready))
        .route("/metrics", get(metrics_route))
        .route("/analytics/summary", get(analytics_summary))
        .route("/analytics/top", get(analytics_top))
        .route("/analytics/links/{code}", get(analytics_link))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    println!("analytics API listening on {}", cfg.port);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(shutdown_tx, consumer_task, db))
        .await?;
    Ok(())
}

async fn healthz() -> &'static str {
    "healthy"
}

async fn ready(State(state): State<AppState>) -> StatusCode {
    let db_ok = state.db.ready().await;
    let redis_ok = redis_ping(&state.redis).await.unwrap_or(false);
    if db_ok && redis_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

async fn redis_ping(client: &redis::Client) -> Option<bool> {
    let mut con = client.get_multiplexed_async_connection().await.ok()?;
    let pong: String = redis::cmd("PING").query_async(&mut con).await.ok()?;
    Some(pong == "PONG")
}

async fn metrics_route(State(state): State<AppState>) -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let mut buffer = Vec::new();
    let _ = encoder.encode(&state.registry.gather(), &mut buffer);
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        String::from_utf8_lossy(&buffer).into_owned(),
    )
}

async fn analytics_summary(State(state): State<AppState>) -> impl IntoResponse {
    json_or_500(state.db.summary().await)
}

async fn analytics_link(
    Path(code): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    json_or_500(state.db.link_stats(code).await)
}

async fn analytics_top(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<i64>().ok())
        .map(|l| l.clamp(1, 100))
        .unwrap_or(10);
    match state.db.top(limit).await {
        Ok(items) => Ok(Json(serde_json::json!({ "items": items }))),
        Err(e) => Err(duckdb_500(e)),
    }
}

fn json_or_500<T: serde::Serialize>(
    result: duckdb::Result<T>,
) -> Result<Json<T>, (StatusCode, String)> {
    result.map(Json).map_err(duckdb_500)
}

fn duckdb_500(e: duckdb::Error) -> (StatusCode, String) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("analytics query failed: {e}"),
    )
}

async fn shutdown_signal(
    shutdown_tx: watch::Sender<bool>,
    consumer_task: tokio::task::JoinHandle<()>,
    db: Arc<Db>,
) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    println!("shutdown signal received: stopping the consumer, then checkpointing DuckDB");
    let _ = shutdown_tx.send(true);
    let _ = consumer_task.await;
    db.checkpoint().await;
    println!("shutdown complete");
}
