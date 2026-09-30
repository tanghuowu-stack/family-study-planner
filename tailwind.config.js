/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#202925",
        paper: "#F4F2ED",
        primary: "#245747",
        mint: "#DCEAE3",
        lavender: "#E8EEEB",
        muted: "#6E7772",
        alert: "#E36B4E",
        sage: { 50: "#eef4f0", 100: "#dbe8e0", 500: "#557565", 700: "#355648" },
        sun: "#EFC66A"
      },
      boxShadow: { card: "0 8px 24px rgba(31, 41, 37, 0.06)" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "PingFang SC", "Microsoft YaHei", "sans-serif"] }
    },
  },
  plugins: [],
};
