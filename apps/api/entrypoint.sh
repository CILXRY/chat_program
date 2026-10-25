#!/bin/sh
set -e

echo "→ applying database migrations"
alembic upgrade head

exec "$@"
