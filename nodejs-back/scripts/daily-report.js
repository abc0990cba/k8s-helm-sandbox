// Daily report — run by the postgres-report CronJob in the cluster:
//   /usr/bin/node scripts/daily-report.js
// Aggregates notes per owner per day into daily_reports (idempotent upsert).
import pg from "pg";
import { config } from "../src/config.js";

const pgPool = new pg.Pool({
  user: config.pgUser,
  host: config.pgHost,
  database: config.pgDatabase,
  password: config.pgPassword,
  port: config.pgPort,
});

const upserted = await pgPool.query(`
  INSERT INTO daily_reports(day, owner, notes_count)
  SELECT date_trunc('day', created_at)::date AS day, owner, count(*)::int AS notes_count
  FROM notes
  GROUP BY day, owner
  ON CONFLICT (day, owner) DO UPDATE SET notes_count = EXCLUDED.notes_count
`);

console.log(`daily report written: ${upserted.rowCount} rows`);
await pgPool.end();
