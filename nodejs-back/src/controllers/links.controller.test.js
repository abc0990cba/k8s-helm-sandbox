import { test } from "node:test";
import assert from "node:assert/strict";
import { LinksController } from "./links.controller.js";

// minimal express req/res doubles — enough to drive the controller handlers
// without an HTTP listener or a real libSQL/redis connection
function mockReq({ params = {}, body, query = {}, headers = {} } = {}) {
  return {
    params,
    body,
    query,
    headers,
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

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

// fake @libsql/client: matches statements by regex, records calls
function fakeDb({ selectRows = [], deleteAffected = 1 } = {}) {
  const calls = [];
  return {
    calls,
    insertCount: 0,
    async execute({ sql, args = [] }) {
      calls.push({ sql, args });
      if (/^INSERT INTO links/i.test(sql)) {
        if (this.failFirstInsert && this.insertCount === 0) {
          this.insertCount += 1;
          const err = new Error("UNIQUE constraint failed: links.code");
          err.code = "SQLITE_CONSTRAINT";
          throw err;
        }
        this.insertCount = (this.insertCount ?? 0) + 1;
        return { rows: [], rowsAffected: 1, lastInsertRowid: undefined };
      }
      if (/WHERE code = \?/i.test(sql) && /SELECT/i.test(sql)) {
        return { rows: selectRows, rowsAffected: 0, lastInsertRowid: undefined };
      }
      if (/^DELETE FROM links/i.test(sql)) {
        return { rows: [], rowsAffected: deleteAffected, lastInsertRowid: undefined };
      }
      if (/count\(\*\) AS total/i.test(sql)) {
        return { rows: [{ total: selectRows.length }], rowsAffected: 0, lastInsertRowid: undefined };
      }
      return { rows: selectRows, rowsAffected: 0, lastInsertRowid: undefined };
    },
  };
}

function fakeRedis() {
  const store = new Map();
  const clicks = [];
  return {
    store,
    clicks,
    async get(k) { return store.get(k) ?? null; },
    async set(k, v) { store.set(k, v); return "OK"; },
    async del(k) { return store.delete(k) ? 1 : 0; },
    async xAdd(stream, id, fields) { clicks.push({ stream, fields }); return "0-1"; },
  };
}

const link = {
  code: "abc1234",
  url: "https://example.com",
  title: "Example",
  created_by: "demo",
  created_at: "2026-10-06T10:00:00.000Z",
};

// what the gateway forwards after validating the RS256 token: header.payload.signature
const demoJwt = `Bearer aGVhZGVy.${Buffer.from(JSON.stringify({ preferred_username: "demo" })).toString("base64url")}.sig`;

test("links: create answers 201 with the stored row", async () => {
  const db = fakeDb({ selectRows: [link] });
  const ctrl = new LinksController(db, fakeRedis());
  const res = mockRes();
  await ctrl.create(mockReq({ body: { url: "https://example.com", title: "Example" }, headers: { authorization: demoJwt } }), res, () => {});

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, link);
  const insert = db.calls.find((c) => /^INSERT INTO links/i.test(c.sql));
  assert.equal(insert.args[2], "Example");
  assert.equal(insert.args[3], "demo", "owner comes from the decoded JWT payload");
});

test("links: create rejects a non-URL body with 400", async () => {
  const ctrl = new LinksController(fakeDb(), fakeRedis());
  for (const body of [undefined, {}, { url: "not a url" }]) {
    const res = mockRes();
    await ctrl.create(mockReq({ body }), res, () => {});
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test("links: a code collision regenerates instead of failing", async () => {
  const db = fakeDb({ selectRows: [link] });
  db.failFirstInsert = true;
  const ctrl = new LinksController(db, fakeRedis());
  const res = mockRes();
  await ctrl.create(mockReq({ body: { url: "https://example.com" } }), res, () => {});

  assert.equal(res.statusCode, 201);
  const inserts = db.calls.filter((c) => /^INSERT INTO links/i.test(c.sql));
  assert.equal(inserts.length, 2, "first insert hit the PK collision, second must succeed");
});

test("links: list returns the { items, total, limit, offset } page shape", async () => {
  const ctrl = new LinksController(fakeDb({ selectRows: [link] }), fakeRedis());
  const res = mockRes();
  await ctrl.list(mockReq({ query: { limit: "5", offset: "10" } }), res, () => {});

  assert.deepEqual(res.body, { items: [link], total: 1, limit: 5, offset: 10 });
});

test("links: list with q builds an FTS5 prefix query", async () => {
  const db = fakeDb({ selectRows: [link] });
  const ctrl = new LinksController(db, fakeRedis());
  const res = mockRes();
  await ctrl.list(mockReq({ query: { q: "kube docs" } }), res, () => {});

  assert.equal(res.statusCode, 200);
  const match = db.calls.find((c) => /links_fts MATCH \?/i.test(c.sql));
  assert.equal(match.args[0], "kube* docs*", "each word becomes a prefix term (implicit AND)");
});

test("links: resolve fills the read-through cache and publishes a click event", async () => {
  const redis = fakeRedis();
  const ctrl = new LinksController(fakeDb({ selectRows: [link] }), redis);
  const res = mockRes();
  await ctrl.resolve(mockReq({ params: { code: "abc1234" }, headers: { referer: "https://grogu.test/links" } }), res, () => {});

  assert.equal(res.headers["X-Cache"], "miss");
  assert.deepEqual(res.body, link);
  assert.ok(redis.store.get("link:abc1234"), "cache must be filled");
  assert.equal(redis.clicks.length, 1);
  assert.equal(redis.clicks[0].stream, "clicks");
  assert.equal(redis.clicks[0].fields.code, "abc1234");
  assert.equal(redis.clicks[0].fields.referrer, "https://grogu.test/links");
  assert.match(redis.clicks[0].fields.ts, /^\d+$/);
});

test("links: resolve on a cache hit still records the click", async () => {
  const redis = fakeRedis();
  redis.store.set("link:abc1234", JSON.stringify(link));
  const ctrl = new LinksController(fakeDb(), redis);
  const res = mockRes();
  await ctrl.resolve(mockReq({ params: { code: "abc1234" } }), res, () => {});

  assert.equal(res.headers["X-Cache"], "hit");
  assert.equal(redis.clicks.length, 1, "cache hits are clicks too — analytics must not lose them");
});

test("links: unknown code answers 404 and records nothing", async () => {
  const redis = fakeRedis();
  const ctrl = new LinksController(fakeDb({ selectRows: [] }), redis);
  const res = mockRes();
  await ctrl.resolve(mockReq({ params: { code: "zzz9999" } }), res, () => {});

  assert.equal(res.statusCode, 404);
  assert.equal(redis.clicks.length, 0);
});

test("links: malformed codes answer 400", async () => {
  const ctrl = new LinksController(fakeDb(), fakeRedis());
  for (const code of ["with-dash", "with space", ""]) {
    const res = mockRes();
    await ctrl.resolve(mockReq({ params: { code } }), res, () => {});
    assert.equal(res.statusCode, 400, code);
  }
});

test("links: delete answers 204 and drops the cache entry", async () => {
  const redis = fakeRedis();
  redis.store.set("link:abc1234", JSON.stringify(link));
  const ctrl = new LinksController(fakeDb(), redis);
  const res = mockRes();
  await ctrl.remove(mockReq({ params: { code: "abc1234" } }), res, () => {});

  assert.equal(res.statusCode, 204);
  assert.equal(redis.store.has("link:abc1234"), false, "stale cache must be dropped");
});
