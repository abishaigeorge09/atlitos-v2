#!/usr/bin/env bash
# Fails if any app source file hardcodes a numeric border radius literal
# instead of importing a radii token from @atlitos/theme.
#
# Rationale: docs/design/DESIGN-LANGUAGE.md "Tokens only" rule, enforced by
# the biased approver at every phase gate. packages/theme is the only place
# allowed to define raw radius numbers (that's where the tokens live).
#
# Grep-based on purpose: fast, dependency-free, easy to read/extend. Matches
# `borderRadius:`, `borderTopLeftRadius:`, `borderTopRightRadius:`,
# `borderBottomLeftRadius:`, `borderBottomRightRadius:` followed by a numeric
# literal, inside apps/*/src (mobile RN StyleSheet objects and inline
# style={{...}} literals both use this shape).
set -euo pipefail

cd "$(dirname "$0")/.."

PATTERN='border(TopLeft|TopRight|BottomLeft|BottomRight)?Radius:[[:space:]]*[0-9]'

offenders=$(grep -rnE "$PATTERN" apps/*/src --include="*.ts" --include="*.tsx" 2>/dev/null || true)

if [ -n "$offenders" ]; then
  echo "check-tokens: hardcoded border radius literal(s) found outside packages/theme:"
  echo ""
  echo "$offenders"
  echo ""
  echo "Import the matching token from '@atlitos/theme' (radii.xs/sm/md/lg/xl/2xl/pill) instead."
  echo "See docs/design/DESIGN-LANGUAGE.md > Radii."
  exit 1
fi

echo "check-tokens: no hardcoded border radius literals found."
