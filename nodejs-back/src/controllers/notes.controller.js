import { Router } from "express";
import { ownerFromRequest } from "../util.js";

const NOTE_CACHE_TTL_SECONDS = 60;
const noteCacheKey = (id) => `note:${id}`;

export class NotesController {
  path = "/notes";
  router = Router();
  pgClient;
  redisClient;

  constructor(pgClient, redisClient) {
    this.pgClient = pgClient;
    this.redisClient = redisClient;
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(`${this.path}`, this.list);
    this.router.post(`${this.path}`, this.create);
    this.router.get(`${this.path}/:id`, this.getOne);
    this.router.patch(`${this.path}/:id`, this.update);
    this.router.delete(`${this.path}/:id`, this.remove);
  }

  // GET /notes?limit=20&offset=0 → { items, total, limit, offset }
  list = async (req, res, next) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    try {
      const items = await this.pgClient.query(
        "SELECT id, title, body, owner, created_at, updated_at FROM notes ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      );
      const total = await this.pgClient.query("SELECT count(*)::int AS total FROM notes");
      res.send({ items: items.rows, total: total.rows[0].total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  create = async (req, res, next) => {
    const { title, body = "" } = req.body ?? {};
    if (typeof title !== "string" || title.trim() === "") {
      return res.status(400).send({ message: "title is required" });
    }

    try {
      const inserted = await this.pgClient.query(
        "INSERT INTO notes(title, body, owner) VALUES($1, $2, $3) RETURNING id, title, body, owner, created_at, updated_at",
        [title.trim(), String(body), ownerFromRequest(req)],
      );
      res.status(201).send(inserted.rows[0]);
    } catch (error) {
      next(error);
    }
  }

  // read-through cache: first hit fills note:<id> (TTL 60s), writes invalidate
  getOne = async (req, res, next) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).send({ message: "invalid id" });
    }

    try {
      const cached = await this.redisClient.get(noteCacheKey(id));
      if (cached) {
        res.set("X-Cache", "hit");
        return res.send(JSON.parse(cached));
      }

      const found = await this.pgClient.query(
        "SELECT id, title, body, owner, created_at, updated_at FROM notes WHERE id = $1",
        [id],
      );
      if (found.rowCount === 0) {
        return res.status(404).send({ message: "note not found" });
      }

      await this.redisClient.set(noteCacheKey(id), JSON.stringify(found.rows[0]), {
        EX: NOTE_CACHE_TTL_SECONDS,
      });
      res.set("X-Cache", "miss");
      res.send(found.rows[0]);
    } catch (error) {
      next(error);
    }
  }

  update = async (req, res, next) => {
    const id = Number.parseInt(req.params.id, 10);
    const { title, body } = req.body ?? {};
    if (!Number.isInteger(id) || (title === undefined && body === undefined)) {
      return res.status(400).send({ message: "provide title and/or body" });
    }

    try {
      const updated = await this.pgClient.query(
        `UPDATE notes SET
           title = COALESCE($1, title),
           body = COALESCE($2, body),
           updated_at = now()
         WHERE id = $3
         RETURNING id, title, body, owner, created_at, updated_at`,
        [title, body, id],
      );
      if (updated.rowCount === 0) {
        return res.status(404).send({ message: "note not found" });
      }

      await this.redisClient.del(noteCacheKey(id));
      res.send(updated.rows[0]);
    } catch (error) {
      next(error);
    }
  }

  remove = async (req, res, next) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).send({ message: "invalid id" });
    }

    try {
      const deleted = await this.pgClient.query("DELETE FROM notes WHERE id = $1", [id]);
      if (deleted.rowCount === 0) {
        return res.status(404).send({ message: "note not found" });
      }

      await this.redisClient.del(noteCacheKey(id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
