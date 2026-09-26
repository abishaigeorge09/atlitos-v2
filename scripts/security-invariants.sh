#!/usr/bin/env bash
#
# Atlitos security and house-rule invariants.
#
# WHY THIS FILE EXISTS
# --------------------
# `.git/hooks/pre-push` has called this script since 11 August 2026 behind a
# `[ -x scripts/security-invariants.sh ]` guard. The file did not exist, and had
# never existed in any commit, so the guard turned its absence into a silent
# exit 0. Every "the invariants are enforced" claim on this project up to
# 2026-08-14 was held by reviewer attention alone. See
# docs/qa/verify/VERIFICATION-WAVE-1.md P1-6 and docs/qa/CURRENT-STATE.md
# ("A gate that references a script that never existed").
#
# EVERY CHECK IN HERE WAS BORN RED. Each one was watched failing against a
# deliberately planted violation before it was trusted, and the plant was then
# removed and the tree proved clean. A check nobody watched fail is not a check.
# The evidence is in docs/qa/verify/GATES-BORN-RED.md.
#
# TWO TRAPS THIS SCRIPT DELIBERATELY AVOIDS
#   1. `grep -E` does NOT honour the word-boundary escape \b, so a pattern
#      written with \b silently matches nothing and the check passes over
#      violations sitting in the tree. No pattern here uses \b.
#   2. BSD grep (macOS, developer laptops) and GNU grep (Linux, CI) disagree on
#      -P, \d, \s and backreferences. Nothing here uses any of them, so the same
#      patterns fire identically in both places.
#
# A FALSE POSITIVE IS MORE EXPENSIVE THAN A MISSING CHECK, because it teaches
# everyone to ignore the whole script. Where a rule has a legitimate exception,
# the exception is an explicit per-line waiver comment that a human has to type,
# never a silently widened pattern. Waivers are greppable:
#   invariant-allow: <check-id> <reason>
#
# USAGE
#   scripts/security-invariants.sh            run every check, DB drift included
#   scripts/security-invariants.sh --offline  run the static checks only, and say
#                                             loudly that the DB check did not run
#
# The DB drift check needs a Postgres connection string in ATLITOS_DB_URL or
# SUPABASE_DB_URL and a psql on PATH. Without --offline, a missing connection is
# a FAILURE, not a skip: house rule, a check that should apply but cannot run is
# an unheld boundary.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
ROOT=$(pwd)

OFFLINE=0
LIVE_TABLES_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --offline) OFFLINE=1 ;;
    --live-tables) shift; LIVE_TABLES_FILE="${1:-}" ;;
    --live-tables=*) LIVE_TABLES_FILE="${1#*=}" ;;
    -h|--help) sed -n '1,45p' "$0"; exit 0 ;;
    *) echo "security-invariants: unknown argument '$1'" >&2; exit 2 ;;
  esac
  shift
done

FAILED=0
CHECKS_RUN=0

pass() { CHECKS_RUN=$((CHECKS_RUN + 1)); printf 'PASS  %-24s %s\n' "$1" "$2"; }
fail() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  FAILED=$((FAILED + 1))
  printf 'FAIL  %-24s %s\n' "$1" "$2"
  printf '%s\n' "$3" | sed 's/^/        /'
  echo
}

# --------------------------------------------------------------------------
# Scopes
#
# SHIP_DIRS is code that runs on a user's device or in a user's browser, which
# is what "client" means in the financial invariant. Deliberately excluded, each
# for a stated reason rather than because it was noisy:
#   supabase/functions  server side, service role, the ONLY place allowed to
#                       write money rows.
#   scripts/            service-role seed and verify harnesses, not clients.
#   apps/e2e            exists to ATTEMPT forbidden writes and assert they are
#                       refused. A check that forbade them there would forbid
#                       the proof. Covered instead by CHECK e2e-negative-proof.
# --------------------------------------------------------------------------
SHIP_DIRS="apps/mobile/src apps/admin/src apps/portal-court/src apps/portal-life/src packages/api/src packages/ui-native/src packages/ui-web/src packages/types/src"

TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT

ship_files() {
  find $SHIP_DIRS -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort
}
ship_files > "$TMP/ship.txt"

if [ ! -s "$TMP/ship.txt" ]; then
  echo "security-invariants: found no source files under: $SHIP_DIRS" >&2
  echo "                     refusing to report a green from an empty scan." >&2
  exit 2
fi

echo "Atlitos security invariants"
echo "root   $ROOT"
echo "files  $(wc -l < "$TMP/ship.txt" | tr -d ' ') client source files in scope"
echo

# --------------------------------------------------------------------------
# CHECK money-client-write
#
# CLAUDE.md, Financial invariant: no client-side .insert()/.update()/.upsert()/
# .delete() against payment_intents, ledger_entries, payout_accounts, transfers.
#
# Chained, so a single-line grep would miss the common multi-line form:
#     await supabase
#       .from("payment_intents")
#       .update({ status: "captured" })
# The scan walks forward from the .from() to the end of the chain instead.
# --------------------------------------------------------------------------
MONEY_TABLES='payment_intents|ledger_entries|payout_accounts|transfers'

