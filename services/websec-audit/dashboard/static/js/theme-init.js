// Apply the saved theme before first paint to avoid a flash of the wrong theme.
// Loaded as the very first <head> script (self-hosted; CSP-friendly, no inline JS).
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var dark = saved ? saved === 'dark'
                     : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
