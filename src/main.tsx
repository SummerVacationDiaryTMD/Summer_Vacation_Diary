import { TDSMobileAITProvider } from "@toss/tds-mobile-ait";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import { BRAND_PRIMARY_COLOR } from "./constants/brand.ts";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TDSMobileAITProvider brandPrimaryColor={BRAND_PRIMARY_COLOR}>
      <App />
    </TDSMobileAITProvider>
  </StrictMode>,
);
