"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Warm light and dark toggle for the dashboard shell, per
 * docs/design/DESIGN-LANGUAGE.md "Portals" component tone: warm-light
 * default with a dark toggle. Renders a sun icon in light mode and a moon
 * icon in dark mode, switching to an explicit theme choice that overrides
 * the system preference next-themes started from.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // resolvedTheme is undefined on the server and on first client render, so
  // this avoids a hydration mismatch between server-rendered and
  // system-resolved markup.
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted ? (
        isDark ? (
          <Sun strokeWidth={1.75} />
        ) : (
          <Moon strokeWidth={1.75} />
        )
      ) : (
        <Sun strokeWidth={1.75} className="opacity-0" />
      )}
    </Button>
  );
}
