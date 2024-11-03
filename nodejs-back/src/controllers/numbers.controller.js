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
    this.router.get(`${this.path}`, this.list);
  }

  list = async (req, res, next) => {
    const num = Math.floor(Math.random() * 10_000);

    try {  
      await this.redisClient.set("number", num);
      await this.pgClient.query("INSERT INTO nodejs_numbers(number) VALUES($1)", [num]);
    
      const numCache = await this.redisClient.get("number");
      const numbers = await this.pgClient.query("SELECT * FROM nodejs_numbers");

      res.send([numCache, numbers.rows]);
    } catch (error) {
      res.send(error);   
    }
  }
}
