/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f3f0ff",
          100: "#e5d3ff",
          200: "#d0bfff",
          300: "#b197fc",
          400: "#9775fa",
          500: "#845ef7",
          600: "#7950f2",
          700: "#7048e8",
          800: "#6741d9", // Primary brand color
          900: "#5f3dc4",
          950: "#4c2a85",
        },
        primary: "#6741d9", // Primary brand color shorthand
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-in-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