# The chain walker.
#
#   fromre        the anchor, a .from("<table>") line
#   gate          an extra pattern that must ALSO appear in the chain for the
#                 site to count at all. This is what keeps the read-only rules
#                 off writes, and vice versa.
#   wantre        the pattern being looked for
#   want_present  1 reports a site where wantre IS found, 0 reports one where it
#                 is NOT
#
# A comment line is never an anchor. Two of the first offenders this reported
# were prose inside a docblock explaining the very rule being checked, and a
# check that flags its own documentation is the false positive that gets the
# whole script switched off.
cat > "$TMP/chain.awk" <<'AWK'
{ lines[FNR] = $0; n = FNR }
END {
  for (i = 1; i <= n; i++) {
    if (lines[i] !~ fromre) continue
    if (lines[i] ~ cmtre) continue
    # A waiver may sit on the anchor line itself, or anywhere in the unbroken
    # comment block immediately above it, so the reason can be a sentence
    # rather than a line that has to fit beside the code.
    if (lines[i] ~ waiver) continue
    waived = 0
    for (k = i - 1; k >= 1 && k >= i - 8; k--) {
      if (lines[k] !~ cmtre) break
      if (lines[k] ~ waiver) { waived = 1; break }
    }
    if (waived) continue
    gated = (gate == "")
    excluded = 0
    hit = ""
    for (j = i; j <= i + span && j <= n; j++) {
      if (j > i && lines[j] ~ /[.]from[(]/) break
      if (gate != "" && lines[j] ~ gate) gated = 1
      if (notre != "" && lines[j] ~ notre) excluded = 1
      if (hit == "" && lines[j] ~ wantre) hit = lines[j]
    }
    if (!gated || excluded) continue
    if ((want_present && hit != "") || (!want_present && hit == "")) {
      out = lines[i]
      sub(/^[ \t]+/, "", out)
      printf "%s:%d: %s\n", FILENAME, i, out
    }
  }
}
AWK

# Patterns handed to awk use [.] and [(] rather than \. and \(, because BSD awk
# strips unrecognised escapes out of a -v string before it ever reaches the
# regex engine, leaving an unbalanced group and a syntax error. Bracket classes
# survive BSD awk, gawk and mawk identically. This was caught by running it,
# not by reasoning about it.
run_chain_scan() {
  # $1 from-pattern  $2 gate  $3 wanted-pattern  $4 want_present(1|0)
  # $5 waiver-id     $6 span  $7 anti-gate (optional)
  local out=""
  while IFS= read -r f; do
    # cmtre is passed in rather than written as a regex literal because a `/`
    # inside a bracket class still closes an awk regex literal on BSD awk.
    out="$out$(awk -v fromre="$1" -v gate="$2" -v wantre="$3" -v want_present="$4" \
                   -v waiver="invariant-allow: $5" -v span="$6" -v notre="${7:-}" \
                   -v cmtre='^[ \t]*([/][/]|[*]|[/][*])' \
                   -f "$TMP/chain.awk" "$f")
"
  done < "$TMP/ship.txt"
  printf '%s' "$out" | sed '/^$/d'
}

offenders=$(run_chain_scan "[.]from[(]\"($MONEY_TABLES)\"" "" '[.](insert|update|upsert|delete)[(]' 1 money-client-write 12)
if [ -n "$offenders" ]; then
  fail money-client-write "client code writes a money table" "$offenders
Money rows are written only by edge functions under the service role.
See CLAUDE.md > Financial invariant."
else
  pass money-client-write "no client write against $MONEY_TABLES"
fi

# --------------------------------------------------------------------------
# CHECK money-status-write
#
# The second half of the same invariant: state transitions on money-bearing
# rows go through a Postgres RPC that raises INVALID_TRANSITION, never through
# a client setting a status field. This catches the shape the table list above
# does not, ie a client updating orders/sessions/bookings/donations directly.
# --------------------------------------------------------------------------
#
# Note what this does NOT do. The first draft looked for a bare `status:` line
# anywhere in the chain window, and it fired twice, on
# `packages/api/src/use-coach.ts:563` and `packages/api/src/use-shop.ts:1024`.
# Both were TypeScript row-type declarations sitting a few lines under a plain
# SELECT. Two false positives out of two findings, which is exactly how a script
# earns the reputation that gets it ignored. The rule is now anchored on the
# write verb, which is the thing actually forbidden.
MONEY_BEARING='orders|order_items|sessions|court_bookings|donations|group_memberships|refunds|clips|payments'

offenders=$(run_chain_scan "[.]from[(]\"($MONEY_BEARING)\"" "" '[.](update|upsert|delete)[(]' 1 money-status-write 12)
if [ -n "$offenders" ]; then
  fail money-status-write "client code sets a status field on a money-bearing row" "$offenders
Transitions belong in an RPC that can raise INVALID_TRANSITION.
See CLAUDE.md > Financial invariant."
else
  pass money-status-write "no client status write on $MONEY_BEARING"
fi

# --------------------------------------------------------------------------
# CHECK e2e-negative-proof
#
# apps/e2e is allowed to attempt a forbidden money write, because that is the
# proof the write is refused. It is NOT allowed to attempt one without asserting
# the refusal, which would be a vacuous pass: see CLAUDE.md, "prove the
# forbidden write is refused, not merely that the allowed one succeeds".
# --------------------------------------------------------------------------
offenders=""
if [ -d apps/e2e ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if command grep -qE "\\.from\\(\"($MONEY_TABLES)\"" "$f" 2>/dev/null; then
      if ! command grep -qE 'expect\(' "$f" 2>/dev/null; then
        offenders="$offenders$f: touches a money table with no expect() in the file
"
      fi
    fi
  done <<EOF
$(find apps/e2e -type f -name '*.ts' 2>/dev/null | sort)
EOF
fi
offenders=$(printf '%s' "$offenders" | sed '/^$/d')
if [ -n "$offenders" ]; then
  fail e2e-negative-proof "e2e money write with no assertion" "$offenders
A test that writes a money table must assert the write was REFUSED."
else
  pass e2e-negative-proof "every e2e money write sits beside an assertion"
fi

# --------------------------------------------------------------------------
# CHECK hardcoded-hex
#
# CLAUDE.md > Tokens only. packages/theme is the one place raw colour may be
# written. Comment lines are excluded on purpose: three #RRGGBB matches in
# mobile source are comments explaining a token decision, and firing on those
# is the false positive that gets the whole script ignored
# (VERIFICATION-WAVE-1.md section 3).
# --------------------------------------------------------------------------
offenders=$(command grep -rnE '#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?[^0-9a-zA-Z]' $SHIP_DIRS \
              --include='*.ts' --include='*.tsx' 2>/dev/null \
            | command grep -vE ':[0-9]+:[ \t]*(//|\*|/\*)' \
            | command grep -v 'invariant-allow: hardcoded-hex' || true)
if [ -n "$offenders" ]; then
  fail hardcoded-hex "raw colour literal outside packages/theme" "$offenders
Add the value to packages/theme (mobile) or the portal HSL var set (web) and
import it. See CLAUDE.md > Tokens only."
else
  pass hardcoded-hex "no raw hex colour outside packages/theme"
fi

# --------------------------------------------------------------------------
# CHECK no-emoji
#
# CLAUDE.md > House style. Perl rather than grep because BSD grep has no -P and
# no unicode class support, and the ranges have to be identical on macOS and on
# CI. Ranges cover pictographs, dingbats, symbols, regional indicators and the
# variation selector, which is what an emoji smuggled in as text looks like.
# --------------------------------------------------------------------------
EMOJI_RE='[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}\x{1F1E6}-\x{1F1FF}\x{2190}-\x{21FF}\x{2B50}\x{203C}\x{2049}]'
# `close ARGV if eof` is load bearing: without it perl's $. keeps counting
# across every file in the list, and the first planted canary was reported at
# line 8007 of a 3 line file. A check that fires on the right file at the wrong
# line is most of the way to being useless, and it was only visible because the
# violation was planted and the output actually read.
offenders=$(perl -CSD -ne 'print "$ARGV:$.: $_" if /'"$EMOJI_RE"'/; close ARGV if eof;' $(cat "$TMP/ship.txt") 2>/dev/null || true)
if [ -n "$offenders" ]; then
  fail no-emoji "emoji in source" "$offenders
No emojis anywhere: not in copy, comments, or commit messages.
Use a lucide icon name instead. See CLAUDE.md > House style."
else
  pass no-emoji "no emoji in client source"
fi

# --------------------------------------------------------------------------
# CHECK copy-dashes
#
# CLAUDE.md > House style: no em-dashes and no hyphens in user-visible copy
# strings. Scoped to strings that actually render:
#   - JSX text nodes
#   - the copy-bearing props (title, label, placeholder, message, ...)
#   - exported/local `const` string literals (copy is routinely held in a
#     bare const and imported into a screen, not always inlined as a prop)
#   - template literals
# and NOT to docblocks, identifiers, imports or Figma frame names in comments,
# which have produced false findings here before (VERIFICATION-WAVE-1 section 3
# ruled out two of exactly that shape), and NOT to the `// ATLITOS v2 - <path>`
# file header convention (162 files on the base branch use an em-dash there by
# established convention; it is a comment, already excluded by the comment
# filter below, and it is not copy).
#
# WIDENED 2026-08-14 (p6 integration audit). The original version only fired
# inside JSX props, JSX text nodes and object-literal keys, and reported PASS
# on a file with an em-dash in an exported `const` string, an en-dash in an
# exported `const` string, and an em-dash in a template literal: all three are
# a common way this codebase holds copy, and a check that reports clean over
# an unexamined class is worse than no check (CLAUDE.md > rules learned
# expensively). Each of the three misses was planted and watched fail before
# this widening was trusted: see docs/qa/verify/GATES-BORN-RED.md.
#
# The two new offender clauses below are deliberately restricted to em-dash and
# en-dash only, NOT the spaced hyphen `offenders`/`offenders2`/`offenders3` also
# check for. A bare `const` or template literal is far more likely than a JSX
# prop to legitimately contain a spaced hyphen inside an identifier-adjacent
# string (a slug, a regex fragment, a compound token), and — / – are typographic
# punctuation that essentially never appears in that code, so the false
# positive risk is asymmetric between the two dash kinds here.
#
# KNOWN GAP, recorded rather than quietly dropped: an in-word hyphen such as the
# date mask placeholder "YYYY-MM-DD" at apps/mobile/src/app/profile/edit.tsx is
# NOT caught. It is on the founder decision list in VERIFICATION-WAVE-1 section
# 6 and is tracked in docs/DEBT.md. Widening to every hyphen today would fire on
# that undecided line and on compound words, and a check people learn to ignore
# protects nothing.
#
# KNOWN GAP, template literals: the pattern below only catches a template
# literal whose opening backtick, dash and closing backtick sit on the SAME
# line. A dash inside a multi-line template literal is not caught. Recorded
# here rather than silently accepted; widening further needs a multi-line-aware
# tool, not another grep -E line.
# --------------------------------------------------------------------------
COPY_PROPS='(title|label|placeholder|message|description|subtitle|heading|caption|cta|body|text|accessibilityLabel|accessibilityHint|alt|emptyText|errorText|helperText|confirmLabel|cancelLabel)'
offenders=$(command grep -rnE "$COPY_PROPS=\"[^\"]*(—|–| - )" $SHIP_DIRS \
              --include='*.ts' --include='*.tsx' 2>/dev/null || true)
offenders2=$(command grep -rnE "$COPY_PROPS: \"[^\"]*(—|–| - )" $SHIP_DIRS \
              --include='*.ts' --include='*.tsx' 2>/dev/null || true)
offenders3=$(command grep -rnE '>[A-Za-z0-9,\.\(\) ]*(—|–| - )[A-Za-z0-9,\.\(\) ]*<' $SHIP_DIRS \
              --include='*.tsx' 2>/dev/null || true)
offenders4=$(command grep -rnE '(export )?const [A-Za-z0-9_]+[^=]*=[ \t]*"[^"]*(—|–)[^"]*"' $SHIP_DIRS \
              --include='*.ts' --include='*.tsx' 2>/dev/null || true)
offenders5=$(command grep -rnE '`[^`]*(—|–)[^`]*`' $SHIP_DIRS \
              --include='*.ts' --include='*.tsx' 2>/dev/null || true)
offenders=$(printf '%s\n%s\n%s\n%s\n%s\n' "$offenders" "$offenders2" "$offenders3" "$offenders4" "$offenders5" \
            | sed '/^$/d' \
            | command grep -vE ':[0-9]+:[ \t]*(//|\*|/\*)' \
            | command grep -v 'invariant-allow: copy-dashes' | sort -u || true)
if [ -n "$offenders" ]; then
  fail copy-dashes "dash punctuation in user-visible copy" "$offenders
Use a comma or a period. See CLAUDE.md > House style."
else
  pass copy-dashes "no em-dash, en-dash or spaced hyphen in rendered copy"
fi

# --------------------------------------------------------------------------
# CHECK owner-scope
#
# CLAUDE.md > "Scope every query by owner. RLS is not scoping." Postgres
# permissive policies are OR-ed, so a table carrying BOTH an owner policy and a
# public policy hands other people's rows to an unscoped select. This has bitten
# the project three times.
#
# The table list is not guessed and not hand-maintained: it is the output of a
# pg_policy query against the live project, committed as
# docs/qa/verify/dual-policy-tables.txt with the query that produced it. The
# DB drift check below re-runs that query and fails if the tree's copy is stale,
# so a table that GAINS a public policy tomorrow cannot slip past.
#
# An unfiltered read is not always wrong: an admin console listing every venue,
# or a public browse surface, is the intended behaviour. Those need an explicit
# waiver comment, so the decision is made by a human at the call site and is
# greppable, rather than the check being widened until it catches nothing.
# --------------------------------------------------------------------------
TABLES_FILE=docs/qa/verify/dual-policy-tables.txt
if [ ! -f "$TABLES_FILE" ]; then
  fail owner-scope "the dual-policy table list is missing" "$TABLES_FILE not found.
Without it this check would scan nothing and report a green, which is the exact
failure shape this script exists to end."
else
  DUAL=$(command grep -vE '^([ \t]*#|[ \t]*$)' "$TABLES_FILE" | tr '\n' '|' | sed 's/|$//')
  # Gated on `.select(`, because the permissive-OR hazard is a READ hazard: an
  # unscoped select returns other people's rows. Inserts against these tables
  # are governed by their write policies and are a different question, and
  # reporting them here produced eight findings that were all writes.
  #
  # The anti-gate is the second lesson from the same run. `.insert(...)
  # .select(...)` is an insert with a RETURNING clause, not a read, and gating
  # on `.select(` alone still reported three of them
  # (use-coach.ts:842, use-coach.ts:965, hooks.ts:1489). Three false positives
  # survived the first fix, which is why every check here was run against the
  # real tree and not only against its planted violation.
  offenders=$(run_chain_scan "[.]from[(]\"($DUAL)\"" '[.]select[(]' \
                '[.](eq|in|or|match|filter|contains|overlaps)[(]' 0 owner-scope 12 \
                '[.](insert|update|upsert|delete)[(]')
  if [ -n "$offenders" ]; then
    fail owner-scope "unscoped read of a table with both an owner and a public policy" "$offenders
Add the ownership filter, or if the read is deliberately unscoped, put
  // invariant-allow: owner-scope <why>
on the line above. See CLAUDE.md > Scope every query by owner."
  else
    pass owner-scope "every dual-policy read is scoped or explicitly waived"
  fi
fi

# --------------------------------------------------------------------------
# CHECK no-fake-affiliate-tag
#
# ADR-014 Confirmation 10, docs/PLAN-SEARCH-LOCATION-AFFILIATE.md GEAR-22 and
# L0-T3. No affiliate programme is approved (retailer_programmes.
# affiliate_tag_template is null for every retailer), so ANY tag parameter
# written into a URL is fabricated: the seed catalogue shipped `tag=atlitos-21`
# on eight Amazon links that earn nothing and claim an account nobody holds.
# A programme's tag is applied at ingest from its template, never typed into a
# seed, a fixture or an evaluation file.
#
# Scope is where URLs are hand written: scripts/, supabase/seed/ and
# docs/search-eval/. This file is excluded because it has to spell the pattern.
# Matches a `tag` or `aff` query parameter, any parameter whose value is
# `atlitos`, and the literal account id. A bare word like "tagline" or
# "affiliate_tag_template" does not match.
#
# WIDENED while being born red (2026-09-26): the first pattern (tag= only)
# went green after the eight Amazon tags were removed while the same file
# still carried nine `?aff=atlitos` parameters on Tennis Hub, Decathlon and
# Cricket Store links. Same fabrication, different parameter name.
# --------------------------------------------------------------------------
TAG_DIRS="scripts supabase/seed docs/search-eval"
offenders=$(command grep -rnE '[?&](tag|aff)=|=atlitos|atlitos-21' $TAG_DIRS 2>/dev/null \
            | command grep -v '^scripts/security-invariants.sh:' \
            | command grep -v 'invariant-allow: no-fake-affiliate-tag' || true)
if [ -n "$offenders" ]; then
  fail no-fake-affiliate-tag "a hand written affiliate tag in a seed, script or eval file" "$offenders
No programme is approved, so this tag is fabricated. Store the plain retailer
URL; a real tag is applied from retailer_programmes.affiliate_tag_template at
ingest once a programme is approved. See ADR-014 GEAR-22."
else
  pass no-fake-affiliate-tag "no tag parameter or atlitos-21 in scripts, seeds or the eval set"
fi

# --------------------------------------------------------------------------
# CHECK db-dual-policy-drift  (SQL)
#
# Re-derives the dual-policy table set from pg_policy on the live project and
# compares it to the committed list. Read-only: one SELECT, nothing else.
# Production syzzfgaudpifwvbpycyi is read only by standing rule.
# --------------------------------------------------------------------------
DB_URL="${ATLITOS_DB_URL:-${SUPABASE_DB_URL:-}}"
DUAL_SQL="with sel as (
  select c.relname as tbl,
         pg_get_expr(pol.polqual, pol.polrelid) as qual,
         (select array_agg(r.rolname) from pg_roles r where r.oid = any(pol.polroles)) as roles
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and pol.polcmd in ('r','*') and pol.polpermissive
), app as (
  select * from sel where roles is null or roles && array['anon','authenticated','public']::name[]
)
select tbl from app group by tbl
having count(*) filter (where qual ilike '%auth.uid()%') > 0
   and count(*) filter (where qual is null or qual not ilike '%auth.uid()%') > 0
order by tbl;"

# --live-tables FILE takes a catalog dump this script did not fetch itself, for
# a runner that reaches the project over the management API rather than over
# 5432. It is not a bypass: the comparison is identical either way, the source
# is printed in the result line, and supplying a WRONG file makes the check red,
# not green. It is also what made the comparison branch itself testable without
# production credentials.
live=""
live_source=""
DB_REPORTED=0
if [ -n "$LIVE_TABLES_FILE" ]; then
  if [ ! -f "$LIVE_TABLES_FILE" ]; then
    fail db-dual-policy-drift "the supplied live table list does not exist" "$LIVE_TABLES_FILE not found."
    DB_REPORTED=1
  else
    live=$(command grep -vE '^([ \t]*#|[ \t]*$)' "$LIVE_TABLES_FILE")
    live_source="$LIVE_TABLES_FILE"
  fi
elif [ -n "$DB_URL" ] && command -v psql >/dev/null 2>&1; then
  if live=$(psql "$DB_URL" -At -c "$DUAL_SQL" 2>"$TMP/psql.err"); then
    live_source="psql $(printf '%s' "$DB_URL" | sed 's|://[^@]*@|://***@|')"
  else
    fail db-dual-policy-drift "could not query the live catalog" "$(cat "$TMP/psql.err")"
    DB_REPORTED=1
  fi
fi

if [ -n "$live_source" ]; then
  committed=$(command grep -vE '^([ \t]*#|[ \t]*$)' "$TABLES_FILE" | sort)
  printf '%s\n' "$committed" > "$TMP/committed.txt"
  printf '%s\n' "$live" | sort > "$TMP/live.txt"
  diffout=$(diff "$TMP/committed.txt" "$TMP/live.txt" || true)
  if [ -n "$diffout" ]; then
    fail db-dual-policy-drift "the committed dual-policy table list is stale" "$diffout
Left is $TABLES_FILE, right is $live_source.
Update the file, then re-check every call site for the tables that appeared."
  else
    pass db-dual-policy-drift "committed list matches $live_source"
  fi
elif [ "$DB_REPORTED" = 1 ]; then
  : # already reported as a failure above, do not double count
elif [ "$OFFLINE" = 1 ]; then
  echo "NOT RUN  db-dual-policy-drift"
  echo "         No ATLITOS_DB_URL/SUPABASE_DB_URL or no psql, and --offline was passed."
  echo "         The static owner-scope check above ran against the COMMITTED table"
  echo "         list, so a table that gained a public policy since that list was"
  echo "         written is NOT covered by this run. Recorded in docs/DEBT.md."
  echo
else
  fail db-dual-policy-drift "the drift check could not run" "No ATLITOS_DB_URL or SUPABASE_DB_URL is set, or psql is not on PATH.
A check that should apply but cannot run is a failure, not a skip.
Set the connection string, or pass --offline and accept the recorded gap."
fi

# --------------------------------------------------------------------------
# CHECK suspend-enforcement  (SQL)
#
# 0096 GENERATES its restrictive suspension policies by looping over whatever
# permissive authenticated write policies exist at the moment it runs, so the
# guard set is a function of migration ORDER rather than of the schema. A table
# whose write policies land after 0096 gets no guard, and the failure mode is an
# ABSENT policy, which every check that inspects what IS there will pass.
#
# That already happened. Measured 2026-08-14: production had 0 unguarded tables
# and a database built from these files had 1 (blocked_users, INSERT and
# DELETE), because production applied 0097 BEFORE 0096 while file order is the
# reverse. 0115 reconciles the past; this check is what stops the next one.
#
# Read-only: one SELECT. Uses the same connection as the drift check above.
# --------------------------------------------------------------------------
SUSPEND_SQL="with writable as (
  select tablename,
         bool_or(cmd in ('INSERT','ALL')) as has_insert,
         bool_or(cmd in ('UPDATE','ALL')) as has_update,
         bool_or(cmd in ('DELETE','ALL')) as has_delete
  from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE'
    and 'authenticated' = any (roles::text[])
    and cmd in ('INSERT','UPDATE','DELETE','ALL')
  group by tablename
)
select w.tablename || ' missing:' ||
  case when w.has_insert and not exists (select 1 from pg_policies p where p.schemaname='public'
        and p.tablename=w.tablename and p.policyname=w.tablename||'_active_insert') then ' INSERT' else '' end ||
  case when w.has_update and not exists (select 1 from pg_policies p where p.schemaname='public'
        and p.tablename=w.tablename and p.policyname=w.tablename||'_active_update') then ' UPDATE' else '' end ||
  case when w.has_delete and not exists (select 1 from pg_policies p where p.schemaname='public'
        and p.tablename=w.tablename and p.policyname=w.tablename||'_active_delete') then ' DELETE' else '' end
