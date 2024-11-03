CREATE TABLE IF NOT EXISTS nodejs_numbers (
  id SERIAL PRIMARY KEY,
  number INT NOT NULL
);

INSERT INTO nodejs_numbers (number) VALUES  (3087);

CREATE TABLE IF NOT EXISTS golang_numbers (
  id SERIAL PRIMARY KEY,
  number INT NOT NULL
);

INSERT INTO golang_numbers (number) VALUES (1703);