import { Router } from "express";
import { randomBytes } from "node:crypto";
import { ownerFromRequest } from "../util.js";

const LINK_CACHE_TTL_SECONDS = 60;
const linkCacheKey = (code) => `link:${code}`;
export const CLICK_STREAM = "clicks";

const CODE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_LENGTH = 7;

export class LinksController {
  path = "/links";
  router = Router();
  db;
  redisClient;

  constructor(db, redisClient) {
    this.db = db;
    this.redisClient = redisClient;
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(`${this.path}`, this.list);
    this.router.post(`${this.path}`, this.create);
    this.router.get(`${this.path}/:code`, this.resolve);
    this.router.delete(`${this.path}/:code`, this.remove);
  }

  generateCode() {
    const bytes = randomBytes(CODE_LENGTH);
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return code;
  }

  // POST /links {url, title?} → 201 {code, url, title, created_by, created_at}
  create = async (req, res, next) => {
    const { url, title = "" } = req.body ?? {};
    if (typeof url !== "string") {
      return res.status(400).send({ message: 'body must be {"url": <valid url>, "title"?: string}' });
    }
    try {
      new URL(url);
    } catch {
      return res.status(400).send({ message: "url must be a valid absolute URL" });
    }

    // codes are random, not sequential — a PRIMARY KEY collision is possible,
    // so regenerate instead of failing the request
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.generateCode();
      try {
        await this.db.execute({
          sql: "INSERT INTO links(code, url, title, created_by) VALUES (?, ?, ?, ?)",
          args: [code, url, String(title).trim(), ownerFromRequest(req)],
        });
        const created = await this.db.execute({
          sql: "SELECT code, url, title, created_by, created_at FROM links WHERE code = ?",
          args: [code],
        });
        return res.status(201).send(created.rows[0]);
      } catch (error) {
        if (String(error.code) === "SQLITE_CONSTRAINT" && attempt < 4) continue;
        return next(error);
      }
    }
  }

  // GET /links?limit=20&offset=0&q=terms → { items, total, limit, offset }
  // q uses the FTS5 index (prefix search: each word becomes word*)
  list = async (req, res, next) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const q = (req.query.q ?? "").toString().trim();

    try {
      const match = q
        ? q.split(/\s+/).map((word) => `${word.replace(/[*"]/g, "")}*`).filter((w) => w !== "*").join(" ")
        : null;

      const rows = match
        ? (await this.db.execute({
            sql: `SELECT l.code, l.url, l.title, l.created_by, l.created_at
                  FROM links_fts f JOIN links l ON l.code = f.code
                  WHERE links_fts MATCH ?
                  ORDER BY l.created_at DESC, l.code DESC LIMIT ? OFFSET ?`,
            args: [match, limit, offset],
          })).rows
        : (await this.db.execute({
            sql: "SELECT code, url, title, created_by, created_at FROM links ORDER BY created_at DESC, code DESC LIMIT ? OFFSET ?",
            args: [limit, offset],
          })).rows;

      const total = match
        ? (await this.db.execute({
            sql: "SELECT count(*) AS total FROM links_fts WHERE links_fts MATCH ?",
            args: [match],
          })).rows[0].total
        : (await this.db.execute({ sql: "SELECT count(*) AS total FROM links" })).rows[0].total;

      res.send({ items: rows, total, limit, offset });
    } catch (error) {
      next(error);
    }
  }

  // GET /links/:code → the target URL. Public by design (this IS the click).
  // Read-through cache like notes had, plus a click event on the Redis
  // `clicks` stream for the Rust analytics service — recorded on cache hits
  // too, and best-effort: analytics must never fail a resolution.
  resolve = async (req, res, next) => {
    const code = req.params.code;
    if (!/^[0-9a-zA-Z]{1,32}$/.test(code)) {
      return res.status(400).send({ message: "invalid code" });
    }

    try {
      const cached = await this.redisClient.get(linkCacheKey(code));
      if (cached) {
        res.set("X-Cache", "hit");
        this.recordClick(req, code);
        return res.send(JSON.parse(cached));
      }

      const found = await this.db.execute({
        sql: "SELECT code, url, title, created_by, created_at FROM links WHERE code = ?",
        args: [code],
      });
      if (found.rows.length === 0) {
        return res.status(404).send({ message: "link not found" });
      }

      await this.redisClient.set(linkCacheKey(code), JSON.stringify(found.rows[0]), {
        EX: LINK_CACHE_TTL_SECONDS,
      });
      res.set("X-Cache", "miss");
      this.recordClick(req, code);
      res.send(found.rows[0]);
    } catch (error) {
      next(error);
    }
  }

  recordClick(req, code) {
    this.redisClient
      .xAdd(CLICK_STREAM, "*", {
        code,
        referrer: req.get("referer") || "direct",
        ts: Date.now().toString(),
      })
      .catch((err) => console.error("click event dropped:", err.message || err));
  }

  remove = async (req, res, next) => {
    const code = req.params.code;
    if (!/^[0-9a-zA-Z]{1,32}$/.test(code)) {
      return res.status(400).send({ message: "invalid code" });
    }

    try {
      const deleted = await this.db.execute({
        sql: "DELETE FROM links WHERE code = ?",
        args: [code],
      });
      if (deleted.rowsAffected === 0) {
        return res.status(404).send({ message: "link not found" });
      }

      await this.redisClient.del(linkCacheKey(code));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
