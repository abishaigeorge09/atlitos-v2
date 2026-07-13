import { Authenticated, Refine } from "@refinedev/core";
import routerBindings, {
  CatchAllNavigate,
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { dataProvider } from "@refinedev/supabase";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Shell } from "./layout/Shell";
import { BookingsList } from "./pages/bookings/list";
import { FeeConfigList } from "./pages/fee-config/list";
import { LoginPage } from "./pages/login";
import { UsersList } from "./pages/users/list";
import { VenueShow } from "./pages/venues/show";
import { VenuesList } from "./pages/venues/list";
import { VerificationList } from "./pages/verification/list";
import { VerificationShow } from "./pages/verification/show";
import { authProvider } from "./providers/authProvider";
import { supabaseClient } from "./providers/supabaseClient";

export function App() {
  return (
    <BrowserRouter>
      <Refine
        dataProvider={dataProvider(supabaseClient)}
        authProvider={authProvider}
        routerProvider={routerBindings}
        resources={[
          {
            name: "verification_requests",
            list: "/verification",
            show: "/verification/show/:id",
            meta: { label: "Verification queue" },
          },
          {
            name: "venues",
            list: "/venues",
            show: "/venues/show/:id",
            meta: { label: "Venues" },
          },
          {
            name: "fee_config",
            list: "/fee-config",
            meta: { label: "Fee config" },
          },
          {
            name: "court_bookings",
            list: "/bookings",
            meta: { label: "Bookings" },
          },
          {
            name: "users",
            list: "/users",
            meta: { label: "Users" },
          },
        ]}
        options={{
          syncWithLocation: true,
          warnWhenUnsavedChanges: true,
          disableTelemetry: true,
        }}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <Authenticated key="admin-authenticated" fallback={<CatchAllNavigate to="/login" />}>
                <Shell />
              </Authenticated>
            }
          >
            <Route index element={<NavigateToResource resource="verification_requests" />} />
            <Route path="/verification" element={<VerificationList />} />
            <Route path="/verification/show/:id" element={<VerificationShow />} />
            <Route path="/venues" element={<VenuesList />} />
            <Route path="/venues/show/:id" element={<VenueShow />} />
            <Route path="/fee-config" element={<FeeConfigList />} />
            <Route path="/bookings" element={<BookingsList />} />
            <Route path="/users" element={<UsersList />} />
          </Route>
        </Routes>
        <UnsavedChangesNotifier />
        <DocumentTitleHandler />
      </Refine>
    </BrowserRouter>
  );
}
