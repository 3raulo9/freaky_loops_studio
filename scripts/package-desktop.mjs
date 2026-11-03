// Builds the native desktop app (Rust) and stages a self-contained folder:
//   release/FreakyLoopsStudio/
//     FreakyLoopsStudio.exe          64-bit app (UI host, audio engine, 64-bit VSTs)
//     bridge/FreakyLoopsVstBridge.exe 32-bit helper for 32-bit VSTs
//     wwwroot/                       the built Vue UI (from /dist)
// Run `npm run build` first (the `desktop:build` script does both).
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first.')
  process.exit(1)
}

run('cargo build --release -p fls-host')
run('cargo build --release -p fls-bridge --target i686-pc-windows-msvc')

const out = path.join(root, 'release', 'FreakyLoopsStudio')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'bridge'), { recursive: true })
fs.copyFileSync(path.join(root, 'target', 'release', 'FreakyLoopsStudio.exe'), path.join(out, 'FreakyLoopsStudio.exe'))
fs.copyFileSync(
  path.join(root, 'target', 'i686-pc-windows-msvc', 'release', 'FreakyLoopsVstBridge.exe'),
  path.join(out, 'bridge', 'FreakyLoopsVstBridge.exe'),
)
fs.cpSync(path.join(root, 'dist'), path.join(out, 'wwwroot'), { recursive: true })
console.log('\nPackaged → ' + out)
