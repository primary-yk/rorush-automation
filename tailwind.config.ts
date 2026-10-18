import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#12151c",
        border: "#252a36",
        accent: "#6ee7b7",
        danger: "#f87171",
        muted: "#94a3b8",
      },
    },
  },
  plugins: [],
};

export default config;
