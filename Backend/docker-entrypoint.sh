#!/bin/sh
set -eu

cd /app
prisma migrate deploy
exec node dist/main.js
