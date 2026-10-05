import { Router } from "express";
import { randomUUID } from "node:crypto";
import { ownerFromRequest } from "../util.js";

export const JOB_TYPES = ["wordcount", "fibonacci"];
export const JOB_STREAM = "jobs";

export class JobsController {
  path = "/jobs";
  router = Router();
  pgClient;
  redisClient;

  constructor(pgClient, redisClient) {
    this.pgClient = pgClient;
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
    if (type === "wordcount" && !Number.isInteger(Number.parseInt(payload?.noteId, 10))) {
      return res.status(400).send({ message: "wordcount jobs need payload.noteId" });
    }
    if (type === "fibonacci" && !Number.isInteger(Number.parseInt(payload?.n, 10))) {
      return res.status(400).send({ message: "fibonacci jobs need payload.n" });
    }

    const id = randomUUID();
    try {
      await this.pgClient.query(
        "INSERT INTO jobs(id, type, payload, created_by) VALUES($1, $2, $3, $4)",
        [id, type, JSON.stringify(payload), ownerFromRequest(req)],
      );
      await this.redisClient.xAdd(JOB_STREAM, "*", { id, type });
      res.status(202).send({ id, type, status: "queued" });
    } catch (error) {
      next(error);
    }
  }

  status = async (req, res, next) => {
    try {
      const job = await this.pgClient.query(
        "SELECT id, type, status, payload, result, error, created_by, created_at, updated_at FROM jobs WHERE id = $1",
        [req.params.id],
      );
      if (job.rowCount === 0) {
        return res.status(404).send({ message: "job not found" });
      }
      res.send(job.rows[0]);
    } catch (error) {
      next(error);
    }
  }
}
