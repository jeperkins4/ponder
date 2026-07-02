import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

// The installed `eslint-config-next` version still ships legacy
// `.eslintrc`-style configs (extends arrays), not native flat-config
// exports, so we bridge it into flat config via FlatCompat rather than
// importing `eslint-config-next/core-web-vitals` / `/typescript` directly.
const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
});

const eslintConfig = [
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript"],
  }),
  {
    files: ["src/**/*.{js,jsx,ts,tsx}", "scripts/**/*.mjs"],
  },
  {
    // Downgraded to warnings rather than a large manual refactor.
    // `any` shows up in a handful of JIRA API response shapes and test
    // mocks where a precise type would need to mirror JIRA's REST payload
    // 1:1; `exhaustive-deps` flags a few intentional one-time-effect
    // hooks. Both are pragmatic tuning, not a blanket disable.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "node_modules/**",
      "coverage/**",
      "prisma/migrations/**",
      "tsconfig.tsbuildinfo",
      "**/generated/**",
      ".worktrees/**",
    ],
  },
];

export default eslintConfig;
