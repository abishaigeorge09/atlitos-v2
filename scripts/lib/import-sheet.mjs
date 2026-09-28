// ATLITOS v2 — scripts/lib/import-sheet.mjs
//
// The shared shell of every CSV importer (import-courts, import-equipment,
// import-coaches): argument parsing, a small RFC 4180 CSV reader, header
// checks, and the "validate the whole file, then write" discipline. Each
// importer keeps only its own columns, checks and upserts.
//
// Rules the importers share:
//   - nothing is written until every row validates; problems are printed with
//     the sheet line number and the run exits 1
//   - dry run by default, --apply writes
//   - production writes go through scripts/lib/guard-target.mjs

import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { assertWritableTarget } from './guard-target.mjs';

export const HTTP_URL = /^https?:\/\/\S+$/;
export const SPORTS = ['football', 'cricket', 'badminton', 'tennis'];

/** `--name value` from argv, or null. */
export function flag(name) {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}

export function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

/** Service role client for the resolved target. Refuses production without
 * the explicit override when `apply` is set. */
export function serviceClient(scriptName, apply) {
  const url = process.env.SUPABASE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error(`[${scriptName}] SUPABASE_SERVICE_ROLE_KEY is required. Run with: node --env-file=.env.local scripts/${scriptName}.mjs ...`);
    process.exit(1);
  }
  if (apply) assertWritableTarget(url, `${scriptName}.mjs`);
  return {
    url,
    supabase: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

/** RFC 4180 subset: quoted fields, doubled quotes inside quotes, CRLF or LF.
 * Blank lines are dropped. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * Reads a sheet into trimmed records keyed by lower cased header. Throws on a
 * missing required column or a column the template does not know, so a
 * renamed header can never silently drop a field. Each record carries
 * `_line`, the 1 based sheet line, for error messages.
 */
export function readSheet(path, required, optional, templatePath) {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const [header, ...lines] = parseCsv(text);
  if (!header) throw new Error('the file is empty');
  const columns = header.map((h) => h.trim().toLowerCase());
  const missing = required.filter((c) => !columns.includes(c));
  if (missing.length > 0) throw new Error(`missing column(s): ${missing.join(', ')}`);
  const unknown = columns.filter((c) => !required.includes(c) && !optional.includes(c));
  if (unknown.length > 0) throw new Error(`unknown column(s): ${unknown.join(', ')}. Use the template in ${templatePath}`);

  return lines.map((cells, index) => {
    const record = {};
    columns.forEach((col, i) => {
      record[col] = (cells[i] ?? '').trim();
    });
    record._line = index + 2;
    return record;
  });
}

/** Loads and validates a sheet or exits 1 with every problem listed. `check`
 * receives one record and a `bad(reason)` reporter. */
export function loadSheet(scriptName, path, required, optional, templatePath, check) {
  let records;
  try {
    records = readSheet(path, required, optional, templatePath);
  } catch (err) {
    console.error(`[${scriptName}] ${path}: ${err.message}`);
    process.exit(1);
  }
  if (records.length === 0) {
    console.error(`[${scriptName}] no data rows found under the header`);
    process.exit(1);
  }

  const problems = [];
  for (const r of records) {
    const bad = (why) => problems.push(`line ${r._line}: ${why}`);
    for (const col of required) {
      if (!r[col]) bad(`${col} is empty`);
    }
    check(r, bad);
  }
  if (problems.length > 0) {
    console.error(`[${scriptName}] ${problems.length} problem(s), nothing written:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  return records;
}

/** Case insensitive grouping: rows that share `keyOf(record)` become one
 * parent (built from the first row) with `children` collected from every row. */
export function groupBy(records, keyOf, parentOf, childOf) {
  const groups = new Map();
  for (const r of records) {
    const key = keyOf(r).toLowerCase();
    if (!groups.has(key)) groups.set(key, { ...parentOf(r), children: [] });
    groups.get(key).children.push(childOf(r));
  }
  return [...groups.values()];
}

/** Resolves an auth account id from an email (paged listUsers) or passes a
 * uuid straight through. */
export async function resolveUserId(supabase, value) {
  if (!value.includes('@')) return value;
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`could not list users: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === value.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
    page += 1;
  }
}
