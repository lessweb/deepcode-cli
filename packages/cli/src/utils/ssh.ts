export function isSshSession(): boolean {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}
