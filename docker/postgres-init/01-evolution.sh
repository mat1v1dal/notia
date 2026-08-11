#!/bin/sh
# Evolution guarda su estado en su propia base, separada de la de notia.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
	CREATE DATABASE evolution;
SQL
