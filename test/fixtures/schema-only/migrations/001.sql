CREATE TABLE payment_intent (
  id varchar(64) PRIMARY KEY,
  amount bigint NOT NULL,
  currency varchar(3) NOT NULL
);
