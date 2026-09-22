import { ChevronsLeft, ChevronsRight, LayoutGrid, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

import { navGroups } from "./nav";

const COLLAPSE_KEY = "atlitos-admin-sidebar-collapsed";

function readPersistedCollapsed(): boolean {
  return localStorage.getItem(COLLAPSE_KEY) === "1";
}

export function Sidebar({
  identityName,
  onLogout,
}: {
  identityName?: string | null;
  onLogout: () => void;
}) {
  const [collapsed, setCollapsed] = useState(readPersistedCollapsed);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    function onResize() {
      setNarrow(window.innerWidth < 1024);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Collapses below 1024 regardless of the toggle, and on the toggle at any
  // width (Part B B0.1, A1-T2).
  const isRail = collapsed || narrow;

  return (
    <aside className={`ak-sidebar${isRail ? " ak-sidebar-rail" : ""}`}>
      <div className="ak-sidebar-brand">
        <span className="ak-sidebar-mark">
          <LayoutGrid size={20} strokeWidth={1.75} />
        </span>
        {!isRail ? <span className="ak-sidebar-brand-name">Atlitos Admin</span> : null}
      </div>

      <nav className="ak-sidebar-nav">
        {navGroups.map((group) => (
          <div key={group.label} className="ak-sidebar-group">
            {!isRail ? <p className="ak-sidebar-group-label">{group.label}</p> : null}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                title={isRail ? item.label : undefined}
                className={({ isActive }) => `ak-sidebar-item${isActive ? " ak-sidebar-item-active" : ""}`}
              >
                <item.icon size={20} strokeWidth={1.75} />
                {!isRail ? <span>{item.label}</span> : null}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="ak-sidebar-spacer" />

      <button
        type="button"
        className="ak-sidebar-collapse-toggle"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronsRight size={18} strokeWidth={1.75} /> : <ChevronsLeft size={18} strokeWidth={1.75} />}
        {!isRail ? <span>Collapse</span> : null}
      </button>

      <div className="ak-sidebar-footer">
        {!isRail ? <span className="ak-sidebar-identity">{identityName ?? "Signed in"}</span> : null}
        <button type="button" className="ak-sidebar-logout" onClick={onLogout} title={isRail ? "Sign out" : undefined}>
          <LogOut size={16} strokeWidth={1.75} />
          {!isRail ? <span>Sign out</span> : null}
        </button>
      </div>
    </aside>
  );
}
