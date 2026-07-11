import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ponder: {
          // Light theme (Drift)
          light: {
            bg: "#f4f5f7",
            surface: "#FFFFFF",
            border: "#e4e6ea",
            text: "#171a21",
            "text-muted": "#5c6270",
            purple: "#5b57d6",
            "purple-dark": "#4a46c4",
            "purple-light": "#edecfb",
            "card-border": "#e7e9ee",
          },
          // Dark theme (Nocturne)
          dark: {
            bg: "#0f1117",
            surface: "#14161d",
            border: "#23262f",
            text: "#f1f2f7",
            "text-muted": "#7f8698",
            purple: "#8b7bff",
            "purple-dark": "#6b5fc4",
            "purple-light": "#1a1951",
            "card-border": "#282d38",
          },
          // Accents
          high: "#e5484d",
          medium: "#f59e0b",
          low: "#9aa4b2",
        },
      },
      fontFamily: {
        "instrument": ["var(--font-instrument-sans)", "Instrument Sans", "-apple-system", "system-ui", "sans-serif"],
        "space-grotesk": ["var(--font-space-grotesk)", "Space Grotesk", "sans-serif"],
      },
      boxShadow: {
        "ponder-card": "0 1px 2px rgba(20, 22, 35, 0.05)",
        "ponder-card-hover": "0 12px 26px -10px rgba(20, 22, 35, 0.24)",
      },
    },
  },
  plugins: [],
};

export default config;
