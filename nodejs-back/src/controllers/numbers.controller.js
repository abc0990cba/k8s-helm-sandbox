import { Router } from "express";

export class NumbersController {
  path = "/numbers";
  router = Router();
  db;
  redisClient;

  constructor(db, redisClient) {
    this.db = db;
    this.redisClient = redisClient;
    this.initializeRoutes();
  }

  initializeRoutes() {
    // list only — creating rows on GET was the old (buggy) contract
    this.router.get(`${this.path}`, this.list);
    this.router.post(`${this.path}`, this.create);
  }

  list = async (req, res, next) => {
    try {
      const numbers = await this.db.execute("SELECT id, number FROM numbers ORDER BY id");
      res.send(numbers.rows);
    } catch (error) {
      next(error);
    }
  }

  create = async (req, res, next) => {
    // Number (not parseInt): "1.5" must not truncate into a valid integer
    const num = Number(req.body?.number);
    if (!Number.isInteger(num)) {
      return res.status(400).send({ message: 'body must be {"number": <int>}' });
    }

    try {
      // keep the redis key in play (the smoke suite reads it) but bound its life
      await this.redisClient.set("number", num.toString(), { EX: 60 });
      const inserted = await this.db.execute({
        sql: "INSERT INTO numbers(number) VALUES (?)",
        args: [num],
      });
      res.status(201).send({ id: Number(inserted.lastInsertRowid), number: num });
    } catch (error) {
      next(error);
    }
  }
}
