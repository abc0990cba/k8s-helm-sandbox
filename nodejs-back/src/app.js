import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import pg from "pg";
import { createClient } from "redis";
import { metricsMiddleware } from "./metrics.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { AppController } from "./controllers/app.controller.js";
import { NumbersController } from "./controllers/numbers.controller.js";
import { FibonacciController } from "./controllers/fibonacci.controller.js";

export class App {
  pgClient;
  redisClient;
  config;

  constructor(config) {
    this.config = config;
    this.app = express();

    (async () => {
      await this.connectToDB();
      await this.connectToRedis();
      this.initMiddlewares();

      const controllers = [
        new AppController(),
        new FibonacciController(this.redisClient),
        new NumbersController(this.pgClient, this.redisClient)
      ];
      this.initControllers(controllers);
      this.initErrorHandling();
    })()
  }

  listen() {
    this.app.listen(this.config.port, () => {
      console.log(`App listening on the port ${this.config.port}`);
    });
  }

  initMiddlewares() {
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(metricsMiddleware);
  }

  initErrorHandling() {
    this.app.use(errorMiddleware);
  }

  initControllers(controllers) {
    controllers.forEach((controller) => {
      this.app.use("/", controller.router);
    });
  }

  async connectToRedis() {
    this.redisClient = await createClient({
      url: `redis://${this.config.redisHost}:${this.config.redisPort}`
    })
    .on("error", err => console.log("Redis Client Error", err))
    .connect();
  }

  async connectToDB() {
    this.pgClient = await new pg.Pool({
      user: this.config.pgUser,
      host: this.config.pgHost,
      database: this.config.pgDatabase,
      password: this.config.pgPassword,
      port: this.config.pgPort
    }).connect();
  }
}