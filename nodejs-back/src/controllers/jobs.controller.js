import { Router } from "express";
import { randomUUID } from "node:crypto";
import { ownerFromRequest } from "../util.js";

export const JOB_TYPES = ["wordcount", "fibonacci"];
export const JOB_STREAM = "jobs";

export class JobsController {
  path = "/jobs";
  router = Router();
  db;
  redisClient;

  constructor(db, redisClient) {
    this.db = db;
    this.redisClient = redisClient;
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.post(`${this.path}`, this.enqueue);
    this.router.get(`${this.path}/:id`, this.status);
  }

  // POST /jobs {type, payload} → 202; the row is created immediately (status
  // queued) and the work is handed to the worker through a Redis Stream
  enqueue = async (req, res, next) => {
    const { type, payload = {} } = req.body ?? {};
    if (!JOB_TYPES.includes(type)) {
      return res.status(400).send({ message: `type must be one of: ${JOB_TYPES.join(", ")}` });
    }
    // wordcount carries its own text now: notes live in the golang/postgres
    // domain and this backend does not reach into other services' databases
    if (type === "wordcount" && (typeof payload?.text !== "string" || payload.text.trim() === "")) {
      return res.status(400).send({ message: "wordcount jobs need payload.text" });
    }
    if (type === "fibonacci" && !Number.isInteger(Number.parseInt(payload?.n, 10))) {
      return res.status(400).send({ message: "fibonacci jobs need payload.n" });
    }

    const id = randomUUID();
    try {
      await this.db.execute({
        sql: "INSERT INTO jobs(id, type, payload, created_by) VALUES (?, ?, ?, ?)",
        args: [id, type, JSON.stringify(payload), ownerFromRequest(req)],
      });
      await this.redisClient.xAdd(JOB_STREAM, "*", { id, type });
      res.status(202).send({ id, type, status: "queued" });
    } catch (error) {
      next(error);
    }
  }

  status = async (req, res, next) => {
    try {
      const job = await this.db.execute({
        sql: "SELECT id, type, status, payload, result, error, created_by, created_at, updated_at FROM jobs WHERE id = ?",
        args: [req.params.id],
      });
      if (job.rows.length === 0) {
        return res.status(404).send({ message: "job not found" });
      }
      const row = job.rows[0];
      // payload/result are stored as TEXT; the old pg/jsonb contract returned
      // them as objects — keep that shape for the frontend
      res.send({
        ...row,
        payload: parseMaybeJson(row.payload),
        result: parseMaybeJson(row.result),
      });
    } catch (error) {
      next(error);
    }
  }
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
