#!/bin/sh
set -e

echo "==> Running database migrations..."
pnpm --filter @workspace/db run push

echo "==> Starting API server..."
exec node --enable-source-maps /app/dist/index.mjs
