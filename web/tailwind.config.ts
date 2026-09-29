import type { Config } from "tailwindcss";

// Colors are declared once as CSS custom properties in app/globals.css (light +
// dark steps from the same ramps) and surfaced here by role, so components are
// written against roles rather than raw hex.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        plane: "var(--plane)",
        surface: "var(--surface-1)",
        ink: "var(--text-primary)",
        "ink-secondary": "var(--text-secondary)",
        "ink-muted": "var(--text-muted)",
        grid: "var(--grid)",
        axis: "var(--axis)",
        hairline: "var(--border)",
        series: "var(--series-1)",
        good: "var(--status-good)",
        warning: "var(--status-warning)",
        serious: "var(--status-serious)",
        critical: "var(--status-critical)",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
