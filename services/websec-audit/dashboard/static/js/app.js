// Dashboard behaviour, self-hosted so the page needs no inline <script> and can
// run under a strict Content-Security-Policy (script-src 'self').
//
// The chart registry is defined immediately (page templates call window.addChart
// during parse); everything that touches the DOM is deferred to DOMContentLoaded.

// --- Chart theming + registry ---------------------------------------------
// Chart.js reads its palette at construction time, so a theme switch destroys
// and rebuilds every registered chart in place.
(function () {
  window.__chartFactories = [];
  window.__chartInstances = [];
  window.applyChartTheme = function () {
    if (!window.Chart) return;
    var dark = document.documentElement.classList.contains('dark');
    Chart.defaults.color = dark ? '#cbd5e1' : '#475569';
    Chart.defaults.borderColor = dark ? 'rgba(148,163,184,.18)' : 'rgba(15,23,42,.1)';
  };
  // Register a chart factory (a function returning a new Chart instance).
  window.addChart = function (factory) { window.__chartFactories.push(factory); };
  // (Re)build every registered chart against the active theme.
  window.renderCharts = function () {
    window.applyChartTheme();
    window.__chartInstances.forEach(function (c) { try { c.destroy(); } catch (e) {} });
    window.__chartInstances = window.__chartFactories.map(function (f) { return f(); });
  };
  window.applyChartTheme();
})();

// --- Dark-mode toggle (in place, no reload) -------------------------------
function initThemeToggle() {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var nowDark = !document.documentElement.classList.contains('dark');
    try { localStorage.setItem('theme', nowDark ? 'dark' : 'light'); } catch (e) {}
    document.documentElement.classList.toggle('dark', nowDark);
    if (window.renderCharts) window.renderCharts();
  });
}

// --- Non-disruptive auto-refreshing scan status card ----------------------
//  1. Pause its polling while the user is editing the schedule, so a swap
//     (or the on-completion full reload) never wipes unsaved input.
//  2. Preserve the per-site progress list's scroll position across the polls.
function initScanStatusBehaviour() {
  function editingSchedule() {
    var d = document.getElementById('scheduleDetails');
    if (d && d.open) return true;
    var form = document.getElementById('scheduleForm');
    return !!(form && document.activeElement && form.contains(document.activeElement));
  }
  document.addEventListener('scroll', function (e) {
    if (e.target && e.target.id === 'scanSiteList') {
      window.__scanListScroll = e.target.scrollTop;
    }
  }, true);
  document.body.addEventListener('htmx:beforeRequest', function (evt) {
    var el = evt.detail && evt.detail.elt;
    if (el && el.id === 'scan-status' && editingSchedule()) {
      evt.preventDefault();
    }
  });
  document.body.addEventListener('htmx:afterSwap', function () {
    if (window.__scanListScroll == null) return;
    requestAnimationFrame(function () {
      var list = document.getElementById('scanSiteList');
      if (list) list.scrollTop = window.__scanListScroll;
    });
  });
}

// --- Next-scan countdown --------------------------------------------------
// Reads the DOM every second, so it naturally tracks the status card being
// swapped in on each poll. Defined once; the interval is guarded.
function scanCountdownTick() {
  document.querySelectorAll('.scan-countdown').forEach(function (el) {
    var textEl = el.querySelector('.cd-text');
    var nextIso = el.dataset.next;
    if (!nextIso || !textEl) return;
    var next = new Date(nextIso);
    var diff = Math.floor((next - new Date()) / 1000);
    if (diff <= 0) { textEl.textContent = '…'; return; }
    var h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60;
    var parts = [];
    if (h > 0) parts.push(h + 'h');
    if (h > 0 || m > 0) parts.push(m + 'm');
    parts.push(s + 's');
    var countdown = parts.join(' ');
    if (el.dataset.mode === 'clock') {
      var clock = next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      textEl.textContent = clock + ' (' + countdown + ')';
    } else {
      textEl.textContent = countdown;
    }
  });
}

function initScanCountdown() {
  scanCountdownTick();
  if (window.__scanCountdownTicker) return;
  window.__scanCountdownTicker = setInterval(scanCountdownTick, 1000);
}

document.addEventListener('DOMContentLoaded', function () {
  initThemeToggle();
  initScanStatusBehaviour();
  initScanCountdown();
});
