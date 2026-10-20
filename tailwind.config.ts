import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#0c0e16",
        border: "#252a36",
        accent: "#6ee7b7",
        danger: "#f87171",
        muted: "#94a3b8",
      },
      boxShadow: {
        "glow-mint": "0 0 80px -24px rgba(110, 231, 183, 0.35)",
        "glow-violet": "0 0 90px -20px rgba(139, 92, 246, 0.45)",
        "glow-cyan": "0 0 80px -24px rgba(56, 189, 248, 0.25)",
        "vibe-inner": "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
      },
      animation: {
        "fade-in": "fade-in 0.45s ease-out both",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
