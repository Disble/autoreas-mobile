CREATE TABLE operation_log (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
