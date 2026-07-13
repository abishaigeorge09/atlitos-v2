import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import atlitos from "@atlitos/config/eslint";

const compat = new FlatCompat({
  baseDirectory: fileURLToPath(new URL(".", import.meta.url)),
});

const eslintConfig = defineConfig([
  // Next's flat config already registers its own "@typescript-eslint"
  // plugin instance, so compose only the rule-only house style objects
  // here (see packages/config/eslint.config.js), not the full atlitos base.
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  ...atlitos.houseRules,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
