import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { ink: "#121117", s1: "#18171f", s2: "#201f29", line: "#2c2a38", tx: "#ebe9f3", mu: "#a09eb2", vi: "#a38ad1", pri: "#50348f", go: "#d6a94a" },
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
        serif: ['"Palatino Linotype"', "Palatino", '"Book Antiqua"', "Georgia", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
