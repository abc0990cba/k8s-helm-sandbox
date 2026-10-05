// The worker: same image as the API, different entrypoint. It consumes the
// `jobs` Redis Stream in a consumer group, does the work, writes the result
// back into the jobs table and acknowledges the message. Run standalone:
//   node src/worker.js
import pg from "pg";
import { createClient } from "redis";
import { config } from "./config.js";
import { JOB_STREAM, JOB_TYPES } from "./controllers/jobs.controller.js";

const CONSUMER_GROUP = "workers";

const pgPool = new pg.Pool({
  user: config.pgUser,
  host: config.pgHost,
  database: config.pgDatabase,
  password: config.pgPassword,
  port: config.pgPort,
});

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

async function handleWordcount({ noteId }) {
  const note = await pgPool.query("SELECT id, title, body FROM notes WHERE id = $1", [noteId]);
  if (note.rowCount === 0) {
    throw new Error(`note ${noteId} not found`);
  }
  const words = `${note.rows[0].title} ${note.rows[0].body}`.trim().split(/\s+/).filter(Boolean).length;
  return { noteId: note.rows[0].id, words };
}

function handleFibonacci({ n }) {
  let a = 0n;
  let b = 1n;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  const result = n <= 1 ? BigInt(n) : b;
  return { n, result: result.toString() };
}

const handlers = {
  wordcount: handleWordcount,
  fibonacci: handleFibonacci,
};

async function processEntry(entry) {
  const id = entry.message.id;
  const type = entry.message.type;

  if (!JOB_TYPES.includes(type)) {
    await pgPool.query("UPDATE jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [
      id,
      `unknown job type: ${type}`,
    ]);
    return;
  }

  const job = await pgPool.query("SELECT payload FROM jobs WHERE id = $1", [id]);
  if (job.rowCount === 0) {
    console.error(`stream entry references missing job row: ${id}`);
    return;
  }

  await pgPool.query("UPDATE jobs SET status = 'processing', updated_at = now() WHERE id = $1", [id]);

  // node-pg already parses jsonb into an object; tolerate strings too
  const rawPayload = job.rows[0].payload;
  const payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

  try {
    const result = await handlers[type](payload);
    await pgPool.query("UPDATE jobs SET status = 'done', result = $2, updated_at = now() WHERE id = $1", [
      id,
      JSON.stringify(result),
    ]);
    console.log(`job ${id} (${type}) done:`, result);
  } catch (error) {
    await pgPool.query("UPDATE jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [
      id,
      String(error.message || error),
    ]);
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
await pgPool.end();
