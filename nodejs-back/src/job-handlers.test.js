import { test } from "node:test";
import assert from "node:assert/strict";
import { handleFibonacci, handleWordcount } from "./job-handlers.js";

test("wordcount counts words and chars from the payload text", () => {
  assert.deepEqual(handleWordcount({ text: "hello  brave new world " }), { words: 4, chars: 23 });
  assert.deepEqual(handleWordcount({ text: "one" }), { words: 1, chars: 3 });
});

test("fibonacci: fib(10) = 55 (the smoke suite asserts this)", () => {
  assert.deepEqual(handleFibonacci({ n: 10 }), { n: 10, result: "55" });
});

test("fibonacci handles the small edge cases", () => {
  assert.equal(handleFibonacci({ n: 0 }).result, "0");
  assert.equal(handleFibonacci({ n: 1 }).result, "1");
  assert.equal(handleFibonacci({ n: 2 }).result, "1");
});
