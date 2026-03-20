import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(215 28% 17%)",
        input: "hsl(215 28% 17%)",
        ring: "hsl(199 89% 48%)",
        background: "hsl(223 47% 11%)",
        foreground: "hsl(210 40% 98%)",
        primary: {
          DEFAULT: "hsl(199 89% 48%)",
          foreground: "hsl(222 47% 11%)"
        },
        secondary: {
          DEFAULT: "hsl(215 27% 24%)",
          foreground: "hsl(210 40% 98%)"
        },
        muted: {
          DEFAULT: "hsl(217 33% 17%)",
          foreground: "hsl(215 20% 65%)"
        },
        card: {
          DEFAULT: "hsl(222 47% 14%)",
          foreground: "hsl(210 40% 98%)"
        }
      }
    }
  },
  plugins: []
} satisfies Config;
