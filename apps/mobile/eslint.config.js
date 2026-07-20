const atlitos = require('@atlitos/config/eslint');

module.exports = [
  {
    // Native build artifacts. `ios/Pods` holds vendored CocoaPods sources
    // (including minified JS shipped inside RazorpayStandard.xcframework)
    // that are not ours to lint. These directories only appeared once the
    // native dev build was generated for the P3 simulator evidence.
    ignores: ['ios/**', 'android/**'],
  },
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
