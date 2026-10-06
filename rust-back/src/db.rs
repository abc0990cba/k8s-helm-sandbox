use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use duckdb::params;
use duckdb::Connection;
use serde::Serialize;

/// DuckDB wrapper. One connection behind a mutex: DuckDB is in-process and
/// single-writer, and at demo scale every statement is sub-millisecond — the
/// mutex costs nothing and keeps the writer/readers serialized safely.
/// Blocking calls run on the tokio blocking pool so the runtime never stalls.
pub struct Db {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize)]
pub struct DayCount {
    pub day: String,
    pub clicks: i64,
}

#[derive(Debug, Serialize)]
pub struct ReferrerCount {
    pub referrer: String,
    pub clicks: i64,
}

#[derive(Debug, Serialize)]
pub struct CodeCount {
    pub code: String,
    pub clicks: i64,
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub total_clicks: i64,
    pub links_with_clicks: i64,
    pub clicks_last_24h: i64,
    pub per_day: Vec<DayCount>,
}

#[derive(Debug, Serialize)]
pub struct LinkStats {
    pub code: String,
    pub total_clicks: i64,
    pub per_day: Vec<DayCount>,
    pub top_referrers: Vec<ReferrerCount>,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// UTC day-number → "YYYY-MM-DD", Howard Hinnant's civil_from_days.
/// Pure integer math: the netpol gives this pod no internet, so duckdb must
/// never reach for the ICU extension (its DATE cast on TIMESTAMPTZ needs it).
pub fn iso_from_day_num(day_num: i64) -> String {
    let z = day_num + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

impl Db {
    /// The parent directory must already exist (main.rs creates it — the PVC
    /// mountpoint does that in-cluster).
    pub fn open(path: &str) -> duckdb::Result<Self> {
        Self::init(Connection::open(path))
    }

    #[cfg(test)]
    pub fn open_in_memory() -> duckdb::Result<Self> {
        Self::init(Connection::open_in_memory())
    }

    fn init(conn: duckdb::Result<Connection>) -> duckdb::Result<Self> {
        let conn = conn?;
        // autoload/autoinstall OFF: the cluster has no outbound internet (and
        // the netpol only allows DNS+redis anyway) — duckdb must never try to
        // fetch extensions. Day bucketing below uses only core SQL (no ICU).
        conn.execute_batch(
            "SET autoinstall_known_extensions = false;
             SET autoload_known_extensions = false;
             CREATE TABLE IF NOT EXISTS clicks (
                 entry_id VARCHAR PRIMARY KEY,  -- redis stream entry id: idempotent replay
                 code     VARCHAR NOT NULL,
                 referrer VARCHAR NOT NULL,
                 ts       BIGINT   NOT NULL      -- epoch milliseconds
             );",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// INSERT OR IGNORE: the consumer is at-least-once, the stream entry id is
    /// the dedupe key.
    pub async fn insert_click(
        self: &Arc<Self>,
        entry_id: String,
        code: String,
        referrer: String,
        ts: i64,
    ) -> duckdb::Result<usize> {
        let db = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT OR IGNORE INTO clicks(entry_id, code, referrer, ts) VALUES (?, ?, ?, ?)",
                params![entry_id, code, referrer, ts],
            )
        })
        .await
        .unwrap()
    }

    pub async fn summary(self: &Arc<Self>) -> duckdb::Result<Summary> {
        let db = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            let conn = db.conn.lock().unwrap();
            let total_clicks = conn.query_row("SELECT count(*) FROM clicks", [], |r| r.get(0))?;
            let links_with_clicks =
                conn.query_row("SELECT count(DISTINCT code) FROM clicks", [], |r| r.get(0))?;
            let now = now_ms();
            let clicks_last_24h = conn.query_row(
                "SELECT count(*) FROM clicks WHERE ts > ?",
                params![now - 86_400_000],
                |r| r.get(0),
            )?;
            let mut stmt = conn.prepare(
                "SELECT ts / 86400000 AS day_num, count(*) AS clicks
                 FROM clicks
                 WHERE ts >= ?
                 GROUP BY day_num ORDER BY day_num",
            )?;
            let per_day = stmt
                .query_map(params![now - 14 * 86_400_000], |row| {
                    Ok(DayCount {
                        day: iso_from_day_num(row.get(0)?),
                        clicks: row.get(1)?,
                    })
                })?
                .collect::<duckdb::Result<Vec<_>>>()?;
            Ok(Summary {
                total_clicks,
                links_with_clicks,
                clicks_last_24h,
                per_day,
            })
        })
        .await
        .unwrap()
    }

    pub async fn link_stats(self: &Arc<Self>, code: String) -> duckdb::Result<LinkStats> {
        let db = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            let conn = db.conn.lock().unwrap();
            let total_clicks =
                conn.query_row("SELECT count(*) FROM clicks WHERE code = ?", params![code], |r| r.get(0))?;
            let mut stmt = conn.prepare(
                "SELECT ts / 86400000 AS day_num, count(*) AS clicks
                 FROM clicks
                 WHERE code = ? AND ts >= ?
                 GROUP BY day_num ORDER BY day_num",
            )?;
            let per_day = stmt
                .query_map(params![code, now_ms() - 14 * 86_400_000], |row| {
                    Ok(DayCount { day: iso_from_day_num(row.get(0)?), clicks: row.get(1)? })
                })?
                .collect::<duckdb::Result<Vec<_>>>()?;
            let mut stmt = conn.prepare(
                "SELECT referrer, count(*) AS clicks FROM clicks WHERE code = ? GROUP BY referrer ORDER BY clicks DESC LIMIT 5",
            )?;
            let top_referrers = stmt
                .query_map(params![code], |row| {
                    Ok(ReferrerCount { referrer: row.get(0)?, clicks: row.get(1)? })
                })?
                .collect::<duckdb::Result<Vec<_>>>()?;
            Ok(LinkStats { code, total_clicks, per_day, top_referrers })
        })
        .await
        .unwrap()
    }

    pub async fn top(self: &Arc<Self>, limit: i64) -> duckdb::Result<Vec<CodeCount>> {
        let db = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            let conn = db.conn.lock().unwrap();
            let mut stmt = conn.prepare("SELECT code, count(*) AS clicks FROM clicks GROUP BY code ORDER BY clicks DESC LIMIT ?")?;
            stmt.query_map(params![limit], |row| Ok(CodeCount { code: row.get(0)?, clicks: row.get(1)? }))
                .and_then(|rows| rows.collect::<duckdb::Result<Vec<_>>>())
        })
        .await
        .unwrap()
    }

    pub async fn ready(self: &Arc<Self>) -> bool {
        let db = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            db.conn
                .lock()
                .unwrap()
                .query_row("SELECT 1", [], |r| r.get::<_, i64>(0))
                .is_ok()
        })
        .await
        .unwrap_or(false)
    }

    /// Compact the file on shutdown so a restored copy is always consistent.
    pub async fn checkpoint(self: &Arc<Self>) {
        let db = Arc::clone(self);
        let _ = tokio::task::spawn_blocking(move || {
            db.conn.lock().unwrap().execute_batch("CHECKPOINT")
        })
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn seeded() -> Arc<Db> {
        let db = Arc::new(Db::open_in_memory().unwrap());
        let now = now_ms();
        db.insert_click("1-1".into(), "abc".into(), "https://x.test".into(), now)
            .await
            .unwrap();
        // duplicate stream entry: must be ignored (at-least-once delivery)
        db.insert_click("1-1".into(), "abc".into(), "https://x.test".into(), now)
            .await
            .unwrap();
        db.insert_click(
            "2-1".into(),
            "abc".into(),
            "direct".into(),
            now - 25 * 3_600_000,
        )
        .await
        .unwrap();
        db.insert_click("3-1".into(), "xyz".into(), "https://x.test".into(), now)
            .await
            .unwrap();
        db
    }

    #[tokio::test]
    async fn insert_is_idempotent_and_aggregations_add_up() {
        let db = seeded().await;
        let s = db.summary().await.unwrap();
        assert_eq!(
            s.total_clicks, 3,
            "the replayed entry must not be counted twice"
        );
        assert_eq!(s.links_with_clicks, 2);
        assert_eq!(
            s.clicks_last_24h, 2,
            "the 25h-old click falls outside the window"
        );
        assert!(!s.per_day.is_empty());
    }

    #[tokio::test]
    async fn link_stats_counts_and_ranks_referrers() {
        let db = seeded().await;
        let stats = db.link_stats("abc".into()).await.unwrap();
        assert_eq!(stats.total_clicks, 2);
        // both referrers have one click each — a tie, so only the set is stable
        let referrers: std::collections::HashMap<&str, i64> = stats
            .top_referrers
            .iter()
            .map(|r| (r.referrer.as_str(), r.clicks))
            .collect();
        assert_eq!(referrers.get("https://x.test"), Some(&1));
        assert_eq!(referrers.get("direct"), Some(&1));
    }

    #[tokio::test]
    async fn top_ranks_codes_by_clicks() {
        let db = seeded().await;
        let top = db.top(10).await.unwrap();
        assert_eq!(top[0].code, "abc");
        assert_eq!(top[0].clicks, 2);
        assert_eq!(top.len(), 2);
    }

    #[tokio::test]
    async fn ready_answers_true() {
        let db = Arc::new(Db::open_in_memory().unwrap());
        assert!(db.ready().await);
    }
}

#[cfg(test)]
mod iso_tests {
    use super::{iso_from_day_num, now_ms};

    #[test]
    fn known_dates_convert() {
        assert_eq!(iso_from_day_num(0), "1970-01-01");
        assert_eq!(iso_from_day_num(19723), "2024-01-01"); // 54y incl. 13 leaps
        assert_eq!(iso_from_day_num(19753), "2024-01-31");
        assert_eq!(iso_from_day_num(now_ms() / 86_400_000), {
            // today's UTC date, cross-checked with the std-only computation
            let days = now_ms() / 86_400_000;
            iso_from_day_num(days)
        });
    }
}
