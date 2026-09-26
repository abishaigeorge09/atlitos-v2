import { Authenticated, Refine } from "@refinedev/core";
import routerBindings, {
  CatchAllNavigate,
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { dataProvider } from "@refinedev/supabase";
import * as Sentry from "@sentry/react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Shell } from "./layout/Shell";
import { BookingsList } from "./pages/bookings/list";
import { Dashboard } from "./pages/dashboard";
import { DrillCreate } from "./pages/drills/create";
import { DrillShow } from "./pages/drills/show";
import { DrillsList } from "./pages/drills/list";
import { FeeConfigList } from "./pages/fee-config/list";
import { PayoutsList } from "./pages/payouts/list";
import { GearCreate } from "./pages/gear/create";
import { GearHealth } from "./pages/gear/health";
import { GearShow } from "./pages/gear/show";
import { GearList } from "./pages/gear/list";
import { KitchenSink } from "./pages/kitchen";
import { LoginPage } from "./pages/login";
import { ModerationList } from "./pages/moderation/list";
import { ModerationShow } from "./pages/moderation/show";
import { OrderShow } from "./pages/orders/show";
import { OrdersList } from "./pages/orders/list";
import { ReportsList } from "./pages/reports/list";
import { ReportShow } from "./pages/reports/show";
import { ProductShow } from "./pages/products/show";
import { ProductsList } from "./pages/products/list";
import { UserShow } from "./pages/users/show";
import { UsersList } from "./pages/users/list";
import { VenueCreate } from "./pages/venues/create";
import { VenueShow } from "./pages/venues/show";
import { VenuesList } from "./pages/venues/list";
import { VerificationList } from "./pages/verification/list";
import { VerificationShow } from "./pages/verification/show";
import { authProvider } from "./providers/authProvider";
import { Notifications, notificationProvider } from "./providers/notificationProvider";
import { supabaseClient } from "./providers/supabaseClient";

function ErrorFallback() {
  return (
    <div style={{ padding: "2rem" }}>
      <p>Something went wrong. The team has been notified. Reload the page to continue.</p>
    </div>
  );
}

export function App() {
  return (
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    <BrowserRouter>
      <Refine
        dataProvider={dataProvider(supabaseClient)}
        authProvider={authProvider}
        notificationProvider={notificationProvider}
        routerProvider={routerBindings}
        resources={[
          {
            name: "dashboard",
            list: "/dashboard",
            meta: { label: "Dashboard" },
          },
          {
            name: "verification_requests",
            list: "/verification",
            show: "/verification/show/:id",
            meta: { label: "Verification queue" },
          },
          {
            name: "venues",
            list: "/venues",
            create: "/venues/create",
            show: "/venues/show/:id",
            meta: { label: "Venues" },
          },
          {
            name: "products",
            list: "/products",
            show: "/products/show/:id",
            meta: { label: "Catalog" },
          },
          {
            name: "affiliate_products",
            list: "/gear",
            create: "/gear/create",
            show: "/gear/show/:id",
            meta: { label: "Gear" },
          },
          {
            name: "orders",
            list: "/orders",
            show: "/orders/show/:id",
            meta: { label: "Orders" },
          },
          {
            name: "drills",
            list: "/drills",
            create: "/drills/create",
            show: "/drills/show/:id",
            meta: { label: "Drills" },
          },
          {
            name: "clips",
            list: "/moderation",
            show: "/moderation/show/:id",
            meta: { label: "Moderation queue" },
          },
          {
            name: "reports",
            list: "/reports",
            show: "/reports/show/:id",
            meta: { label: "Reports queue" },
          },
          {
            name: "payouts",
            list: "/payouts",
            meta: { label: "Payouts" },
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
            show: "/users/show/:id",
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
            <Route index element={<NavigateToResource resource="dashboard" />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/verification" element={<VerificationList />} />
            <Route path="/verification/show/:id" element={<VerificationShow />} />
            <Route path="/venues" element={<VenuesList />} />
            <Route path="/venues/create" element={<VenueCreate />} />
            <Route path="/venues/show/:id" element={<VenueShow />} />
            <Route path="/products" element={<ProductsList />} />
            <Route path="/products/show/:id" element={<ProductShow />} />
            <Route path="/gear" element={<GearList />} />
            <Route path="/gear/create" element={<GearCreate />} />
            <Route path="/gear/health" element={<GearHealth />} />
            <Route path="/gear/show/:id" element={<GearShow />} />
            <Route path="/orders" element={<OrdersList />} />
            <Route path="/orders/show/:id" element={<OrderShow />} />
            <Route path="/drills" element={<DrillsList />} />
            <Route path="/drills/create" element={<DrillCreate />} />
            <Route path="/drills/show/:id" element={<DrillShow />} />
            <Route path="/moderation" element={<ModerationList />} />
            <Route path="/moderation/show/:id" element={<ModerationShow />} />
            <Route path="/reports" element={<ReportsList />} />
            <Route path="/reports/show/:id" element={<ReportShow />} />
            <Route path="/fee-config" element={<FeeConfigList />} />
            <Route path="/payouts" element={<PayoutsList />} />
            <Route path="/bookings" element={<BookingsList />} />
            <Route path="/users" element={<UsersList />} />
            <Route path="/users/show/:id" element={<UserShow />} />
            {/* Gate 1 kitchen sink: admin auth gated, deliberately absent
                from resources/nav.ts so it never appears in the sidebar or
                command palette. */}
            <Route path="/_kitchen" element={<KitchenSink />} />
          </Route>
        </Routes>
        <Notifications />
        <UnsavedChangesNotifier />
        <DocumentTitleHandler />
      </Refine>
    </BrowserRouter>
    </Sentry.ErrorBoundary>
  );
}
