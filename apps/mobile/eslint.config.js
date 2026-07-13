const atlitos = require('@atlitos/config/eslint');

module.exports = [
  ...atlitos,
  {
    // CommonJS tooling config files (metro.config.js, this file) run under
    // Node, not the RN/browser runtime the rest of the app targets.
    files: ['*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
