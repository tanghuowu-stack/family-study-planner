/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#25302b",
        paper: "#f7f8f3",
        sage: { 50: "#f0f5ef", 100: "#dfeadd", 500: "#67866c", 700: "#47604c" },
        sun: "#f0bc68"
      },
      boxShadow: { card: "0 12px 35px rgba(45, 61, 52, 0.08)" },
      fontFamily: { sans: ["Inter", "PingFang SC", "Microsoft YaHei", "sans-serif"] }
    },
  },
  plugins: [],
};
