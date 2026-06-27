#!/usr/bin/env bash
# Run the Cypress e2e suite against a freshly-reset fixture deck.
#
# Why a script: the fork's v-drag specs mutate the fixture deck's *persistent* state
# (`cypress/fixtures/basic/.slidev/state.db` — drag positions, z-order, undo history),
# so back-to-back local runs aren't idempotent unless that state is cleared first. CI
# runs on a fresh checkout so it never sees this; locally you do. This script makes a
# run reproducible end-to-end:
#   1. clear the fixture's `.slidev/` persistent state,
#   2. (re)start the `cy:fixture` dev server on :3041 from a clean port,
#   3. wait for it to answer,
#   4. run cypress (all specs, or whatever args you pass through),
#   5. tear the fixture server down on exit (no leaked dev-server trees).
# Exits with cypress's exit code.
#
# Usage:
#   cypress/run-e2e.sh                                          # all specs
#   cypress/run-e2e.sh --spec cypress/e2e/examples/v-drag.spec.ts   # one spec
#   pnpm cy:e2e [...]                                           # via package script
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT=3041
mkdir -p tmp

cleanup() {
  # Kill the whole fixture dev-server tree. `pkill -f` gets the nodemon + pnpm wrapper
  # (their cmdline carries the fixture path) first, so nodemon can't relaunch; the slidev
  # child's cmdline is just `@slidev/cli/bin/slidev.mjs`, so reap it by the port it holds.
  pkill -f 'cypress/fixtures/basic' 2>/dev/null || true
  kill-port "$PORT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1. Clear persistent fixture deck state so positions / z-order don't leak across runs.
rm -rf cypress/fixtures/basic/.slidev

# 2. Free the port + (re)start the fixture server detached.
cleanup
kill-port "$PORT" >/dev/null 2>&1 || true
sleep 1
nohup pnpm cy:fixture </dev/null >"tmp/cy-fixture-$PORT.log" 2>&1 &
disown

# 3. Wait for the server to answer (up to ~40s).
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "http://localhost:$PORT/1" 2>/dev/null; then
    break
  fi
  sleep 1
done
if ! curl -fsS -o /dev/null "http://localhost:$PORT/1" 2>/dev/null; then
  echo "cy:fixture did not come up on :$PORT — see tmp/cy-fixture-$PORT.log" >&2
  exit 1
fi

# 4. Run cypress (pass-through args, e.g. `--spec ...`).
npx cypress run --browser electron "$@"
