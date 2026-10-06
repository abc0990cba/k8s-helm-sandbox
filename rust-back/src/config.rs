use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub duckdb_path: String,
    pub redis_url: String,
    pub click_stream: String,
    pub consumer_group: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8080),
            duckdb_path: env::var("DUCKDB_PATH").unwrap_or_else(|_| "clicks.duckdb".into()),
            redis_url: env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into()),
            click_stream: env::var("CLICK_STREAM").unwrap_or_else(|_| "clicks".into()),
            consumer_group: env::var("CONSUMER_GROUP").unwrap_or_else(|_| "analytics".into()),
        }
    }
}
