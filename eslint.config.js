// ESLint-Konfiguration für das gesamte Projekt (Flat Config, ESLint 9).
//
//   npm run lint            -> prüft API, Web und gemeinsame Pakete
//   npm run lint:fix        -> behebt automatisch behebbare Befunde
//
// Die Formatierung übernimmt Prettier (siehe .prettierrc); eslint-config-prettier
// schaltet deshalb die Formatierungsregeln ab, damit sich beide nicht in die
// Quere kommen.
//
// Bewusst zurückhaltend: "recommended" plus wenige Zusatzregeln. Nicht
// sinnvoll prüfbare Dinge (Typen) macht der TypeScript-Compiler.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import prettier from "eslint-config-prettier";

// Die Hook-Regeln von eslint-plugin-react-hooks v7 richten sich nach den
// Regeln des React-Compilers. Diese App wird ohne Compiler gebaut, deshalb
// sind die compiler-nahen Regeln Hinweise statt Fehler: "refs" meldet z. B.
// jeden Zugriff auf ein Objekt, das einen Ref enthält (Muster: Hook liefert
// Objekt mit Ref + Zustand), "set-state-in-effect" den üblichen
// "Daten beim Aufbau laden". Die drei Regeln, die unabhängig vom Compiler
// immer gelten, bleiben Fehler.
const hookRulesAsWarnings = Object.fromEntries(
  Object.entries(reactHooks.configs.recommended.rules).map(([rule]) => [rule, "warn"]),
);

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.venv/**",
      "**/__pycache__/**",
      "**/data/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "apps/api/src/db/migrations/meta/**",
      // Capacitor/Xcode: enthaelt kopierte Web-Assets (App/App/public),
      // generierte Configs und Fremdcode aus dem Template.
      "apps/web/ios/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx,mts,cts,mjs,cjs,js}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
    rules: {
      // Ungenutzte Variablen sind ein Hinweis, kein Fehler -> warn.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // `any` ist im Projekt an wenigen Stellen (JSON-Zugriff, Fehlerobjekte)
      // unvermeidbar; sichtbar bleiben soll es trotzdem.
      "@typescript-eslint/no-explicit-any": "warn",
      // Leere Fehlerbehandlung ist fast immer ein Fehler.
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "smart"],
      "no-console": "off",
    },
  },

  // Node-Welt (API, Skripte, Erkennungsdienst-Tooling)
  {
    files: [
      "apps/api/**/*.ts",
      "packages/**/*.ts",
      "scripts/**/*.{mjs,js}",
      "apps/*/scripts/**/*.{mjs,js}",
      "apps/web/vite.config.ts",
      "apps/web/playwright.config.ts",
      "apps/web/capacitor.config.ts",
      "apps/web/tests/**/*.ts",
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Browser-Welt (PWA)
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...hookRulesAsWarnings,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/set-state-in-render": "error",
    },
  },

  // Tests: lockerer (Fixtures, dynamische Daten, gelegentliches any)
  {
    files: ["**/test/**/*.ts", "**/tests/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Formatierregeln gehören Prettier
  prettier,
);
