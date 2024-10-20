const keys = require("./keys");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Pool } = require("pg");
const { createClient } = require('redis');
const promClient = require('prom-client');

const app = express();

const promRegistry = new promClient.Registry();

promRegistry.setDefaultLabels({
  app: 'example-nodejs-app'
})

promClient.collectDefaultMetrics({ register: promRegistry })

// Create a simple counter metric
const httpRequestDurationMicroseconds = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route'],
    registers: [promRegistry],
});

promRegistry.registerMetric(httpRequestDurationMicroseconds)

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promRegistry.contentType);
    res.end(await promRegistry.metrics());
});

app.use(cors());
app.use(bodyParser.json());

const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort
});

pgClient.on("connect", client => {
  client
    .query("CREATE TABLE IF NOT EXISTS values (number INT)")
    .catch((err) =>  console.log("PG ERROR", err)
  );
});

let redisClient;
(async function() {
  redisClient = await createClient({
     url: `redis://${keys.redisHost}:${keys.redisPort}`
    }).on('error', err => console.log('Redis Client Error', err))
  .connect();
})()

app.get("/", async (req, res) => {
  const num = await redisClient.get('key');
  res.send(num);
});

app.get('/will', function (req, res) {
    res.send(keys);
});

app.get('/ready', function (req, res) {
    console.log("ready"); 
    res.send('ready');
});

app.get('/healthz', function (req, res) {
  res.send('ok');
});  

app.get("/values", async (req, res) => {

  const num = Math.floor(Math.random()*10000);
  await redisClient?.set('key', num);
  await pgClient.query("INSERT INTO numbers(number) VALUES($1)", [num]);

  const numCache = await redisClient.get('key');
  const numbers = await pgClient.query("SELECT * FROM numbers");
  const values = await pgClient.query("SELECT * FROM values");

  res.send([numCache, values.rows, numbers.rows]);
});

app.get("/nums", async (req, res) => {
  try {   
    const numbers = await pgClient.query("SELECT * FROM numbers");
    res.send(numbers.rows);
  } catch (error) {
    res.send(error);   
  }
});

app.get("/add", async (req, res) => {
  await pgClient.query("INSERT INTO values(number) VALUES($1)", [Math.floor(Math.random()*10000)]);

  res.send({ working: true });
});

app.get("/addnum", async (req, res) => {
  const num = Math.floor(Math.random()*10000);
  await redisClient?.set('key', num);
  await pgClient.query("INSERT INTO numbers(number) VALUES($1)", [num]);

  res.send({ num: '.' });
});

app.listen(keys.port, err => {
  if(err) {
    console.log("err", err);  
  }

  console.log("Listening");
  console.log('envs', keys);
  
  let i = 0;
  setInterval(() => {
    i = i + 1;
    console.log(i);
  }, 5_000)
});