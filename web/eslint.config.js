import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "eslint.config.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        localStorage: "readonly",
        URLSearchParams: "readonly",
        URL: "readonly",
        HTMLSelectElement: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        btoa: "readonly",
        atob: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Number: "readonly",
        Math: "readonly",
        JSON: "readonly",
        Object: "readonly",
        Array: "readonly",
        Set: "readonly",
        Map: "readonly",
        Date: "readonly",
        Error: "readonly",
        Promise: "readonly",
        ImportMeta: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-undef": "off",
    },
  },
];
