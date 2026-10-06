// Applies every .sql file in a directory (sorted by name) to the libSQL
// database. Idempotent by convention — same contract as the postgres
// migration Job, so it is safe to re-run on every redeploy.
// Run in-cluster by the libsql-migration Job with the ConfigMap dir:
//   node scripts/migrate.js /mnt/sql
// Locally (against a dev sqld), pass no argument to use ./migrations:
//   LIBSQL_URL=http://localhost:8080 node scripts/migrate.js [dir]
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { config } from "../src/config.js";

const defaultDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const migrationsDir = resolve(process.argv[2] || defaultDir);
const db = createClient({ url: config.libsqlUrl });

const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  await db.executeMultiple(sql);
  console.log(`applied ${file}`);
}

db.close();
console.log(`libSQL migrations applied: ${files.length} file(s)`);
