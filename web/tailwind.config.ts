/*
 * Tailwind v4 is CSS-first: tokens live in `app/globals.css` under @theme.
 * This file exists so tooling that grovels for a JS config still finds one.
 * Per PRD §7.1, all design tokens are declared via CSS variables and exposed
 * to Tailwind via @theme inline. Do not redeclare them here — single source.
 */
import type {Config} from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
};

export default config;
