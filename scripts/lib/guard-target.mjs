// ATLITOS v2 - scripts/lib/guard-target.mjs
//
// THE GENERATOR THAT POLLUTED PRODUCTION.
//
// Every one of the eight seed scripts resolves its target the same two ways,
// and both of them point at PRODUCTION when nothing is set:
//
//   seed-demo-users.mjs:31
//     const SUPABASE_URL = process.env.SUPABASE_URL
//       ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';   <- the default IS prod
//
//   seed-groups-demo.mjs:37
//     const SUPABASE_URL = mobileEnv.EXPO_PUBLIC_SUPABASE_URL;  <- also prod
//
// So `node scripts/seed-demo-users.mjs`, run with no environment at all, seeds
// production. That is how production ended up with fixture pollution across
// five tables: 16 of 22 clips, 6 of 10 venues, 38 orphaned chat_threads and 44
// leaked auth accounts. Cleaning that up without changing this is how the same
// mess ships again, which is exactly what task #39 says.
//
// Nothing here stops a deliberate production seed. It stops an ACCIDENTAL one,
// which is the only kind that has ever happened. The override is deliberately
// wordy so it cannot be typed by muscle memory or pasted from a shell history
// without noticing.

const PRODUCTION_REFS = ['syzzfgaudpifwvbpycyi'];
const OVERRIDE_ENV = 'ATLITOS_ALLOW_PRODUCTION_WRITE';
const OVERRIDE_VALUE = 'yes-i-mean-production';

/**
 * Refuse to run a WRITING script against production unless explicitly allowed.
 * Call this immediately after the target URL is resolved, before any client is
 * constructed, so a script cannot get as far as holding a production handle.
 *
 * @param {string} url        the resolved Supabase URL the script will write to
 * @param {string} scriptName for the message, usually basename(import.meta.url)
 */
export function assertWritableTarget(url, scriptName = 'this script') {
  if (!url) {
    console.error(
      `\n${scriptName}: no Supabase URL resolved. Set SUPABASE_URL, or start the local stack with \`supabase start\` and use http://127.0.0.1:54321.\n`,
    );
    process.exit(1);
  }

  const isProduction = PRODUCTION_REFS.some((ref) => url.includes(ref));
  if (!isProduction) return;

  if (process.env[OVERRIDE_ENV] === OVERRIDE_VALUE) {
    console.warn(
      `\n${scriptName}: WRITING TO PRODUCTION (${url}). ${OVERRIDE_ENV} is set, so this is deliberate. Every row you create here is real.\n`,
    );
    return;
  }

  console.error(
    [
      '',
      `REFUSED: ${scriptName} would write to PRODUCTION.`,
      '',
      `  target: ${url}`,
      '',
      'Production carries real users and real money. Fixture data written here is',
      'what put e2e rows into five production tables, and it cannot be told apart',
      'from real data afterwards.',
      '',
      'Run it against the local stack instead:',
      '',
      '  supabase start',
      '  SUPABASE_URL=http://127.0.0.1:54321 \\',
      '  SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2-) \\',
      `  node ${scriptName}`,
      '',
      'If you genuinely mean production, say so out loud:',
      '',
      `  ${OVERRIDE_ENV}=${OVERRIDE_VALUE} node ${scriptName}`,
      '',
    ].join('\n'),
  );
  process.exit(1);
}
