// The worker: same image as the API, different entrypoint. It consumes the
// `jobs` Redis Stream in a consumer group, does the work, writes the result
// back into the jobs table and acknowledges the message. Run standalone:
//   node src/worker.js
import { createClient as createLibsqlClient } from "@libsql/client";
import { createClient } from "redis";
import { config } from "./config.js";
import { JOB_STREAM, JOB_TYPES } from "./controllers/jobs.controller.js";
import { handlers } from "./job-handlers.js";

const CONSUMER_GROUP = "workers";

const db = createLibsqlClient({ url: config.libsqlUrl });

const redis = await createClient({
  url: `redis://${config.redisHost}:${config.redisPort}`,
})
  .on("error", (err) => console.error("Redis Client Error", err))
  .connect();

// MKSTREAM: create the stream if missing; $: only new entries (a fresh group
// never replays history) — raw command because node-redis 4.7 drops the MK
// option object from xGroupCreate
await redis.sendCommand(["XGROUP", "CREATE", JOB_STREAM, CONSUMER_GROUP, "$", "MKSTREAM"])
  .catch((err) => {
    if (!String(err).includes("BUSYGROUP")) throw err;
  });

const consumer = `worker-${process.env.HOSTNAME || "local"}`;

async function processEntry(entry) {
  const id = entry.message.id;
  const type = entry.message.type;

  if (!JOB_TYPES.includes(type)) {
    await db.execute({
      sql: "UPDATE jobs SET status = 'failed', error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      args: [`unknown job type: ${type}`, id],
    });
    return;
  }

  const job = await db.execute({
    sql: "SELECT payload FROM jobs WHERE id = ?",
    args: [id],
  });
  if (job.rows.length === 0) {
    console.error(`stream entry references missing job row: ${id}`);
    return;
  }

  await db.execute({
    sql: "UPDATE jobs SET status = 'processing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    args: [id],
  });

  // payload is stored as TEXT — tolerate objects too
  const rawPayload = job.rows[0].payload;
  const payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

  try {
    const result = await handlers[type](payload);
    await db.execute({
      sql: "UPDATE jobs SET status = 'done', result = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      args: [JSON.stringify(result), id],
    });
    console.log(`job ${id} (${type}) done:`, result);
  } catch (error) {
    await db.execute({
      sql: "UPDATE jobs SET status = 'failed', error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      args: [String(error.message || error), id],
    });
    console.error(`job ${id} (${type}) failed:`, error);
  }
}

console.log(`worker ${consumer} consuming stream "${JOB_STREAM}" group "${CONSUMER_GROUP}"`);

let running = true;
process.on("SIGTERM", () => {
  running = false;
});

// XREADGROUP with BLOCK returns every ~5s even without traffic, which doubles
// as the SIGTERM poll interval
while (running) {
  try {
    const response = await redis.xReadGroup(CONSUMER_GROUP, consumer, { key: JOB_STREAM, id: ">" }, {
      BLOCK: 5000,
      COUNT: 10,
    });
    for (const stream of response ?? []) {
      for (const entry of stream.messages) {
        await processEntry(entry);
        await redis.xAck(JOB_STREAM, CONSUMER_GROUP, entry.id);
      }
    }
  } catch (error) {
    console.error("worker loop error:", error);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

console.log("worker shutting down");
await redis.quit();
db.close();
