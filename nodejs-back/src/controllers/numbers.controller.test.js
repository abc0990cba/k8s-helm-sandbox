import { test } from "node:test";
import assert from "node:assert/strict";
import { NumbersController } from "./numbers.controller.js";

// minimal express req/res doubles — enough to drive the controller handlers
// without an HTTP listener or a real libSQL/redis connection
function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    sent: false,
    status(code) { res.statusCode = code; return res; },
    send(payload) { res.body = payload; res.sent = true; return res; },
  };
  return res;
}

function fakeDb(rows = []) {
  return {
    async execute(statement) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (/^INSERT INTO numbers/i.test(sql)) {
        return { rows: [], rowsAffected: 1, lastInsertRowid: 2n };
      }
      return { rows, rowsAffected: 0, lastInsertRowid: undefined };
    },
  };
}

function fakeRedis() {
  const store = new Map();
  return {
    store,
    async set(k, v) { store.set(k, v); return "OK"; },
    async get(k) { return store.get(k) ?? null; },
    async del(k) { return store.delete(k) ? 1 : 0; },
  };
}

test("numbers: GET lists rows without inserting anything", async () => {
  const rows = [{ id: 1, number: 3087 }];
  let inserts = 0;
  const db = fakeDb(rows);
  const rawExecute = db.execute;
  db.execute = async (statement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (/INSERT/i.test(sql)) inserts += 1;
    return rawExecute.call(db, statement);
  };

  const ctrl = new NumbersController(db, fakeRedis());
  const res = mockRes();
  await ctrl.list({}, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, rows);
  assert.equal(inserts, 0, "the old GET-inserts-a-row bug must stay dead");
});

test("numbers: POST inserts and answers 201", async () => {
  const db = fakeDb();
  const redis = fakeRedis();
  const ctrl = new NumbersController(db, redis);
  const res = mockRes();
  await ctrl.create({ body: { number: 42 } }, res, () => {});

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { id: 2, number: 42 });
  assert.equal(redis.store.get("number"), "42", "smoke suite reads this cache key");
});

test("numbers: POST rejects non-integer bodies with 400", async () => {
  const ctrl = new NumbersController(fakeDb(), fakeRedis());
  for (const body of [undefined, {}, { number: "abc" }, { number: 1.5 }]) {
    const res = mockRes();
    await ctrl.create({ body }, res, () => {});
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});
