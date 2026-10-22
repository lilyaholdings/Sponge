export function runtimeError(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > 24 || (major === 24 && minor >= 5)
    ? null
    : `Chemical X requires Node.js 24.5 or newer; this computer has ${version}. Install the current Node.js LTS release from https://nodejs.org/, then reopen the launcher.`;
}
