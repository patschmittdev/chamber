(function () {
  var THEME_PREFERENCES = ['light', 'dark', 'system'];
  var FONT_SCALES = ['small', 'medium', 'large'];
  var DENSITIES = ['comfortable', 'compact'];
  var FONT_SCALE_CLASSES = ['font-scale-small', 'font-scale-medium', 'font-scale-large'];
  var DENSITY_CLASSES = ['density-comfortable', 'density-compact'];
  var STORAGE_KEYS = {
    theme: 'chamber.theme',
    fontScale: 'chamber.fontScale',
    density: 'chamber.density',
  };
  var DEFAULT_SNAPSHOT = {
    themePreference: 'dark',
    resolvedTheme: 'dark',
    fontScale: 'medium',
    density: 'comfortable',
  };

  function isChoice(value, allowed) {
    return typeof value === 'string' && allowed.indexOf(value) !== -1;
  }

  function readChoice(key, allowed, fallback) {
    try {
      var stored = window.localStorage.getItem(key);
      return isChoice(stored, allowed) ? stored : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function resolveTheme(preference) {
    if (preference !== 'system') return preference;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function isSnapshot(value) {
    return value
      && typeof value === 'object'
      && isChoice(value.themePreference, THEME_PREFERENCES)
      && isChoice(value.resolvedTheme, ['light', 'dark'])
      && isChoice(value.fontScale, FONT_SCALES)
      && isChoice(value.density, DENSITIES);
  }

  function readDesktopSnapshot() {
    if (!window.chamberAppearance || typeof window.chamberAppearance.getInitialSnapshot !== 'function') {
      return null;
    }
    var snapshot = window.chamberAppearance.getInitialSnapshot();
    return isSnapshot(snapshot) ? snapshot : null;
  }

  function readBrowserSnapshot() {
    var themePreference = readChoice(STORAGE_KEYS.theme, THEME_PREFERENCES, DEFAULT_SNAPSHOT.themePreference);
    return {
      themePreference: themePreference,
      resolvedTheme: resolveTheme(themePreference),
      fontScale: readChoice(STORAGE_KEYS.fontScale, FONT_SCALES, DEFAULT_SNAPSHOT.fontScale),
      density: readChoice(STORAGE_KEYS.density, DENSITIES, DEFAULT_SNAPSHOT.density),
    };
  }

  function swapClass(root, classes, active) {
    for (var i = 0; i < classes.length; i += 1) root.classList.remove(classes[i]);
    root.classList.add(active);
  }

  function applySnapshot(snapshot) {
    var root = document.documentElement;
    root.classList.toggle('dark', snapshot.resolvedTheme === 'dark');
    root.dataset.theme = snapshot.resolvedTheme;
    root.dataset.themePreference = snapshot.themePreference;
    root.dataset.fontScale = snapshot.fontScale;
    root.dataset.density = snapshot.density;
    swapClass(root, FONT_SCALE_CLASSES, 'font-scale-' + snapshot.fontScale);
    swapClass(root, DENSITY_CLASSES, 'density-' + snapshot.density);
    window.__CHAMBER_INITIAL_APPEARANCE__ = snapshot;
  }

  applySnapshot(readDesktopSnapshot() || readBrowserSnapshot());
}());
