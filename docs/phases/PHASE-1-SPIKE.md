# Phase 1 spike: nativewind + react-native-reusables on Expo SDK 57 / RN 0.86

Status: RESOLVED, WORKS. This is the pattern component builders follow for the rest of Phase 1 mobile work. Epic AT-2.

Last updated: 2026-07-13.

## Verdict

nativewind 4.2.6 and a hand-adapted react-native-reusables (RNR) Button/Card compile, typecheck, and export cleanly on Expo SDK 57.0.4 / React Native 0.86.0 in this pnpm workspace. Both verification gates are green:

- `pnpm --filter @atlitos/mobile typecheck` (`tsc --noEmit`): clean.
- `pnpm turbo typecheck` at the repo root: 11/11 tasks green.
- `npx expo export --platform ios`: succeeds, produces a Hermes bundle (`dist/_expo/static/js/ios/*.hbc`, ~3.5MB).
- `npx eslint .` in `apps/mobile`: clean, including the repo's `no-hex` rule (`packages/config/eslint.config.js`), nothing in the new nativewind/RNR code introduces a raw hex literal.
- Extra sanity check beyond the task's bar: also ran `npx expo export --platform web` and grepped the compiled CSS. Confirmed the full token pipeline is real, not just "doesn't crash": `.bg-primary{background-color:var(--primary)}`, the ember accent hue `15 76% 55%` (from `packages/theme` colors.light.accent) appears in the generated `:root` vars, and `.rounded-sm{border-radius:8px}` matches the design language's locked CTA radius exactly.

No fallback needed. `src/theme/ThemeProvider.tsx` was NOT built, it is not needed, do not build it unless a future spike reverses this finding.

## What "fought" and how it was resolved

Two real integration snags, both resolved, documented so nobody rediscovers them from scratch:

1. **pnpm workspace module resolution**: `nativewind`'s runtime JSX import (`react-native-css-interop/jsx-runtime`) is a transitive dependency inside `nativewind`'s own pnpm store folder, not hoisted or symlinked into `apps/mobile/node_modules`. Metro's resolver (even with this repo's custom `nodeModulesPaths`/`disableHierarchicalLookup` monorepo config) could not find it, `expo export` failed with `Unable to resolve module react-native-css-interop/jsx-runtime`. Fix: add `react-native-css-interop@0.2.6` (pinned to the exact version nativewind 4.2.6 depends on) as an explicit direct dependency of `apps/mobile`, so pnpm creates the symlink. This is a one-time setup cost, already done, not something the component wave needs to repeat.
2. **Double CSS variable wrapping**: react-native-reusables' shadcn-style slot variables (`--primary`, `--background`, ...) are themselves defined as `hsl(var(--color-accent))`. `tailwind.config.js` must reference them with `var(--primary)`, not `hsl(var(--primary))` (that double-wraps into invalid CSS). Handled once in `scripts/gen-tokens.ts`, not something component authors touch.

## Token tracing decision: extend, don't replace

