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
    // Static asset references. Metro resolves `require('../assets/x.ttf')` into
    // the numeric asset handle `useFonts` and `<Image source>` expect; an ESM
    // `import` of a .ttf does not produce one. This is the framework's own
    // documented pattern, not a lapse, so it is allowed only for these files
    // rather than switching the rule off repo-wide.
    files: ['src/app/_layout.tsx'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
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
