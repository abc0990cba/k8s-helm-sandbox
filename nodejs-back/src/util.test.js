import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerFromRequest } from "./util.js";

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const reqWith = (authorization) => ({ headers: { authorization } });

test("owner: preferred_username wins", () => {
  const jwt = `x.${b64url({ preferred_username: "demo", sub: "abc" })}.y`;
  assert.equal(ownerFromRequest(reqWith(`Bearer ${jwt}`)), "demo");
});

test("owner: falls back to sub", () => {
  const jwt = `x.${b64url({ sub: "abc-123" })}.y`;
  assert.equal(ownerFromRequest(reqWith(jwt)), "abc-123");
});

test("owner: garbage/missing headers stay anonymous", () => {
  const headers = [undefined, "", "Bearer", "not.a.jwt", `x.${b64url({})}.y`, "x.broken-base64!.y"];
  for (const header of headers) {
    assert.equal(ownerFromRequest(reqWith(header)), "anonymous", String(header));
  }
});