from writable w
where (w.has_insert and not exists (select 1 from pg_policies p where p.schemaname='public'
        and p.tablename=w.tablename and p.policyname=w.tablename||'_active_insert'))
   or (w.has_update and not exists (select 1 from pg_policies p where p.schemaname='public'
        and p.tablename=w.tablename and p.policyname=w.tablename||'_active_update'))
   or (w.has_delete and not exists (select 1 from pg_policies p where p.schemaname='public'
        and p.tablename=w.tablename and p.policyname=w.tablename||'_active_delete'))
order by 1;"

if [ -n "$DB_URL" ] && command -v psql >/dev/null 2>&1; then
  if unguarded=$(psql "$DB_URL" -At -c "$SUSPEND_SQL" 2>"$TMP/suspend.err"); then
    if [ -n "$unguarded" ]; then
      fail suspend-enforcement "writable table(s) have no is_actor_active() guard" "$unguarded

A suspended user can still write to the table(s) above. 0096 generates these
guards by scanning the catalog at apply time, so a table added after it is
silently uncovered. Run supabase/migrations/0115_suspend_enforcement_reconcile.sql,
or add the guard alongside the new table's write policy."
    else
      pass suspend-enforcement "every writable table carries its is_actor_active() companion"
    fi
  else
    fail suspend-enforcement "could not query the live catalog" "$(cat "$TMP/suspend.err")"
  fi
