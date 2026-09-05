-- Indexes for Swiss Cheese. Run after schema.sql.
--
-- The trigram index is not optional. Counterparty matching is
-- `description ILIKE '%alias%'`, a leading-wildcard pattern that a B-tree
-- cannot serve. Without pg_trgm every vendor question sequentially scans the
-- transaction table.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_transaction_date
    ON transaction (transaction_date);

CREATE INDEX IF NOT EXISTS idx_transaction_account
    ON transaction (account_id);

CREATE INDEX IF NOT EXISTS idx_transaction_reference
    ON transaction (transaction_reference_id);

-- Period spend is always "type + date window", so index the pair.
CREATE INDEX IF NOT EXISTS idx_transaction_type_date
    ON transaction (transaction_type, transaction_date);

CREATE INDEX IF NOT EXISTS idx_account_bank
    ON account (bank_code);

CREATE INDEX IF NOT EXISTS idx_transaction_description_trgm
    ON transaction USING GIN (description gin_trgm_ops);
