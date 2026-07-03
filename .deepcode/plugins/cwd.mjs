export default function cwdProvider({ projectRoot }) {
  const cwd = process.cwd() || projectRoot || "";
  if (!cwd) return "";
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const display = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  return display;
}
