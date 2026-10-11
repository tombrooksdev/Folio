// Runs in <head> before first paint so there is no flash of the wrong theme.
try {
  const legacy = { light: 'tombrooks', dark: 'tombrooks-dark' };
  let t = localStorage.getItem('folio-theme');
  t = legacy[t] || t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'tombrooks-dark' : 'tombrooks');
  document.documentElement.dataset.theme = t;
} catch {}
