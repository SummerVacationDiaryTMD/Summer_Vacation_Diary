import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "summer-vacation-diary",

  brand: {
    // Summer-sky blue to match the seasonal diary concept.
    primaryColor: "#4A9DF8",
  },

  permissions: [],
  // The Apps in Toss SDK renders the native non-game navigation itself.
  // Keep only the required controls: back, app title/logo, more and close.
  navigationBar: {
    withBackButton: true,
    withHomeButton: false,
    transparentBackground: false,
    theme: "light",
  },
  webBundleDir: "dist",
});
