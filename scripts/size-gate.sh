#!/usr/bin/env bash
# Fails when a file added or modified between BASE and HEAD is larger than LIMIT bytes,
# unless it is listed in scripts/size-gate.allow (one path per line, "# reason" comments).
# Usage: scripts/size-gate.sh <base-ref> [head-ref]    (LIMIT defaults to 1 MiB)
set -euo pipefail
BASE="${1:?usage: size-gate.sh <base-ref> [head-ref]}"
HEAD="${2:-HEAD}"
LIMIT="${LIMIT:-1048576}"
ALLOW="$(dirname "$0")/size-gate.allow"
fail=0
while IFS= read -r -d '' path; do
  size=$(git cat-file -s "$HEAD:$path")
  [ "$size" -le "$LIMIT" ] && continue
  if [ -f "$ALLOW" ] && sed 's/#.*//' "$ALLOW" | awk '{$1=$1};1' | grep -qxF "$path"; then
    echo "allowed: $path ($size bytes)"
    continue
  fi
  echo "::error file=$path::$path is $size bytes (limit $LIMIT). Keep it out of git or add it to scripts/size-gate.allow with a reason."
  fail=1
done < <(git diff -z --name-only --diff-filter=AM "$BASE" "$HEAD")
exit "$fail"
