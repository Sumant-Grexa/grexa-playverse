#!/bin/sh
set -eu
cd /app
node --experimental-strip-types packages/db/src/migrate.ts
cd /app/apps/web
exec pnpm exec next start -H 0.0.0.0 -p 3000
