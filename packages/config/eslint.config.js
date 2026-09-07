// @atlitos/config eslint flat config, the shared ESLint base for every
// Atlitos app/package. Composed, not copied: an app's own eslint.config.js
// does:
//
//   const atlitos = require("@atlitos/config/eslint");
//   module.exports = [...atlitos, /* app-specific overrides */];
//
// House rules enforced here (see docs/design/DESIGN-LANGUAGE.md, "Voice and
// copy rules" + "Principles" #1 token discipline):
//   1. No raw hex color literals outside packages/theme, every color is a
//      token read from @atlitos/theme, never a literal.
//   2. No emoji codepoints in string literals, anywhere, no exceptions.

const fs = require("node:fs");
const path = require("node:path");
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const reactHooks = require("eslint-plugin-react-hooks");

/**
 * Every app/package script runs `eslint .` with its own package directory as
 * cwd (see each package.json's "lint" script), so a single eslint.config.js
 * invocation only ever sees files under one package at a time. That means
 * file/ignore glob patterns can't encode a repo-relative path like
 * "packages/theme/**" (there is no "packages/theme/" prefix left once cwd is
 * already packages/theme), they have to key off which package is currently
 * running. Read the nearest package.json's "name" instead.
 */
function currentPackageName() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    return typeof pkg.name === "string" ? pkg.name : "";
  } catch {
    return "";
  }
}

const isThemePackage = currentPackageName() === "@atlitos/theme";

/** Matches "#fff", "#ffff" (rgba short), "#ffffff", "#ffffffff" hex literals. */
const HEX_COLOR_SELECTOR = "Literal[value=/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]";

/**
 * Coarse emoji / pictograph codepoint ranges: emoticons, misc symbols &
 * pictographs, transport & map symbols, dingbats, supplemental symbols &
 * pictographs, regional indicator letters (flag emoji), and the common
 * arrow/misc-symbol block emoji borrow glyphs from.
 *
 * RULE NOTE: this is a regex backstop, not a guarantee. Unicode adds new
 * emoji codepoints every release, and ZWJ sequences combine multiple
 * codepoints into one visual glyph, so a regex test over a single Literal's
 * codepoints will not catch every future emoji or every combined sequence.
 * Treat this rule as a fast net that catches the overwhelming majority of
 * accidental emoji use in string literals, and treat code review as the
 * actual backstop for anything novel enough to slip through. If you add a
 * codepoint range here, add it to this comment too.
 */
const EMOJI_SELECTOR =
  "Literal[value=/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{1F1E6}-\\u{1F1FF}\\u{2190}-\\u{21FF}]/u]";

const HEX_MESSAGE = "No raw hex color literals outside packages/theme. Import the token from @atlitos/theme instead.";
const EMOJI_MESSAGE = "No emoji codepoints in string literals. House rule: no emojis anywhere, use a lucide icon instead.";

const noHexNoEmoji = {
  "no-restricted-syntax": [
    "error",
    { selector: HEX_COLOR_SELECTOR, message: HEX_MESSAGE },
    { selector: EMOJI_SELECTOR, message: EMOJI_MESSAGE },
  ],
};

const noEmojiOnly = {
  "no-restricted-syntax": ["error", { selector: EMOJI_SELECTOR, message: EMOJI_MESSAGE }],
};

/**
 * Rule only config objects, no plugin/parser registration. Use this instead
 * of the default export when composing into a host that already registers
 * its own "@typescript-eslint" plugin instance (eslint-config-next does),
 * since two different plugin instances under the same name is a flat config
 * error ("Cannot redefine plugin"). Next.js apps: spread `atlitos.houseRules`
 * alongside `compat.extends("next/core-web-vitals", "next/typescript")`
 * instead of spreading the full default export.
 */
/**
 * React hooks rules. Registered here rather than per app because every React
 * surface in the monorepo (mobile, portals, admin, landing) has the same
 * hazard: a dependency array that lies produces a stale closure, and the one
 * that bit us (BUG-001, an unstable hook return re-triggering its own
 * debounce forever) was invisible while this plugin was absent.
 *
 * It was absent for a long time. Source files carried
 * `eslint-disable-next-line react-hooks/exhaustive-deps` directives for a rule
 * nothing registered, which ESLint 9 reports as "Definition for rule was not
 * found" — so `pnpm lint` was red AND no dependency array was ever checked.
 * Registering it fixes both halves.
 *
 * exhaustive-deps is a warning, matching the React team's own default: it has
 * real false positives around refs and intentionally-once effects, and an
 * error would push authors back to blanket disable comments, which is the
 * state this replaced. rules-of-hooks stays an error because it has none.
 */
const reactHookRules = [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

const houseRules = [
  // packages/theme is the one place hex literals are the point, it IS the
  // token source. Emoji stay banned everywhere, no exceptions. Everywhere
  // else: no hex literals, no emoji. Keyed off the running package's own
  // name (see currentPackageName above), not a repo-relative path, since
  // every package lints with itself as cwd.
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: isThemePackage ? noEmojiOnly : noHexNoEmoji,
  },
  // eslint.config.js itself: every package's config composes this file via
  // `require()`, which is CommonJS syntax the rest of this config's rules
  // (written for app/library source, not tooling config) would otherwise
  // flag, and the lint environment has no Node globals registered by
  // default so `require`/`module` read as undefined.
  {
    files: ["eslint.config.{js,cjs,mjs}"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        __dirname: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Placeholder function params/vars prefixed with "_" are intentionally
    // unused (P0 shells stub out signatures future phases fill in, see
    // packages/api/src/hooks.ts). This is the standard TS convention for
    // "intentionally unused", not a strictness weakening.
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

module.exports = tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.expo/**", "**/build/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...reactHookRules,
  ...houseRules,
);

module.exports.houseRules = houseRules;
module.exports.reactHookRules = reactHookRules;
