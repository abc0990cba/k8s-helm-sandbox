import { Router } from "express";
import { metricsRoute } from "../metrics.js";

export class AppController {
  path = "/";
  router = Router();
  db;
  redisClient;

  constructor(db, redisClient) {
    this.db = db;
    this.redisClient = redisClient;
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(`${this.path}ready`, this.ready);
    this.router.get(`${this.path}healthz`, this.healthy);
    this.router.get(`${this.path}metrics`, metricsRoute);
  }

  // readiness means "dependencies reachable": libSQL and Redis. The chart's
  // probes (and the gateway readiness, which dials us) rely on this.
  ready = async (req, res) => {
    try {
      await Promise.all([
        this.db.execute("SELECT 1"),
        this.redisClient.ping(),
      ]);
      res.send("ready");
    } catch (error) {
      res.status(503).send({ message: "dependencies not ready", error: String(error.message || error) });
    }
  }

  healthy = (req, res) => {
    res.send("healthy");
  }
}
