const keys = require("./keys");
const { metricsMiddleware, metricsRoute } = require("./metrics");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Pool } = require("pg");
const { createClient } = require('redis');

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(metricsMiddleware);

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

app.get('/metrics', metricsRoute);

app.get('/will', function (req, res) {
    res.send(keys);
});

app.get('fibonacci', function (req, res) {
  function fib(n) {
    return n <= 1 ? n : fib(n - 1) + fib(n - 2);
  }

  const n = Math.round(Math.random() * 10000);
  const sum = fib(n);
  
  console.log(`n: ${n} sum: ${sum}`);

  res.send(sum);
})

app.get('/ready', function (req, res) {
    console.log("ready"); 
    res.send('ready');
});

app.get('/healthz', function (req, res) {
  console.log("healthy");
  res.send('healthy');
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