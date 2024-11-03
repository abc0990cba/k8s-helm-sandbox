import { Router } from "express";
import { metricsRoute } from "../metrics.js";

export class AppController {
  path = "/";
  router = Router();
  
  constructor() {
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(`${this.path}ready`, this.ready);
    this.router.get(`${this.path}healthz`, this.healthy);
    this.router.get(`${this.path}metrics`, metricsRoute);
  }

  ready = async (req, res, next) => {
    console.log("ready"); 
    res.send("ready");
  }

  healthy = async (req, res, next) => {
    console.log("healthy");
    res.send("healthy");
  }

  config = async (req, res, next) => {
    res.send(config);
  }

  metrics = async (req, res, next) => {
    res.send(config);
  }
// app.get("/", async (req, res) => {
//   const num = await redisClient.get("key");
//   res.send(num);
// });
}
