import type { Config } from "tailwindcss";

// Colors come from CSS variables in app/globals.css (design tokens, see docs/redesign-v1.md).
// Channels are stored as "R G B" so opacity modifiers like bg-vi/20 keep working.
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: token("ink"),
        s1: token("s1"),
        s2: token("s2"),
        line: token("line"),
        tx: token("tx"),
        mu: token("mu"),
        vi: token("vi"),
        pri: token("pri"),
        go: token("go"),
        danger: token("danger"),
        success: token("success"),
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
      },
      boxShadow: {
        float: "0 12px 32px #00000066",
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
        serif: ['"Palatino Linotype"', "Palatino", '"Book Antiqua"', "Georgia", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
