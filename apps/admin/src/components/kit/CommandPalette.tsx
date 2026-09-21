import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { NavGroup, NavItem } from "../../layout/nav";
import "./CommandPalette.css";

/**
 * Cmd K over the nav (sink scope: nav items only). Part B B0.11 says this
 * eventually also reaches users/venues/gear/orders by name or id through the
 * same list reads; that wiring lands in A2, this is the nav shell for it.
 */
export function CommandPalette({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="ak-command-dialog"
    >
      <Command.Input placeholder="Jump to a page" className="ak-command-input" />
      <Command.List className="ak-command-list">
        <Command.Empty className="ak-command-empty">No matches.</Command.Empty>
        {groups.map((group) => (
          <Command.Group key={group.label} heading={group.label} className="ak-command-group">
            {group.items.map((item) => (
              <Command.Item
                key={item.to}
                onSelect={() => {
                  navigate(item.to);
                  setOpen(false);
                }}
                className="ak-command-item"
              >
                <item.icon size={16} strokeWidth={1.75} />
                {item.label}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