The task asked for "ALL color/spacing/radius values" to map to `@atlitos/theme`. Literally replacing Tailwind's entire default numeric spacing/radius scale would break every fractional micro-utility (`gap-1.5`, `px-2.5`) that vendored shadcn-style component internals use, with no equivalent named token (our spacing scale only has 10 named steps: none/xs/sm/md/lg/xl/2xl/3xl/4xl/5xl = 0/4/8/12/16/20/24/32/40/56). `apps/portal-court`'s already-shipped, already-approved gen-tokens.ts sets the actual precedent here: it does not force every internal shadcn utility through a named token either (its Button/Card use `px-2.5`, `gap-1.5`, `text-[0.8rem]`, Tailwind's own `--spacing()` scale for component-internal micro layout), it only strictly traces the brand-level tokens (colors, base radius unit, typography).

`apps/mobile/scripts/gen-tokens.ts` follows the same rule:

- **Colors**: every `@atlitos/theme` color (kebab-cased: `bg`, `text`, `accent`, `accent-tint`, `danger`, `success-tint`, ...) is a real Tailwind color utility (`bg-accent`, `text-danger`), plus the shadcn/RNR compatibility slot names (`background`, `foreground`, `primary`, `card`, `destructive`, ...) that vendored component source expects. Both point at the same generated CSS variables in `global.css`, light and dark, dark toggled by nativewind's `darkMode: "class"`.
- **Radii**: `theme.extend.borderRadius` is generated from `packages/theme/src/radii.ts` literal px values, using Tailwind's own key names (`xs/sm/md/lg/xl/2xl`) so `rounded-sm`/`rounded-xl`/... in vendored component source silently resolve to the correct Atlitos radius instead of Tailwind's stock 2/4/6/8/12/16px scale. `rounded-sm` = 8px (the design language's locked CTA button radius), `rounded-xl` = 20px (card radius). Verified in the compiled CSS.
- **Spacing**: `theme.extend.spacing` adds the 10 named `@atlitos/theme` keys (`p-lg`, `gap-2xl`, ...) alongside Tailwind's native numeric scale, does not remove it. Named keys trace to `packages/theme`; Tailwind's native scale (which is also 4px-based, so `p-4` and `p-lg` are both 16px) stays available for component-internal fine adjustment, same as portal-court.
- **Token gap found**: DESIGN-LANGUAGE.md locks the mobile primary button height at 48px, but 48 is not a `packages/theme` spacing value (the scale jumps 40 -> 56). `button.tsx` currently uses Tailwind's native `h-12` (48px) for this, which is numerically correct but not name-traceable to a token. If this bothers a future reviewer, the fix is a dedicated `packages/theme` dimension token (e.g. `sizing.buttonHeight` / `sizing.buttonHeightCompact` = 48/40), not a spacing-scale entry, since it is a component dimension, not a general layout gap. Flagging, not blocking, matches the portal precedent of allowing Tailwind's native scale for component internals.

## The pattern component builders must follow

### Where things live

- `apps/mobile/scripts/gen-tokens.ts`: generates `apps/mobile/global.css` and `apps/mobile/tailwind.config.js` from `@atlitos/theme`. Never hand edit either generated file, edit `packages/theme/src/*.ts` and run `pnpm --filter @atlitos/mobile gen-tokens` (also runs automatically before `expo export` via the `build` script).
- `apps/mobile/src/components/ui/`: className-based UI primitives (`text.tsx`, `button.tsx`, `card.tsx`), the react-native-reusables pattern. This is a SEPARATE, additive styling system from the existing `src/theme/text-style.ts` + `src/theme/use-theme-colors.ts` (StyleSheet + JS token objects). Both are valid and both trace to `packages/theme`, pick per component:
  - Plain screens, one-off layout, anything already using `textStyle()`/`useThemeColors()`: keep using that, it is simpler for non-variant UI.
  - Components with real shadcn/RNR equivalents (Button, Card, Input, Dialog, ...) that benefit from `cva` variants: use the className/nativewind pattern below. Do not mix the two inside a single component.
- `apps/mobile/src/lib/utils.ts`: the `cn()` helper (`clsx` + `tailwind-merge`), import this in every className-based component, never hand-roll className concatenation.

### Adding a new react-native-reusables component

1. Check the upstream source for reference only: `https://raw.githubusercontent.com/founded-labs/react-native-reusables/main/packages/registry/src/nativewind/components/ui/<name>.tsx`. Do not run the RNR CLI (`npx react-native-reusables add`), it scaffolds a fresh Expo template and shadcn-generic tokens, not this monorepo's pnpm workspace or `@atlitos/theme` tokens. Copy the source by hand into `apps/mobile/src/components/ui/<name>.tsx`.
2. Fix imports to this repo's paths: `@/components/ui/text`, `@/lib/utils`, matching `tsconfig.json`'s `"@/*": ["./src/*"]`.
3. Replace every un-namespaced or stock-shadcn color/radius class with an Atlitos one:
   - `rounded-md` -> check DESIGN-LANGUAGE.md's component tone section for the right radius (`rounded-sm` for CTA buttons, `rounded-lg`/`rounded-xl` for cards/sheets, `rounded-pill` for chips), never leave the RNR default unexamined.
   - `bg-white`, `text-black`, any bare Tailwind color name: replace with the matching `@atlitos/theme` slot or raw palette utility (`bg-card`, `text-text`, `bg-danger`, `text-primary-foreground`, ...). Full list is `theme.extend.colors` in the generated `tailwind.config.js`, or just read `packages/theme/src/colors.ts`, every key is kebab-cased into a utility of the same name.
   - Fine-grained internal spacing (`gap-1.5`, `px-2.5`) can stay on Tailwind's native numeric scale, that is accepted precedent (see above), do not invent arbitrary bracket values (`h-[47px]`) to force a token fit, if no token fits, use the nearest native Tailwind step and leave a comment.
4. Every `<Text>` used inside a className component must be this package's `@/components/ui/text` `Text` (propagates `TextClassContext`), not RN's bare `Text` and not the `textStyle()` variant text.
5. Wire the component into `nativewind-env.d.ts` requirements are already global (one file, already present), no per-component type setup needed.
6. Run `pnpm --filter @atlitos/mobile typecheck` and `pnpm --filter @atlitos/mobile lint` before moving on. `expo export --platform ios` is the full integration check, run it before closing out a component-heavy PR, not on every save.

### Dark mode

Handled automatically. `darkMode: "class"` in `tailwind.config.js` plus nativewind's built in `Appearance` listener flips the root `dark` class with the system color scheme, no manual wiring needed for the default "follow system" behavior. A manual light/dark override toggle (if a settings screen needs one) is a `nativewind` `colorScheme.set()` call, not built in this spike, first component that needs it should add it, small.

### Proof components delivered this spike

- `apps/mobile/src/components/ui/text.tsx`, `button.tsx`, `card.tsx` (Button variants: default/secondary/destructive/outline/ghost/link; Card: Header/Title/Description/Content/Footer).
- Rendered on `apps/mobile/src/app/index.tsx`, alongside the existing StyleSheet-based hero content, to prove both styling systems coexist in one screen without conflict.
- `apps/mobile/src/app/_layout.tsx`: imports `global.css`, renders `<PortalHost />` (from `@rn-primitives/portal`) as the last child, required for any future RNR component that portals (Dialog, DropdownMenu, Popover, Tooltip).

## Dependencies added

```
nativewind@4.2.6, react-native-css-interop@0.2.6 (pinned, see snag #1), react-native-reanimated@4.5.0,
tailwindcss-animate, class-variance-authority, clsx, tailwind-merge, @rn-primitives/portal, @rn-primitives/slot
devDependencies: tailwindcss@^3.4.17 (nativewind 4.x targets Tailwind v3, not v4, unlike the Next.js portals), tsx, prettier-plugin-tailwindcss
```

`nativewind` 5.0.0 exists only as a preview (`5.0.0-preview.4` on npm at spike time), not used, 4.2.6 is the current stable release and is what was verified here.

## Files touched

- `apps/mobile/babel.config.js` (new): `jsxImportSource: "nativewind"` + `nativewind/babel` preset.
- `apps/mobile/metro.config.js`: wrapped with `withNativeWind`, `inlineRem: 16` per RNR's manual install guide.
- `apps/mobile/scripts/gen-tokens.ts` (new): generates `global.css` + `tailwind.config.js` from `@atlitos/theme`, mirrors `apps/portal-court/scripts/gen-tokens.ts`.
- `apps/mobile/global.css`, `apps/mobile/tailwind.config.js` (generated, do not hand edit).
- `apps/mobile/nativewind-env.d.ts` (new): `/// <reference types="nativewind/types" />`.
- `apps/mobile/src/lib/utils.ts` (new): `cn()`.
- `apps/mobile/src/components/ui/text.tsx`, `button.tsx`, `card.tsx` (new).
- `apps/mobile/src/app/_layout.tsx`: `global.css` import, `PortalHost`, `Inter_500Medium` added to `useFonts` (needed for `font-sans-medium`).
- `apps/mobile/src/app/index.tsx`: renders the two proof components alongside the existing hero.
- `apps/mobile/package.json`: new deps (above), `gen-tokens` script, `build` now runs `gen-tokens` first.
- `apps/mobile/tsconfig.json`: `nativewind-env.d.ts` added to `include` (auto-applied by the nativewind CLI on first export, then hand-formatted back to the repo's compact style).
