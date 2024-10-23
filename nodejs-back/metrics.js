const client = require("prom-client");

const register = new client.Registry();

const activeRequests = new client.Gauge({
  name: "active_requests",
  help: "Number of active requests",
  labelNames: ["method", "endpoint"],
});

const totalRequests = new client.Counter({
  name: "app_total_requests",
  help: "Total number of requests",
  labelNames: ["method", "endpoint", "status"],
});

register.registerMetric(activeRequests);
register.registerMetric(totalRequests);

client.collectDefaultMetrics({ register });

const metricsMiddleware = (req, res, next) => {
  activeRequests.inc({
    method: req.method,
    endpoint: req.path,
  });

  totalRequests.inc({
    method: req.method,
    endpoint: req.path,
  });

  res.on("finish", () => {
    activeRequests.dec({
      method: req.method,
      endpoint: req.path,
    });
  });

  next();
}

const metricsRoute = async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  metricsRoute,
  metricsMiddleware
}
