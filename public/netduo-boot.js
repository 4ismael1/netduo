(function () {
  try {
    var params = new URLSearchParams(window.location.search || '')
    var bootTheme = params.get('bootTheme')
    var cached = localStorage.getItem('netduo.theme')
    var validThemes = ['dark', 'light', 'nothing']
    var theme = validThemes.indexOf(bootTheme) >= 0
      ? bootTheme
      : validThemes.indexOf(cached) >= 0
        ? cached
        : 'light'
    var bg = theme === 'nothing' ? '#000000' : theme === 'dark' ? '#050507' : '#f1f5f9'

    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.backgroundColor = bg
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark'

    // App.jsx mirrors this value after React mounts. Applying it here keeps
    // the rail width stable from the first paint.
    var sidebarExpanded = false
    try {
      sidebarExpanded = localStorage.getItem('sidebar-expanded') === 'true'
    } catch {
      // Storage can be unavailable in hardened renderer contexts.
    }
    document.documentElement.style.setProperty('--rail-w', sidebarExpanded ? '200px' : '64px')

    var style = document.createElement('style')
    style.setAttribute('data-netduo-boot-theme', 'true')
    style.textContent = 'html,body,#root{background:' + bg + ';}'
    document.head.appendChild(style)
  } catch {
    // Boot styling is best-effort; React will apply the same state on mount.
  }
})()
