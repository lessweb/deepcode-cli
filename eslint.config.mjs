import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Base recommended rules from ESLint
  js.configs.recommended,
  // TypeScript recommended rules
  ...tseslint.configs.recommended,
  // Custom project rules
  {
    rules: {
      // CLI project allows console
      "no-console": "off",
      // Allow dynamic require for package.json (cli.tsx)
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-require-imports": "off",
      // Allow control regex for ANSI stripping (markdown.test.ts)
      "no-control-regex": "off",
      // Enforce consistent type imports
      "@typescript-eslint/consistent-type-imports": "warn",
      // Unused vars: allow _-prefixed parameters
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // React hooks rules
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Test files: relaxed rules
  {
    files: ["packages/*/src/tests/**/*.ts", "packages/*/src/tests/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Script files: Node.js environment
  {
    files: ["./scripts/**/*.js", "./scripts/**/*.mjs", "packages/*/scripts/**/*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  // Statusline plugins: Node.js environment
  {
    files: [".deepcode/plugins/**/*.mjs", ".deepcode/plugins/**/*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  // Browser resources: VSCode webview scripts
  {
    files: ["packages/*/resources/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        FileReader: "readonly",
        Blob: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
  },
  // Prettier config: disable conflicting ESLint rules, MUST be last
  prettierConfig
);