elif [ "$OFFLINE" = 1 ]; then
  echo "NOT RUN  suspend-enforcement"
  echo "         No ATLITOS_DB_URL/SUPABASE_DB_URL or no psql, and --offline was passed."
  echo "         This check has no static equivalent: it compares what policies"
  echo "         EXIST against what should exist, and an absent policy leaves no"
  echo "         trace in the tree to grep for. Recorded in docs/DEBT.md."
  echo
else
  fail suspend-enforcement "the suspend enforcement check could not run" "No ATLITOS_DB_URL or SUPABASE_DB_URL is set, or psql is not on PATH.
A check that should apply but cannot run is a failure, not a skip.
Set the connection string, or pass --offline and accept the recorded gap."
fi

# --------------------------------------------------------------------------
# CHECK embedding-column-grant  (SQL)
#
# ADR-011 D6 / AC-11-6, AC-11-7: `affiliate_products.embedding` is excluded
# from every client select via a column-level grant, not a table-level one
# and not a separate view. Column-level grants are easy to widen back
# accidentally (a future `grant select on affiliate_products to anon`
# re-adds every column, embedding included), which is exactly why this is a
# standing CI invariant and not a one-time proof (ADR-011, Consequences).
#
# Read-only: one SELECT against information_schema.column_privileges. Uses
# the same connection as the checks above.
# --------------------------------------------------------------------------
EMBEDDING_GRANT_SQL="select grantee || ' has ' || privilege_type || ' on affiliate_products.embedding'
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'affiliate_products'
  and column_name = 'embedding'
  and grantee in ('anon', 'authenticated')
