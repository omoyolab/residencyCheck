CREATE TABLE transactions (
  id uuid PRIMARY KEY,
  amount bigint NOT NULL,
  currency char(3) NOT NULL
);
