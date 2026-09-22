import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { initSentry } from "./lib/sentry";
// Self hosted variable fonts (A1-T1): Urbanist for UI text, JetBrains Mono
// for every numeric readout. Imported once here, never per page. tokens.css
// must load after these so --font-sans/--font-mono resolve to real faces.
import "@fontsource-variable/urbanist";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";

initSentry();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
