/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  // Scan the dashboard templates (including the inline strings in their
  // <script> blocks) so every utility class actually used is emitted.
  // Custom badge/dot classes (grade-*, sev-*, dot-*) are plain CSS defined in
  // dashboard/assets/app.css, so they are always included and need no safelist.
  content: ["./dashboard/templates/**/*.html"],
  theme: { extend: {} },
  plugins: [],
};
