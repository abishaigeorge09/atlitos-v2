import { Refine } from "@refinedev/core";
import routerBindings, {
  DocumentTitleHandler,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { dataProvider } from "@refinedev/supabase";
import { LayoutGrid } from "lucide-react";
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";

import { ProfilesList } from "./pages/profiles/list";
import { authProvider } from "./providers/authProvider";
import { supabaseClient } from "./providers/supabaseClient";
import { colors } from "@atlitos/theme";

// TODO(P1): restyle this shell to the full DESIGN-LANGUAGE.md token set
// (typography scale, radii, elevation, motion) once packages/ui-web exists.
// This layout only reads color tokens directly for now, no default Refine
// theme package (antd/mui) is installed, keeping the shell headless and
// lucide only per house style.
const shellStyles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    backgroundColor: colors.light.bg,
    color: colors.light.text,
    fontFamily: "Inter, sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 24px",
    borderBottom: `1px solid ${colors.light.border}`,
    backgroundColor: colors.light.surface,
  },
  brandMark: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.light.accent,
    color: colors.light.inkOnAccent,
  },
  brandText: {
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: "-0.4px",
  },
  main: {
    flex: 1,
    padding: 24,
  },
};

function Shell() {
  return (
    <div style={shellStyles.page}>
      <header style={shellStyles.header}>
        <span style={shellStyles.brandMark}>
          <LayoutGrid size={20} strokeWidth={1.75} />
        </span>
        <span style={shellStyles.brandText}>Atlitos Admin</span>
      </header>
      <main style={shellStyles.main}>
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Refine
        dataProvider={dataProvider(supabaseClient)}
        authProvider={authProvider}
        routerProvider={routerBindings}
        resources={[
          {
            name: "profiles",
            list: "/profiles",
            meta: {
              label: "Profiles",
            },
          },
        ]}
        options={{
          syncWithLocation: true,
          warnWhenUnsavedChanges: true,
          disableTelemetry: true,
        }}
      >
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<ProfilesList />} />
            <Route path="/profiles" element={<ProfilesList />} />
          </Route>
        </Routes>
        <UnsavedChangesNotifier />
        <DocumentTitleHandler />
      </Refine>
    </BrowserRouter>
  );
}
