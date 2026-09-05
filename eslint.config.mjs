import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // This app has no server-side data source (books/plans/progress live in
      // IndexedDB/localStorage), so loading state in an effect on mount is the
      // correct, unavoidable pattern here rather than something to eliminate.
      "react-hooks/set-state-in-effect": "warn",
      // App Router has no pages/_document.js — this rule targets the Pages Router.
      "@next/next/no-page-custom-font": "off",
    },
  },
]);

export default eslintConfig;
