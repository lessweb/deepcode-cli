import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

/**
 * Detects VS Code theme by checking for vscode-dark or vscode-light classes
 * that VS Code automatically applies to the webview's document element.
 * VS Code adds these classes to the <body> element, not <html>.
 */
function getVsCodeTheme(): "dark" | "light" {
  // VS Code adds vscode-dark/vscode-light to the body element
  const body = window.document.body;
  if (body.classList.contains("vscode-dark")) {
    return "dark";
  }
  if (body.classList.contains("vscode-light")) {
    return "light";
  }

  // Also check html element as fallback
  const root = window.document.documentElement;
  if (root.classList.contains("vscode-dark")) {
    return "dark";
  }
  if (root.classList.contains("vscode-light")) {
    return "light";
  }

  // Fallback: check computed style background brightness
  const bgColor = getComputedStyle(root).getPropertyValue("--vscode-editor-background");
  if (bgColor) {
    // Parse hex color and determine brightness
    const hex = bgColor.trim();
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 128 ? "dark" : "light";
  }
  return "dark"; // Default to dark for VS Code webviews
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(storageKey) as Theme) || defaultTheme);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      // For VS Code webviews, detect theme from VS Code's theme class
      const vscodeTheme = getVsCodeTheme();
      root.classList.add(vscodeTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  // Listen for VS Code theme changes
  useEffect(() => {
    const body = window.document.body;
    const root = window.document.documentElement;
    const observer = new MutationObserver(() => {
      if (theme === "system") {
        const vscodeTheme = getVsCodeTheme();
        root.classList.remove("light", "dark");
        root.classList.add(vscodeTheme);
      }
    });

    // Observe both body and html elements for class changes
    observer.observe(body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
