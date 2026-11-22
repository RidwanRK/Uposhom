-- Trigram search for drug names (Latin, Bangla and aliases). Workstream C's drug tables use it.
-- Pinned to public so it is shared by every schema and survives a test schema being dropped.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
