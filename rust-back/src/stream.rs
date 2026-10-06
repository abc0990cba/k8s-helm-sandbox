use std::collections::HashMap;
use std::sync::Arc;

use redis::aio::MultiplexedConnection;
use redis::streams::StreamReadOptions;
use redis::AsyncCommands;
use redis::Value;
use tokio::sync::watch;
use tokio::time::{sleep, Duration};

use crate::db::Db;
use crate::metrics::Metrics;

/// Consumes the `clicks` stream in a consumer group, exactly like the node
/// worker consumes `jobs` — but in Rust: XREADGROUP → DuckDB insert → XACK.
/// Delivery is at-least-once; the stream entry id dedupes in DuckDB.
pub struct Consumer {
    pub stream: String,
    pub group: String,
}

impl Consumer {
    pub fn new(stream: String, group: String) -> Self {
        Self { stream, group }
    }

    fn consumer_name() -> String {
        format!(
            "analytics-{}",
            std::env::var("HOSTNAME").unwrap_or_else(|_| "local".into())
        )
    }

    async fn ensure_group(&self, con: &mut MultiplexedConnection) -> redis::RedisResult<()> {
        let res: redis::RedisResult<()> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(&self.stream)
            .arg(&self.group)
            .arg("$") // fresh group: only new events, history is not replayed
            .arg("MKSTREAM")
            .query_async(con)
            .await;
        match res {
            Ok(()) => Ok(()),
            Err(e) if e.to_string().contains("BUSYGROUP") => Ok(()),
            Err(e) => Err(e),
        }
    }

    pub async fn run(
        self,
        client: redis::Client,
        db: Arc<Db>,
        metrics: Metrics,
        shutdown: watch::Receiver<bool>,
    ) {
        let consumer = Self::consumer_name();
        let opts = StreamReadOptions::default()
            .group(&self.group, &consumer)
            .block(5000) // bounded block = shutdown latency + reconnect interval
            .count(50);
        let mut con: Option<MultiplexedConnection> = None;
        println!(
            "analytics consumer {} on stream \"{}\" group \"{}\"",
            consumer, self.stream, self.group
        );

        loop {
            if *shutdown.borrow() {
                break;
            }
            if con.is_none() {
                match client.get_multiplexed_async_connection().await {
                    Ok(c) => con = Some(c),
                    Err(e) => {
                        eprintln!("redis connect failed: {e}");
                        metrics.stream_errors.inc();
                        sleep(Duration::from_secs(2)).await;
                        continue;
                    }
                }
            }
            let conn = con.as_mut().unwrap();
            if let Err(e) = self.ensure_group(conn).await {
                eprintln!("XGROUP CREATE failed: {e}");
                metrics.stream_errors.inc();
                con = None;
                sleep(Duration::from_secs(2)).await;
                continue;
            }

            match conn
                .xread_options::<&str, &str, redis::streams::StreamReadReply>(
                    &[&self.stream],
                    &[">"],
                    &opts,
                )
                .await
            {
                Ok(reply) => {
                    for entry in reply.keys.into_iter().flat_map(|k| k.ids) {
                        match parse_fields(&entry.map) {
                            Some((code, referrer, ts)) => {
                                match db.insert_click(entry.id.clone(), code, referrer, ts).await {
                                    Ok(_) => {
                                        metrics.clicks_ingested.inc();
                                        ack(conn, &self.stream, &self.group, &entry.id, &metrics)
                                            .await;
                                    }
                                    Err(e) => {
                                        // leave unacked: the entry is redelivered
                                        eprintln!("duckdb insert failed for {}: {e}", entry.id);
                                        metrics.stream_errors.inc();
                                    }
                                }
                            }
                            None => {
                                // malformed payloads are dropped, not retried forever
                                eprintln!("malformed click entry {}, skipping", entry.id);
                                metrics.entries_skipped.inc();
                                ack(conn, &self.stream, &self.group, &entry.id, &metrics).await;
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("XREADGROUP failed: {e}");
                    metrics.stream_errors.inc();
                    con = None;
                    sleep(Duration::from_secs(2)).await;
                }
            }
        }
        println!("analytics consumer stopped");
    }
}

fn parse_fields(map: &HashMap<String, Value>) -> Option<(String, String, i64)> {
    let as_string = |v: &Value| match v {
        Value::BulkString(bytes) => String::from_utf8(bytes.clone()).ok(),
        Value::SimpleString(s) => Some(s.clone()),
        _ => None,
    };
    let code = as_string(map.get("code")?)?;
    let referrer = as_string(map.get("referrer")?)?;
    let ts = as_string(map.get("ts")?)?.parse::<i64>().ok()?;
    Some((code, referrer, ts))
}

async fn ack(
    con: &mut MultiplexedConnection,
    stream: &str,
    group: &str,
    id: &str,
    metrics: &Metrics,
) {
    let res: redis::RedisResult<i32> = con.xack(stream, group, &[id]).await;
    if let Err(e) = res {
        eprintln!("XACK failed for {id}: {e}");
        metrics.stream_errors.inc();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(s: &str) -> Value {
        Value::BulkString(s.as_bytes().to_vec())
    }

    #[test]
    fn parses_a_well_formed_click() {
        let map = HashMap::from([
            ("code".to_string(), data("abc1234")),
            ("referrer".to_string(), data("https://grogu.test/")),
            ("ts".to_string(), data("1760000000000")),
        ]);
        let parsed = parse_fields(&map).unwrap();
        assert_eq!(parsed.0, "abc1234");
        assert_eq!(parsed.1, "https://grogu.test/");
        assert_eq!(parsed.2, 1_760_000_000_000);
    }

    #[test]
    fn rejects_malformed_entries() {
        let missing = HashMap::from([("code".to_string(), data("abc1234"))]);
        assert!(parse_fields(&missing).is_none());

        let bad_ts = HashMap::from([
            ("code".to_string(), data("abc1234")),
            ("referrer".to_string(), data("direct")),
            ("ts".to_string(), data("not-a-number")),
        ]);
        assert!(parse_fields(&bad_ts).is_none());
    }
}
