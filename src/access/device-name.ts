// The order matters: Edge and Opera carry "Chrome", Chrome carries "Safari", the iOS browsers their own marks.
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
]

/** The name a sign-in gets in the devices list, from the browser's `User-Agent`: "Chrome on Windows". */
export function deviceNameOf(userAgent: string | undefined): string {
  const agent = userAgent ?? ''
  const browser = BROWSERS.find(([mark]) => mark.test(agent))?.[1] ?? 'Browser'
  const system = SYSTEMS.find(([mark]) => mark.test(agent))?.[1]
  return system === undefined ? 'Browser' : `${browser} on ${system}`
}
