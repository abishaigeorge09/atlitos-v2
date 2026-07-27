// Ambient declaration for `require()`ing font files directly (src/app/_layout.tsx
// loads Inter/JetBrains Mono TTFs from local assets/fonts/ rather than through
// @expo-google-fonts/* package exports, see the comment on that useFonts call
// for why). Metro resolves these requires to an asset module id (a number) at
// runtime; TypeScript just needs to know the module shape exists.
declare module '*.ttf' {
  const assetId: number;
  export default assetId;
}
