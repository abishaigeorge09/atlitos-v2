"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// Class strategy toggles `.dark` on <html>, matching the shadcn HSL var
// tokens in globals.css. defaultTheme="system" + enableSystem means a
// partner who has never set a preference lands on whatever their OS
// prefers, which is the warm light palette for the common light-OS case
// (see docs/design/DESIGN-LANGUAGE.md theming section). The in-app toggle
// then sets an explicit choice that overrides system going forward.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
