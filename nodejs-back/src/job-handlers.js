// Job handlers, extracted from worker.js so they are unit-testable without a
// Redis listener. Each takes the parsed job payload and returns the result
// object that gets stored on the job row.

export function handleWordcount({ text }) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { words, chars: text.length };
}

export function handleFibonacci({ n }) {
  let a = 0n;
  let b = 1n;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  const result = n <= 1 ? BigInt(n) : b;
  return { n, result: result.toString() };
}

export const handlers = {
  wordcount: handleWordcount,
  fibonacci: handleFibonacci,
};
