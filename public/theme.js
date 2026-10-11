// Runs in <head> before first paint so there is no flash of the wrong theme.
try {
  const t = localStorage.getItem('folio-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
} catch {}
