import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { createClient } from "@libsql/client";
import { createClient as createRedisClient } from "redis";
import { metricsMiddleware } from "./metrics.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { AppController } from "./controllers/app.controller.js";
import { NumbersController } from "./controllers/numbers.controller.js";
import { FibonacciController } from "./controllers/fibonacci.controller.js";
import { LinksController } from "./controllers/links.controller.js";
import { JobsController } from "./controllers/jobs.controller.js";

export class App {
  db;
  redisClient;
  config;

  constructor(config) {
    this.config = config;
    this.app = express();

    (async () => {
      this.connectToDB();
      await this.connectToRedis();
      this.initMiddlewares();

      const controllers = [
        new AppController(this.db, this.redisClient),
        new FibonacciController(this.redisClient),
        new NumbersController(this.db, this.redisClient),
        new LinksController(this.db, this.redisClient),
        new JobsController(this.db, this.redisClient)
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
    this.redisClient = await createRedisClient({
      url: `redis://${this.config.redisHost}:${this.config.redisPort}`
    })
    .on("error", err => console.log("Redis Client Error", err))
    .connect();
  }

  connectToDB() {
    this.db = createClient({ url: this.config.libsqlUrl });
  }
}
