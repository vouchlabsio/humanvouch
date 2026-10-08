// Flat ESLint configuration for the HumanVouch monorepo.
//
// Covers the Vue SFCs (packages/web/**/*.vue), the TypeScript sources
// (packages/web/**/*.ts) and plain JavaScript (packages/web/**/*.js) using
// eslint-plugin-vue and typescript-eslint. `@typescript-eslint/no-explicit-any`
// is promoted to an error for the server and shared-lib helpers, where an
// untyped `any` hides wire-format drift (the ChainCfg contract, the Turnstile
// response, the public-signal byte layout).
import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

// Generated / vendored output is never linted.
const GENERATED = [
  "**/node_modules/**",
  "**/.nuxt/**",
  "**/.output/**",
  "**/.turbo/**",
  "**/dist/**",
  "**/coverage/**",
  "packages/circuits/build/**",
  "packages/contracts/**/target/**",
  "packages/web/public/**",
];

// Browser APIs used by packages/web/lib plus Node globals used by build scripts.
const BROWSER_NODE_GLOBALS = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  fetch: "readonly",
  crypto: "readonly",
  localStorage: "readonly",
  console: "readonly",
  process: "readonly",
  Buffer: "readonly",
  require: "readonly",
  module: "readonly",
  __dirname: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
};

export default [
  { ignores: GENERATED },

  // Baseline correctness rules for every file.
  js.configs.recommended,

  // Recommended TypeScript and Vue rule sets.
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],

  {
    // TypeScript sources and SFC <script> blocks. Nuxt auto-imports
    // (ref, useHead, defineEventHandler, ...) make `no-undef` noise without
    // full type information, so it is disabled for these files.
    files: ["**/*.ts", "**/*.vue"],
    languageOptions: {
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },

  {
    // Route the <script lang="ts"> block of an SFC through the TS parser.
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },

  // Explicit `any` is a warning by default...
  {
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },

  // ...except in plain JavaScript, where it is meaningless.
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: BROWSER_NODE_GLOBALS,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": "off",
      "no-unused-vars": "warn",
    },
  },

  // ...and an error for the server + shared-lib helpers.
  {
    files: ["packages/web/server/**/*.{ts,js}", "packages/web/lib/**/*.{ts,js}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];
