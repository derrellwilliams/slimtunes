// Keep SlimTunes running in the background on macOS (starts at login, restarts if it crashes).
// Usage: npm run service -- install | uninstall | status | open
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const LABEL = 'com.slimtunes.server'
const repo = path.resolve(import.meta.dirname, '..')
const plistPath = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const dataDir = process.env.SLIMTUNES_HOME ?? path.join(homedir(), '.slimtunes')
const logPath = path.join(dataDir, 'server.log')
const domain = `gui/${process.getuid!()}`
const port = process.env.PORT ?? '4747'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function plist() {
  // fpcalc (Chromaprint) usually lives in Homebrew's bin, which launchd's default PATH lacks.
  const PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(path.join(repo, 'server', 'index.ts'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(repo)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${PATH}</string>
    <key>PORT</key><string>${xml(port)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict>
</plist>
`
}

const isLoaded = () => spawnSync('launchctl', ['print', `${domain}/${LABEL}`], { stdio: 'ignore' }).status === 0

function url() {
  const { token } = JSON.parse(readFileSync(path.join(dataDir, 'config.json'), 'utf8')) as { token: string }
  return `http://127.0.0.1:${port}/?t=${token}`
}

const cmd = process.argv[2] ?? 'status'
if (process.platform !== 'darwin') {
  console.error('The background service is macOS-only. Use `npm start` instead.')
  process.exit(1)
}

if (cmd === 'install') {
  if (!existsSync(path.join(repo, 'dist', 'index.html'))) {
    console.error('Build the app first: npm run build')
    process.exit(1)
  }
  mkdirSync(path.dirname(plistPath), { recursive: true })
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  if (isLoaded()) spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' })
  writeFileSync(plistPath, plist())
  execFileSync('launchctl', ['bootstrap', domain, plistPath])
  console.log(`SlimTunes now runs in the background and starts when you log in.\nLog: ${logPath}`)
  setTimeout(() => console.log(`Open it: ${url()}`), 1500)
} else if (cmd === 'uninstall') {
  if (isLoaded()) execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`])
  rmSync(plistPath, { force: true })
  console.log('Background service removed. Start SlimTunes manually with `npm start`.')
} else if (cmd === 'restart') {
  execFileSync('launchctl', ['kickstart', '-k', `${domain}/${LABEL}`])
  console.log('Restarted.')
} else if (cmd === 'open') {
  execFileSync('open', [url()])
} else {
  console.log(isLoaded() ? `Running in the background → ${url()}` : 'Not installed as a background service. Run `npm run service -- install`.')
}
