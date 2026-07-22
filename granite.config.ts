import { networkInterfaces } from "node:os";
import { defineConfig } from "@apps-in-toss/web-framework/config";
import { BRAND_DISPLAY_NAME, BRAND_PRIMARY_COLOR } from "./src/constants/brand";

function resolveDevelopmentHost() {
  const override = process.env.AIT_DEV_HOST?.trim();
  if (override) {
    return override;
  }

  const interfaces = networkInterfaces();
  const interfaceNames = [
    "en0",
    "en1",
    ...Object.keys(interfaces).filter((name) => name !== "en0" && name !== "en1"),
  ];

  for (const name of interfaceNames) {
    const address = interfaces[name]?.find(
      (candidate) => candidate.family === "IPv4" && !candidate.internal,
    );

    if (address) {
      return address.address;
    }
  }

  return "localhost";
}

// SDK 2.x config shape (granite.config.ts). The project moved back from the
// 3.0.0-beta track because only 2.x ships `granite dev`, the bridge that lets
// the Toss sandbox app attach to the local dev server; every runtime API the
// app uses (incl. saveBase64Data) exists in 2.10.7 with the same signature.
export default defineConfig({
  appName: "summer-vacation-diary",

  brand: {
    // Console registration must use the same Korean app name and appName above.
    displayName: BRAND_DISPLAY_NAME,
    // Summer-sky blue to match the seasonal diary concept.
    primaryColor: BRAND_PRIMARY_COLOR,
    // The registered look comes from the console upload
    // (docs/images/app-icon-600.png); the 2.x schema requires this key, so it
    // stays as an explicit empty placeholder instead of a duplicated URL.
    icon: "",
  },

  // Tells `granite dev` where the web dev server runs and how to start/build
  // it — this block (and the sandbox dev loop with it) is what 3.x removed.
  web: {
    // A physical device must reach the current developer's machine over LAN.
    // AIT_DEV_HOST can override auto-detection when a VPN is active.
    host: resolveDevelopmentHost(),
    port: 5173,
    commands: {
      dev: "vite dev --host 0.0.0.0",
      build: "vite build",
    },
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
  outdir: "dist",
});
