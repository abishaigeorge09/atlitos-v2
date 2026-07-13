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

const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

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

module.exports = tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.expo/**", "**/build/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everywhere except packages/theme: no hex literals, no emoji.
    files: ["**/*.{js,jsx,ts,tsx}"],
    ignores: ["packages/theme/**"],
    rules: noHexNoEmoji,
  },
  {
    // packages/theme is the one place hex literals are the point, it IS the
    // token source. Emoji stay banned everywhere, no exceptions.
    files: ["packages/theme/**/*.{js,jsx,ts,tsx}"],
    rules: noEmojiOnly,
  },
);
