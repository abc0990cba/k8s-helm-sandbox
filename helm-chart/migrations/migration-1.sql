-- migration 1 — the original number tables, now written idempotently (the
-- migration Job re-runs on every upgrade via the version-bump mechanism)
CREATE TABLE IF NOT EXISTS nodejs_numbers (
  id SERIAL PRIMARY KEY,
  number INT NOT NULL
);

INSERT INTO nodejs_numbers (number)
SELECT 3087
WHERE NOT EXISTS (SELECT 1 FROM nodejs_numbers WHERE number = 3087);

CREATE TABLE IF NOT EXISTS golang_numbers (
  id SERIAL PRIMARY KEY,
  number INT NOT NULL
);

INSERT INTO golang_numbers (number)
SELECT 1703
WHERE NOT EXISTS (SELECT 1 FROM golang_numbers WHERE number = 1703);