order by 1;"

if [ -n "$DB_URL" ] && command -v psql >/dev/null 2>&1; then
  if leaked=$(psql "$DB_URL" -At -c "$EMBEDDING_GRANT_SQL" 2>"$TMP/embgrant.err"); then
    if [ -n "$leaked" ]; then
      fail embedding-column-grant "anon or authenticated can select affiliate_products.embedding" "$leaked

Embedding writes happen only through gear-embed under the service role, and
the column must never be readable by a client (AC-11-7). Narrow the grant:
  revoke select on public.affiliate_products from anon, authenticated;
  grant select (<every column except embedding>) on public.affiliate_products
    to anon, authenticated;
See ADR-011 D6, supabase/migrations/*_gear_search_vectors.sql."
    else
      pass embedding-column-grant "anon and authenticated cannot select affiliate_products.embedding"
    fi
  else
    fail embedding-column-grant "could not query the live catalog" "$(cat "$TMP/embgrant.err")"
  fi
elif [ "$OFFLINE" = 1 ]; then
  echo "NOT RUN  embedding-column-grant"
  echo "         No ATLITOS_DB_URL/SUPABASE_DB_URL or no psql, and --offline was passed."
  echo "         This check has no static equivalent: a column grant leaves no trace"
  echo "         in the tree to grep for. Recorded in docs/DEBT.md."
  echo
else
  fail embedding-column-grant "the embedding column grant check could not run" "No ATLITOS_DB_URL or SUPABASE_DB_URL is set, or psql is not on PATH.
A check that should apply but cannot run is a failure, not a skip.
Set the connection string, or pass --offline and accept the recorded gap."
fi

# --------------------------------------------------------------------------
# CHECK auto-delist-actor-null  (SQL)
#
# ADR-011 D4 / D6, PRD-07 FR-51, AC-11-4: system_auto_delist_affiliate_product
# is the ONE place that ever writes an audit_log row whose action starts with
# `affiliate_product.auto`, and it always hard-codes actor_id null (a
# service-role sweep decision, never a human's). If a future change ever
# threads a caller's auth.uid() into that path (or a new "auto" action
# forgets to), an admin's account would look, in the audit trail, like it
# personally delisted a product it never touched. This has no static
# equivalent: the bug is in what a function DOES at call time, not a token
# grep can find, so it is a standing live-catalog check the same shape as
# suspend-enforcement and embedding-column-grant above.
# --------------------------------------------------------------------------
AUTO_DELIST_ACTOR_SQL="select id || ' has actor_id ' || actor_id::text || ' on action ' || action
from public.audit_log
where action like 'affiliate_product.auto%' and actor_id is not null
order by 1;"

if [ -n "$DB_URL" ] && command -v psql >/dev/null 2>&1; then
  if leaked=$(psql "$DB_URL" -At -c "$AUTO_DELIST_ACTOR_SQL" 2>"$TMP/autodelist.err"); then
    if [ -n "$leaked" ]; then
      fail auto-delist-actor-null "an affiliate_product.auto* audit_log row has a non-null actor_id" "$leaked

system_auto_delist_affiliate_product (supabase/migrations/*_gear_ingest_health.sql)
is the only writer of this action prefix and always inserts actor_id = null
(no human decided this, the 7-strike counter did). A non-null actor_id here
means either a hand-written audit_log row or a code path that threaded
auth.uid() into what must stay a system decision. See ADR-011 D4, AC-11-4."
    else
      pass auto-delist-actor-null "every affiliate_product.auto* audit_log row has actor_id is null"
    fi
  else
    fail auto-delist-actor-null "could not query the live catalog" "$(cat "$TMP/autodelist.err")"
  fi
elif [ "$OFFLINE" = 1 ]; then
  echo "NOT RUN  auto-delist-actor-null"
  echo "         No ATLITOS_DB_URL/SUPABASE_DB_URL or no psql, and --offline was passed."
  echo "         This check has no static equivalent: it reads audit_log rows a live"
  echo "         catalog produced, which leaves no trace in the tree to grep for."
  echo "         Recorded in docs/DEBT.md."
  echo
else
  fail auto-delist-actor-null "the auto-delist actor check could not run" "No ATLITOS_DB_URL or SUPABASE_DB_URL is set, or psql is not on PATH.
A check that should apply but cannot run is a failure, not a skip.
Set the connection string, or pass --offline and accept the recorded gap."
fi

# --------------------------------------------------------------------------
# CHECK search-log-no-user  (SQL)
#
# ADR-014 D4 and Confirmation 10: search_query_log keeps raw query text for 30
# days and must never be joinable to a person. "No user column" is a property
# of the SCHEMA, so it is checked in the catalog, not by reading the migration:
# a later ALTER that adds one would pass every review of the original file.
# Any column whose name carries "user" counts, not only user_id.
#
# The table is created in Phase L1. Until then the query runs and finds no
# such table, which holds the invariant trivially; the result line says so
# rather than reporting it as a skip or as proof.
# --------------------------------------------------------------------------
SEARCH_LOG_SQL="select coalesce((select string_agg(table_schema || '.' || table_name || '.' || column_name, ', ' order by column_name)
  from information_schema.columns
  where table_name = 'search_query_log' and column_name ilike '%user%'), '')
  || '|' || (select count(*) from information_schema.tables where table_name = 'search_query_log');"

if [ -n "$DB_URL" ] && command -v psql >/dev/null 2>&1; then
  if out=$(psql "$DB_URL" -At -c "$SEARCH_LOG_SQL" 2>"$TMP/searchlog.err"); then
    cols=${out%|*}
    exists=${out##*|}
    if [ -n "$cols" ]; then
      fail search-log-no-user "search_query_log carries a user column" "$cols

The query log is stored with no user id by design (ADR-014 D4): the eval set
needs queries, not people. Drop the column; aggregate through
admin_search_query_stats, never through a join to a person."
    elif [ "$exists" = 0 ]; then
      pass search-log-no-user "search_query_log does not exist yet (Phase L1), so it has no user column"
    else
      pass search-log-no-user "search_query_log has no column naming a user"
    fi
  else
    fail search-log-no-user "could not query the live catalog" "$(cat "$TMP/searchlog.err")"
  fi
elif [ "$OFFLINE" = 1 ]; then
  echo "NOT RUN  search-log-no-user"
  echo "         No ATLITOS_DB_URL/SUPABASE_DB_URL or no psql, and --offline was passed."
  echo "         A column added by a later ALTER leaves no trace a grep of one"
  echo "         migration would see. Recorded in docs/DEBT.md."
  echo
else
  fail search-log-no-user "the search log user column check could not run" "No ATLITOS_DB_URL or SUPABASE_DB_URL is set, or psql is not on PATH.
A check that should apply but cannot run is a failure, not a skip.
Set the connection string, or pass --offline and accept the recorded gap."
fi

# --------------------------------------------------------------------------
# CHECK clicks-zero-policy  (SQL)
#
# ADR-014 D5 and Confirmation 10; 0133. affiliate_clicks (and, from Phase L2,
# venue_booking_clicks) hold who tapped what. They are written only by a
# SECURITY DEFINER function and read only through admin aggregates, so the
# tables carry RLS ON with ZERO policies. A single policy, even an admin one,
# opens raw rows to a role the aggregate was built to keep them from; RLS
# turned off with zero policies opens them to every grant. Both are failures.
# A table that does not exist yet is named in the result line, not hidden.
# --------------------------------------------------------------------------
CLICKS_SQL="select string_agg(line, E'\n' order by line) from (
  select c.relname || ': policy ' || pol.polname as line
  from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('affiliate_clicks', 'venue_booking_clicks')
  union all
  select c.relname || ': row level security is OFF'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('affiliate_clicks', 'venue_booking_clicks') and not c.relrowsecurity
) x;"
CLICKS_PRESENT_SQL="select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('affiliate_clicks', 'venue_booking_clicks');"

if [ -n "$DB_URL" ] && command -v psql >/dev/null 2>&1; then
  if bad=$(psql "$DB_URL" -At -c "$CLICKS_SQL" 2>"$TMP/clicks.err") && present=$(psql "$DB_URL" -At -c "$CLICKS_PRESENT_SQL" 2>>"$TMP/clicks.err"); then
    if [ -n "$bad" ]; then
      fail clicks-zero-policy "a click table has a policy or has RLS off" "$bad

Click rows are written by record_affiliate_click / record_venue_booking_click
(SECURITY DEFINER) and read only through admin_*_click_stats. Drop the policy
and keep RLS on. See 0133 and ADR-014 D5."
    elif [ -z "$present" ]; then
      fail clicks-zero-policy "neither click table exists" "affiliate_clicks (0133) should exist. A check that finds nothing to inspect is not a green."
    else
      pass clicks-zero-policy "RLS on and zero policies on: $present"
    fi
  else
    fail clicks-zero-policy "could not query the live catalog" "$(cat "$TMP/clicks.err")"
  fi
elif [ "$OFFLINE" = 1 ]; then
  echo "NOT RUN  clicks-zero-policy"
  echo "         No ATLITOS_DB_URL/SUPABASE_DB_URL or no psql, and --offline was passed."
  echo "         A policy is catalog state with no static equivalent. Recorded in docs/DEBT.md."
  echo
else
  fail clicks-zero-policy "the click table policy check could not run" "No ATLITOS_DB_URL or SUPABASE_DB_URL is set, or psql is not on PATH.
A check that should apply but cannot run is a failure, not a skip.
Set the connection string, or pass --offline and accept the recorded gap."
fi

# --------------------------------------------------------------------------
echo "--------------------------------------------------------------"
if [ "$FAILED" -gt 0 ]; then
  echo "security-invariants: $FAILED of $CHECKS_RUN checks FAILED."
  exit 1
fi
echo "security-invariants: $CHECKS_RUN checks passed."
exit 0
