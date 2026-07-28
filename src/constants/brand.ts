export const BRAND_DISPLAY_NAME = "나의 여름방학 일기";
export const BRAND_PRIMARY_COLOR = "#dccb8a";

// `brand.icon` in granite.config.ts takes an image URL, never a repo path: the
// SDK copies the string verbatim into the Toss runtime metadata (`brandIcon`)
// and no build step bundles the referenced file, so "design/app-icon.png" would
// resolve to nothing at runtime.
//
// Source artwork: design/app-icon.png (600x600, fully opaque). Upload it in the
// Apps in Toss console (앱 정보 → 앱 로고), right-click the uploaded image, copy
// its link, and paste that URL here. Empty keeps the console-registered logo,
// which is the icon users actually see, so an empty value is safe.
export const BRAND_ICON_URL = "https://static.toss.im/appsintoss/59653/8d65faf7-9498-4400-90bf-0465bc30a218.png";
