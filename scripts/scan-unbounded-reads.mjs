#!/usr/bin/env node
/**
 * Enumerate every PostgREST read chain in packages/api/src and classify it as
 * bounded or unbounded.
 *
 * Why this exists: PostgREST applies a silent server side row cap to every
 * select (verified: 0 of 751 pgrst statements carry LIMIT ALL, 670 carry a
 * parameterised LIMIT). An unbounded read is therefore not slow, it is
 * truncated with a 200 OK and no error. See docs/qa/verify/SCALE-CLIENT.md
 * and docs/qa/verify/SCALE-DATABASE.md.
 *
 * A chain counts as BOUNDED when it carries any of: .limit(, .range(,
 * .single(, .maybeSingle(, or .eq/.in on a primary key that makes the result
 * cardinality one. Only the first three are detected mechanically; the rest
 * are classified by hand in the lane docs.
 *
 * Usage: node scripts/scan-unbounded-reads.mjs [--json]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "packages/api/src";
const WRITE_OPS = ["insert(", "update(", "upsert(", "delete("];
/** A bounding call, allowing for an explicit generic type argument between the
 * method name and its parens (`.maybeSingle<CourtQueryRow>()`). Matching the
 * bare string "maybeSingle(" misses every one of those and reports a
 * single-row read as unbounded, which is the false positive that makes a
 * checker get ignored. */
const BOUND_RE = /\.(limit|range|single|maybeSingle)\s*(<[^;]*?>)?\s*\(/;

const results = [];

for (const file of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
  const path = join(SRC, file);
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const idx = lines[i].indexOf(".from(");
    if (idx === -1) continue;

    // Walk forward until the statement terminates. A chain ends at the first
    // line whose trimmed text does not begin with a chained call or an
    // argument continuation. Cap at 30 lines so a malformed parse cannot run
    // away.
    let chain = lines[i].slice(idx);
    let end = i;
    for (let j = i + 1; j < Math.min(i + 30, lines.length); j += 1) {
      const t = lines[j].trim();
      // An unterminated template literal means we are still inside a
      // multi-line `.select(\`...\`)`, whose continuation lines are bare column
      // names. Breaking there truncated the chain before its `.limit()` and
      // reported bounded reads as unbounded.
      const insideTemplate = (chain.match(/`/g) ?? []).length % 2 === 1;
      if (insideTemplate) {
        chain += "\n" + lines[j];
        end = j;
        continue;
      }
      if (t === "") break;
      const continues =
        // A comment INSIDE a chain must not terminate the walk. Missing this
        // reported `.limit()`-carrying chains as unbounded purely because the
        // limit sat below an explanatory comment, which is the false positive
        // that teaches everyone to ignore the whole check.
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("/*") ||
        t.startsWith(".") ||
        t.startsWith(")") ||
        t.startsWith("`") ||
        t.startsWith('"') ||
        t.startsWith("'") ||
        /^[a-z_]+:/i.test(t) ||
        t.startsWith("{") ||
        t.startsWith("}");
      if (!continues) break;
      chain += "\n" + lines[j];
      end = j;
      if (/;\s*$/.test(t)) break;
    }

    const table = /\.from\(\s*["'`]([^"'`]+)["'`]/.exec(chain)?.[1] ?? "?";
    const isWrite = WRITE_OPS.some((op) => chain.includes("." + op));
    if (isWrite) continue;
    if (!chain.includes(".select(")) continue;

    const bound = BOUND_RE.exec(chain)?.[1] ?? null;
    const isCount = /count:\s*["']exact["']/.test(chain) && /head:\s*true/.test(chain);

    results.push({
      file,
      line: i + 1,
      endLine: end + 1,
      table,
      bounded: Boolean(bound) || isCount,
      how: isCount ? "head count" : bound,
    });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const unbounded = results.filter((r) => !r.bounded);
  for (const r of results) {
    console.log(
      `${r.bounded ? "BOUND  " : "UNBOUND"} ${r.file}:${r.line} ${r.table}` +
        (r.how ? `  [${r.how}]` : ""),
    );
  }
  console.log(
    `\ntotal reads ${results.length}, bounded ${results.length - unbounded.length}, unbounded ${unbounded.length}`,
  );
}
