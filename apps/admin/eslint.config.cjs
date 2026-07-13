// @atlitos/admin eslint config, composed from the shared @atlitos/config base.
// See docs/design/DESIGN-LANGUAGE.md and CLAUDE.md for the house rules this
// enforces (no raw hex outside packages/theme, no emoji in string literals).
const atlitos = require("@atlitos/config/eslint");

module.exports = [
  ...atlitos,
  {
    // This file itself: CommonJS config, exempt from the app's ESM/TS rules.
    files: ["eslint.config.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
