#!/bin/bash
set -euo pipefail

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  exec npx vitest run src/routes/integration.test.ts src/services/farview/service.integration.test.ts
fi

integration_dir="${TEST_PGLITE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/noteone-integration-pglite.XXXXXX")}"
created_temp_dir=0
if [ -z "${TEST_PGLITE_DIR:-}" ]; then
  created_temp_dir=1
fi
cleanup() {
  if [ "$created_temp_dir" = "1" ] && [[ "$integration_dir" == "${TMPDIR:-/tmp}/noteone-integration-pglite."* ]]; then
    rm -rf "$integration_dir"
  fi
}
trap cleanup EXIT

TEST_PGLITE_DIR="$integration_dir" npx vitest run \
  src/routes/integration.test.ts \
  src/services/farview/service.integration.test.ts
