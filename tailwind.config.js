/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#2A3B30",
        paper: "#F8FAF7",
        primary: "#6BB089",
        mint: "#EAF5EC",
        lavender: "#ECE6F7",
        muted: "#7A8A80",
        alert: "#E8743B",
        sage: { 50: "#f0f5ef", 100: "#dfeadd", 500: "#67866c", 700: "#47604c" },
        sun: "#f0bc68"
      },
      boxShadow: { card: "0 12px 35px rgba(45, 61, 52, 0.08)" },
      fontFamily: { sans: ["Inter", "PingFang SC", "Microsoft YaHei", "sans-serif"] }
    },
  },
  plugins: [],
};
