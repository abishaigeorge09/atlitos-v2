#!/usr/bin/env bash
#
# Copies the versioned hooks in scripts/hooks/ into this clone's hook directory.
#
# Run it once per clone. It is safe to re-run, and it tells you when the
# installed copy has drifted from the committed one rather than overwriting in
# silence, because a hook edited in place and never committed is exactly how the
# pre-push gate came to call two scripts that did not exist.
#
#   scripts/install-hooks.sh          install, prompt-free, report drift
#   scripts/install-hooks.sh --check  report only, install nothing, exit 1 on drift

set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

# Correct under a worktree too: rev-parse --git-path resolves to the SHARED
# hooks directory of the common git dir, which is the one git actually consults.
HOOKS_DIR=$(git rev-parse --git-path hooks 2>/dev/null)
if [ -z "$HOOKS_DIR" ]; then
  echo "install-hooks: not inside a git repository." >&2
  exit 2
fi
mkdir -p "$HOOKS_DIR" || exit 2

STATUS=0
for src in scripts/hooks/*; do
  [ -f "$src" ] || continue
  name=$(basename "$src")
  dest="$HOOKS_DIR/$name"
  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    echo "install-hooks: $name already matches the committed copy"
    continue
  fi
  if [ "$CHECK_ONLY" = 1 ]; then
    if [ -f "$dest" ]; then
      echo "install-hooks: DRIFT, $dest differs from $src"
    else
      echo "install-hooks: MISSING, $dest is not installed"
    fi
    STATUS=1
    continue
  fi
  cp "$src" "$dest" || exit 2
  chmod +x "$dest" || exit 2
  echo "install-hooks: installed $name to $dest"
done

exit $STATUS
