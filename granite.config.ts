import { defineConfig } from "@apps-in-toss/web-framework/config";

// SDK 2.x config shape (granite.config.ts). The project moved back from the
// 3.0.0-beta track because only 2.x ships `granite dev`, the bridge that lets
// the Toss sandbox app attach to the local dev server; every runtime API the
// app uses (incl. saveBase64Data) exists in 2.10.7 with the same signature.
export default defineConfig({
  appName: "summer-vacation-diary",

  brand: {
    // Console registration must use the same Korean app name and appName above.
    displayName: "나의 여름방학일기",
    // Summer-sky blue to match the seasonal diary concept.
    primaryColor: "#4A9DF8",
    // The registered look comes from the console upload
    // (docs/images/app-icon-600.png); the 2.x schema requires this key, so it
    // stays as an explicit empty placeholder instead of a duplicated URL.
    icon: "",
  },

  // Tells `granite dev` where the web dev server runs and how to start/build
  // it — this block (and the sandbox dev loop with it) is what 3.x removed.
  web: {
    host: "localhost",
    port: 5173,
    commands: {
      dev: "vite dev",
      build: "vite build",
    },
  },

  permissions: [],
  outdir: "dist",
});
