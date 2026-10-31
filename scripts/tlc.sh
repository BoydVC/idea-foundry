#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAR="$ROOT/.tools/tla2tools.jar"
mkdir -p "$ROOT/.tools" "$ROOT/.tmp/tlc"
if [[ ! -f "$JAR" ]]; then
  curl -fsSL -o "$JAR" "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
fi

run_tlc() {
  local dir="$1"
  local module="$2"
  java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers 1 -config "$dir/foundry.cfg" "$dir/$module.tla"
}

echo "TLC foundry.tla"
run_tlc "$ROOT/model" foundry

node "$ROOT/scripts/mutate-model.ts"
cp "$ROOT/model/foundry.cfg" "$ROOT/.tmp/tlc/foundry.cfg"
echo "TLC foundry_skip_gate.tla (this run must fail)"
set +e
mutation="$(run_tlc "$ROOT/.tmp/tlc" foundry_skip_gate 2>&1)"
code=$?
set -e
printf '%s\n' "$mutation"
if [[ $code -eq 0 ]]; then
  echo "mutation passed but must fail"
  exit 1
fi
if ! printf '%s' "$mutation" | grep -q "Invariant"; then
  echo "mutation failed without an invariant violation"
  exit 1
fi
echo "mutation failed as required (exit $code)"
