/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./components/**/*.{vue,js,ts}",
    "./layouts/**/*.vue",
    "./pages/**/*.vue",
    "./app.vue",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0b0e14", // engraving plate
          800: "#121823",
          700: "#1b2433",
          600: "#283446",
        },
        paper: {
          DEFAULT: "#ECE6D8", // cool security paper
          dim: "#AEA994",
          faint: "#6f6e63",
        },
        prussian: {
          DEFAULT: "#2b4a7e", // intaglio ink
          light: "#5b80bd",
        },
        brass: {
          DEFAULT: "#B08D57", // hallmark metal
          light: "#d8b884",
        },
        oxblood: "#6E2A33",
      },
      fontFamily: {
        display: ["Fraunces", "ui-serif", "Georgia", "serif"],
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        eyebrow: "0.32em",
      },
      maxWidth: {
        doc: "72rem",
      },
    },
  },
  plugins: [],
};
