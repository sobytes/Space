#!/usr/bin/env bash
# One command that runs every gate across the monorepo and exits non-zero if any fails.
#
# This exists because I twice reported a green run that was not green, both times by piping a
# command into grep or tail and reading the pipeline's exit code instead of the command's.
# `set -o pipefail` plus explicit status capture makes that mistake impossible here.
#
# Typecheck runs per workspace. The engine's tsconfig omits `dom` from `lib`, so running it
# separately is what turns engine purity into a compile error rather than a convention.
set -uo pipefail

failed=0

run() {
  local name="$1"
  shift
  printf '%-18s ' "$name"
  if output=$("$@" 2>&1); then
    printf 'ok\n'
  else
    printf 'FAILED\n'
    printf '%s\n' "$output" | tail -25
    failed=1
  fi
}

run "typecheck engine" npm run --silent typecheck --workspace engine
run "typecheck website" npm run --silent typecheck --workspace website
run "lint" npx eslint .
run "tests" npx vitest run

if [ "$failed" -ne 0 ]; then
  printf '\nat least one gate failed\n'
  exit 1
fi

printf '\nall gates green\n'
