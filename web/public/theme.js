// The theme chosen in this browser (web/src/theme.ts), set before the first paint so a dark choice never flashes light.
// A file, not an inline script: the page's policy allows scripts of its own origin only (src/server-security.ts).
try {
  var choice = localStorage.getItem('even-keel.theme')
} catch (error) {}
document.documentElement.dataset.theme = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
