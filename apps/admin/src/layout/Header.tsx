import { Search } from "lucide-react";

import { ThemeToggle } from "./ThemeToggle";

/** Top bar: search field, theme toggle. Stripe reference: search left of the
 * chrome controls (stripe-home.png). Cmd K opens the command palette;
 * clicking the field is a hint toward the same shortcut for the sink. */
export function Header() {
  return (
    <header className="ak-header">
      <button type="button" className="ak-header-search" onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}>
        <Search size={16} strokeWidth={1.75} />
        <span>Search</span>
        <kbd className="ak-header-kbd">Cmd K</kbd>
      </button>
      <div className="ak-header-spacer" />
      <ThemeToggle />
    </header>
  );
}
