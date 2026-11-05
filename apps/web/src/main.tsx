import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import en from "../../../locales/en.json";

// Placeholder until requirement A1 builds the Mini App.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <p>{en["web.placeholder"]}</p>
  </StrictMode>,
);
