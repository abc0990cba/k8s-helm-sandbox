CREATE TABLE IF NOT EXISTS numbers (
  id SERIAL PRIMARY KEY,
  number INT NOT NULL
);

INSERT INTO numbers (number) VALUES  (3087), (45), (8912), (5), (99), (333);

CREATE TABLE IF NOT EXISTS golang_numbers (
  id SERIAL PRIMARY KEY,
  number INT NOT NULL
);

INSERT INTO golang_numbers (number) VALUES (1703);