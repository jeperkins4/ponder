#!/bin/bash
set -e

# Create test database
psql -v ON_ERROR_STOP=1 --username "postgres" --dbname "kanban" <<-EOSQL
  CREATE DATABASE kanban_test;
EOSQL
