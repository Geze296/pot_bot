import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/dist/", "**/coverage/", "packages/db/src/generated/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already catches undefined names, and this rule misreads Node globals in .mjs scripts.
      "no-undef": "off",
    },
  },
  prettier,
);
