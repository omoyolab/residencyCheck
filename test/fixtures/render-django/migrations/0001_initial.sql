CREATE TABLE IF NOT EXISTS "public"."settlements" (
  id bigserial PRIMARY KEY,
  merchant_id bigint NOT NULL,
  amount numeric(18,2) NOT NULL,
  account_number varchar(10) NOT NULL,
  CONSTRAINT settlements_merchant_fk FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE TABLE notes (
  id serial PRIMARY KEY,
  body text
);
