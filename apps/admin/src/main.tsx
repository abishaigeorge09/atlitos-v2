import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { initSentry } from "./lib/sentry";
import { applyTheme, resolveTheme } from "./lib/theme";
// Self hosted variable fonts (A1-T1): Urbanist for UI text, JetBrains Mono
// for every numeric readout. Imported once here, never per page. tokens.css
// must load after these so --font-sans/--font-mono resolve to real faces.
import "@fontsource-variable/urbanist";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";

initSentry();

// Before the first render, and for every route including /login, which is
// outside the authenticated shell the toggle lives in.
applyTheme(resolveTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
