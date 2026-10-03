#!/bin/sh
# Runs once, on the first start with an empty data volume.
set -eu

psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
  -v db="$TALLY_DB" \
  -v writer_secret="$TALLY_WRITER_PASSWORD" \
  -v reader_secret="$TALLY_READER_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE tally_writer LOGIN PASSWORD %L', :'writer_secret') \gexec
SELECT format('CREATE ROLE tally_reader LOGIN PASSWORD %L', :'reader_secret') \gexec
CREATE DATABASE :"db" OWNER tally_writer;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO tally_reader;
\connect :"db"
ALTER SCHEMA public OWNER TO tally_writer;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tally_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE tally_writer IN SCHEMA public
  GRANT SELECT ON TABLES TO tally_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE tally_writer IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO tally_reader;
ALTER ROLE tally_reader SET default_transaction_read_only = on;
SQL
