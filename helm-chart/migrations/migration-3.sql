-- The database-per-service split: nodejs-back moved off postgres onto libSQL
-- (links + jobs live there now). Its old tables are dropped here; notes and
-- daily_reports stay (golang owns notes, the nightly SQL report keeps
-- aggregating into daily_reports).

DROP TABLE IF EXISTS nodejs_numbers;
DROP TABLE IF EXISTS jobs;
