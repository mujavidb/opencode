;(function () {
  var scheme = localStorage.getItem("opencode-color-scheme-daynight") || "system"
  var hour = new Date().getHours()
  var isDay = hour >= 6 && hour < 19
  var isDark = scheme === "dark" || (scheme === "system" && !isDay)
  var mode = isDark ? "dark" : "light"
  var modeKey = isDark ? "opencode-theme-id-dark" : "opencode-theme-id-light"
  var themeId = localStorage.getItem(modeKey) || localStorage.getItem("opencode-theme-id") || "oc-2"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa"

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#080808" : "#fafafa")

  if (themeId === "oc-2") return

  var css = localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
