export type Theme = "light" | "dark" | "system";

export function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getEffectiveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemTheme() : theme;
}

export function applyTheme(theme: Theme): void {
  const root = window.document.documentElement;
  const effectiveTheme = getEffectiveTheme(theme);

  root.classList.remove("light", "dark");
  root.classList.add(effectiveTheme);

  // Save theme preference
  localStorage.setItem("theme", theme);
}

export function getStoredTheme(): Theme {
  const savedTheme = localStorage.getItem("theme") as Theme;
  return savedTheme || "system";
}

export function getNextTheme(currentTheme: Theme): Theme {
  switch (currentTheme) {
    case "light":
      return "dark";
    case "dark":
      return "system";
    case "system":
    default:
      return "light";
  }
}
