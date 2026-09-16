// Ambient declaration for `require()`ing font files directly (src/app/_layout.tsx
// loads Inter/JetBrains Mono TTFs from local assets/fonts/ rather than through
// @expo-google-fonts/* package exports, see the comment on that useFonts call
// for why). Metro resolves these requires to an asset module id (a number) at
// runtime; TypeScript just needs to know the module shape exists.
declare module '*.ttf' {
  const assetId: number;
  export default assetId;
}

// Ambient declaration for importing image assets directly, e.g. the splash
// mark in src/app/(auth)/splash.tsx. A static import is used rather than
// `require()` so the file needs no `no-require-imports` exception: that rule
// is deliberately switched off for _layout.tsx alone, and widening it for an
// image would erode a scoped exception for no reason. Metro resolves these to
// an asset module id (a number) at runtime.
declare module '*.png' {
  const assetId: number;
  export default assetId;
}
