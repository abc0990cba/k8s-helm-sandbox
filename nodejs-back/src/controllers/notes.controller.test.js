import { test } from "node:test";
import assert from "node:assert/strict";
import { NotesController } from "./notes.controller.js";

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { res.statusCode = code; return res; },
    send(payload) { res.body = payload; return res; },
    set(k, v) { res.headers[k] = v; return res; },
  };
  return res;
}

const note = { id: 1, title: "t", body: "b", owner: "demo" };

function fakePg({ getRows = [note], getError = null } = {}) {
  return {
    async query(sql) {
      if (/WHERE id = \$1/i.test(sql) && /SELECT/i.test(sql)) {
        if (getError) throw getError;
        return { rows: getRows, rowCount: getRows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

function fakeRedis() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async set(k, v) { store.set(k, v); return "OK"; },
    async del(k) { return store.delete(k) ? 1 : 0; },
  };
}

test("notes: GET by id fills the read-through cache on a miss", async () => {
  const redis = fakeRedis();
  const ctrl = new NotesController(fakePg(), redis);
  const res = mockRes();
  await ctrl.getOne({ params: { id: "1" } }, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["X-Cache"], "miss");
  assert.ok(redis.store.get("note:1"), "cache must be filled");
});

test("notes: second GET by id is served from cache", async () => {
  const redis = fakeRedis();
  redis.store.set("note:1", JSON.stringify(note));
  const ctrl = new NotesController(fakePg(), redis);
  const res = mockRes();
  await ctrl.getOne({ params: { id: "1" } }, res, () => {});

  assert.equal(res.headers["X-Cache"], "hit");
  assert.deepEqual(res.body, note);
});

test("notes: PATCH invalidates the cache", async () => {
  const redis = fakeRedis();
  redis.store.set("note:1", JSON.stringify(note));
  const pg = fakePg();
  pg.query = async (sql) => {
    if (/UPDATE/i.test(sql)) return { rows: [{ ...note, title: "new" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const ctrl = new NotesController(pg, redis);
  const res = mockRes();
  await ctrl.update({ params: { id: "1" }, body: { title: "new" } }, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(redis.store.has("note:1"), false, "stale cache must be dropped");
});

test("notes: missing note answers 404, not 500", async () => {
  const ctrl = new NotesController(fakePg({ getRows: [] }), fakeRedis());
  const res = mockRes();
  await ctrl.getOne({ params: { id: "999" } }, res, () => {});
  assert.equal(res.statusCode, 404);
});

test("notes: invalid id answers 400", async () => {
  const ctrl = new NotesController(fakePg(), fakeRedis());
  const res = mockRes();
  await ctrl.getOne({ params: { id: "abc" } }, res, () => {});
  assert.equal(res.statusCode, 400);
});
