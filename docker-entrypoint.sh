#!/bin/sh
# القرص الدائم يُركَّب بصلاحيات root؛ نعطيه للمستخدم node ثم نشغّل التطبيق بدون صلاحيات root.
set -e
DATA_DIR="$(dirname "${DB_PATH:-/data/attendance.db}")"
mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR"
exec su-exec node "$@"
