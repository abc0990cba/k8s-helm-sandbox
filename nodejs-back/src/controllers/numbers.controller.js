import { Router } from "express";

export class NumbersController {
  path = "/numbers";
  router = Router();
  pgClient;
  redisClient;

  constructor(pgClient, redisClient) {
    this.pgClient = pgClient;
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
      const numbers = await this.pgClient.query("SELECT id, number FROM nodejs_numbers ORDER BY id");
      res.send(numbers.rows);
    } catch (error) {
      next(error);
    }
  }

  create = async (req, res, next) => {
    const num = Number.parseInt(req.body?.number, 10);
    if (!Number.isInteger(num)) {
      return res.status(400).send({ message: "body must be {\"number\": <int>}" });
    }

    try {
      // keep the redis key in play (the smoke suite reads it) but bound its life
      await this.redisClient.set("number", num.toString(), { EX: 60 });
      const inserted = await this.pgClient.query(
        "INSERT INTO nodejs_numbers(number) VALUES($1) RETURNING id, number",
        [num],
      );
      res.status(201).send(inserted.rows[0]);
    } catch (error) {
      next(error);
    }
  }
}
