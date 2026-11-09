// Screenshots of the web panel's dev server (cd web && npm run dev) with headless Edge or Chrome:
// node scripts/shot-web.mjs [out.png] [width] [height] [query]. Used to check a layout change.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [out = '.orca/web.png', width = '400', height = '700', query = 'lang=vi'] = process.argv.slice(2)
const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
]
const browser = browsers.find((path) => existsSync(path))
if (!browser) throw new Error('No Edge or Chrome found')
execFileSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shot-web-'))}`,
  `--virtual-time-budget=${process.env.SHOT_WAIT_MS ?? 5000}`,
  `--window-size=${width},${height}`,
  `--screenshot=${resolve(out)}`,
  `http://localhost:5174/?${query}`
], { stdio: 'ignore' })
console.log(resolve(out))
