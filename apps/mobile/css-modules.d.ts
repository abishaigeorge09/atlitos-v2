// Ambient declaration for side-effect CSS imports (global.css, the nativewind
// entry). nativewind/types already declares this, but TypeScript 6.0.3 (the
// version apps/mobile currently pins, the AT-150 TS version skew) does not
// pick up that package's declaration through the triple-slash reference in
// nativewind-env.d.ts, so `import '../../global.css'` in src/app/_layout.tsx
// reports TS2882. This explicit ambient module restores resolution under both
// TS 5.9.3 (repo root) and 6.0.3 (this app), independent of nativewind, and
// merges harmlessly with nativewind's own declaration. Remove once AT-150
// realigns the compiler version.
declare module '*.css';
