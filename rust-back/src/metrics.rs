use prometheus::Registry;

#[derive(Clone)]
pub struct Metrics {
    pub clicks_ingested: prometheus::IntCounter,
    pub entries_skipped: prometheus::IntCounter,
    pub stream_errors: prometheus::IntCounter,
}

impl Metrics {
    pub fn new(registry: &Registry) -> prometheus::Result<Self> {
        let clicks_ingested = prometheus::IntCounter::new(
            "analytics_clicks_ingested_total",
            "Click events committed to DuckDB",
        )?;
        let entries_skipped = prometheus::IntCounter::new(
            "analytics_entries_skipped_total",
            "Stream entries dropped (malformed payload)",
        )?;
        let stream_errors = prometheus::IntCounter::new(
            "analytics_stream_errors_total",
            "Redis stream errors (read or ingest failures)",
        )?;
        registry.register(Box::new(clicks_ingested.clone()))?;
        registry.register(Box::new(entries_skipped.clone()))?;
        registry.register(Box::new(stream_errors.clone()))?;
        Ok(Self {
            clicks_ingested,
            entries_skipped,
            stream_errors,
        })
    }
}
