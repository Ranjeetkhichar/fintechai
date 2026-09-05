-- Swiss Cheese schema: the three tables from docs/SCHEMA.md, translated to Postgres.
-- Shape is fixed. Only the dialect differs from the MySQL DDL in the doc:
--   ENGINE/CHARSET dropped, ENUM becomes VARCHAR + CHECK, DECIMAL becomes numeric.
-- Ids stay VARCHAR(36) rather than becoming the native uuid type, per schema.

DROP TABLE IF EXISTS transaction;
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS bank;

CREATE TABLE bank (
    bank_code    VARCHAR(10)  PRIMARY KEY,
    bank_name    VARCHAR(150) NOT NULL
);

CREATE TABLE account (
    account_id         VARCHAR(36)   PRIMARY KEY,
    entity_id          VARCHAR(36)   NOT NULL,
    account_number     VARCHAR(20)   NOT NULL,
    program_id         INT           NOT NULL,
    available_balance  NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    bank_code          VARCHAR(10)   NOT NULL REFERENCES bank(bank_code)
);

CREATE TABLE transaction (
    transaction_id           VARCHAR(36)   PRIMARY KEY,
    account_id               VARCHAR(36)   NOT NULL REFERENCES account(account_id),
    transaction_date         TIMESTAMP(6)  NOT NULL,
    transaction_type         VARCHAR(10)   NOT NULL
        CHECK (transaction_type IN ('credit', 'debit')),
    description              VARCHAR(500)  DEFAULT NULL,
    transaction_amount       NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    transaction_reference_id VARCHAR(64)   DEFAULT NULL,
    utr_number               VARCHAR(256)  DEFAULT NULL
);
