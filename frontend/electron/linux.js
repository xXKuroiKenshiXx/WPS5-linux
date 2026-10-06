'use strict';
// Linux integration uses argv arrays, never shell-interpolated game paths.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
const home = os.homedir();
const isFlatpak = () => Boolean(process.env.FLATPAK_ID || fs.existsSync('/.flatpak-info'));
const hostChildren = new Map();

function cleanEnvironment(env = process.env) {
  const result = { ...env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'APPIMAGE', 'APPDIR', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'PYTHONHOME', 'PYTHONPATH']) delete result[key];
  return result;
}

async function runHost(command, args = [], options = {}) {
  return runFile(isFlatpak() ? 'flatpak-spawn' : command,
    isFlatpak() ? ['--host', command, ...args] : args,
    { encoding: 'utf8', timeout: 8000, maxBuffer: 4 * 1024 * 1024, ...options });
}

function spawnExternal(command, args, options) {
  if (!isFlatpak()) return spawn(command, args, { ...options, env: cleanEnvironment(options.env) });
  // Start a host process group and report its PID; flatpak-spawn waits for it.
  const script = 'cd "$1" || exit; shift; setsid "$@" </dev/null >/dev/null 2>&1 & child=$!; printf "WPS5_PID=%s\\n" "$child"; wait "$child"';
  const child = spawn('flatpak-spawn', ['--host', 'env',
    ...['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'APPIMAGE', 'APPDIR', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'PYTHONHOME', 'PYTHONPATH'].flatMap(k => ['-u', k]),
    'sh', '-c', script, 'wps5-launch', options.cwd || home, command, ...args],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => {
    output += data;
    const match = output.match(/WPS5_PID=(\d+)/);
    if (match) hostChildren.set(child.pid, Number(match[1]));
  });
  child.on('close', () => hostChildren.delete(child.pid));
  child.stderr.on('data', data => console.warn('[Host launch]', String(data).trim()));
  return child;
}

// Desktop Entry escaping is deliberately separate from POSIX shell syntax.
function splitArgs(text) {
  const out = [];
  let token = '', quoted = false, started = false;
  for (let i = 0; i < String(text || '').length; i++) {
    const c = text[i];
    if (c === '\\') {
      if (++i >= text.length) throw new Error('Trailing escape in arguments');
      token += text[i]; started = true;
    } else if (c === '"') {
      quoted = !quoted; started = true;
    } else if (/\s/.test(c) && !quoted) {
      if (started) { out.push(token); token = ''; started = false; }
    } else { token += c; started = true; }
  }
  if (quoted) throw new Error('Unclosed quote in arguments');
  if (started) out.push(token);
  return out;
}

function desktopUnescape(text) {
  return String(text || '').replace(/\\([sntr\\])/g, (_, c) => ({ s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' }[c]));
}

function parseDesktop(text, filename, { locale = process.env.LANG || '', desktop = process.env.XDG_CURRENT_DESKTOP || '' } = {}) {
  const values = {};
  let main = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\[/.test(line)) { main = line.trim() === '[Desktop Entry]'; continue; }
    if (!main || /^\s*#/.test(line)) continue;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) values[match[1].trim()] = match[2];
  }
  if (values.Hidden === 'true' || values.NoDisplay === 'true') return { hidden: true };
  const current = desktop.split(':');
  if (values.OnlyShowIn && !values.OnlyShowIn.split(';').some(x => current.includes(x))) return { hidden: true };
  if (values.NotShowIn && values.NotShowIn.split(';').some(x => current.includes(x))) return { hidden: true };
  if (values.Type !== 'Application' || !values.Exec) return null;
  const language = locale.split('.')[0].split('@')[0];
  const name = desktopUnescape(values[`Name[${language}]`] || values[`Name[${language.split('_')[0]}]`] || values.Name || path.basename(filename, '.desktop'));
  const icon = desktopUnescape(values.Icon);
  // Expand only defined field codes. Files/URLs are empty when opening a library item.
  const args = splitArgs(desktopUnescape(values.Exec)).flatMap(token => {
    if (token === '%i') return icon ? ['--icon', icon] : [];
    if (token === '%c') return [name];
    if (token === '%k') return [filename];
    if (/^%[fFuUdDnNvVm]$/.test(token)) return [];
    const expanded = token.replace(/%%/g, '\u0000');
    if (/%[a-zA-Z]/.test(expanded)) throw new Error('Unsupported desktop field code');
    return [expanded.replace(/\u0000/g, '%')];
  });
  if (!args.length) return null;
  return { name, command: args[0], args: args.slice(1), workingDir: desktopUnescape(values.Path) || null,
    tryExec: desktopUnescape(values.TryExec), terminal: values.Terminal === 'true', icon,
    categories: values.Categories || '', path: filename };
}

function applicationDirs(env = process.env, userHome = home) {
  return [...new Set([
    path.join(env.WPS5_HOST_DATA_HOME || env.XDG_DATA_HOME || path.join(userHome, '.local/share'), 'applications'),
    ...String(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean).map(p => path.join(p, 'applications')),
    path.join(userHome, '.local/share/flatpak/exports/share/applications'),
    '/var/lib/flatpak/exports/share/applications',
    ...(isFlatpak() ? ['/run/host/usr/share/applications', '/run/host/usr/local/share/applications'] : []),
  ])];
}

async function findCommand(name) {
  if (!name || /[\n\r\0]/.test(name)) return null;
  if (isFlatpak()) {
    try { const r = await runHost('sh', ['-c', 'command -v -- "$1"', 'wps5', name]); return r.stdout.trim() || null; } catch { return null; }
  }
  const candidates = name.includes('/') ? [name] : String(process.env.PATH || '').split(':').filter(Boolean).map(dir => path.join(dir, name));
  for (const candidate of candidates) {
    try { await fsp.access(candidate, fs.constants.X_OK); if ((await fsp.stat(candidate)).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}

async function getInstalledPrograms(dirs = applicationDirs()) {
  const seen = new Set(), programs = [];
  async function walk(dir, prefix = '') {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name), id = prefix + e.name;
      if (e.isDirectory()) { await walk(full, id + '-'); continue; }
      if (!e.name.endsWith('.desktop') || seen.has(id)) continue;
      seen.add(id); // A hidden user entry also masks its system entry.
      try {
        const entry = parseDesktop(await fsp.readFile(full, 'utf8'), full);
        if (!entry || entry.hidden || (entry.tryExec && !await findCommand(entry.tryExec))) continue;
        programs.push({ name: entry.name, path: full, lnkPath: full, source: 'linux', iconBase64: null });
      } catch { /* invalid entries are not launchable */ }
    }
  }
  for (const dir of dirs) await walk(dir);
  if (isFlatpak()) {
    try {
      const { stdout } = await runHost('sh', ['-c', 'for dir in "${XDG_DATA_HOME:-$HOME/.local/share}/applications" "$HOME/.local/share/flatpak/exports/share/applications" /var/lib/flatpak/exports/share/applications; do [ ! -d "$dir" ] || find "$dir" -name "*.desktop"; done; printf "%s\\n" "${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" | tr ":" "\\n" | while IFS= read -r base; do dir="$base/applications"; [ ! -d "$dir" ] || find "$dir" -name "*.desktop"; done'], { timeout: 15000 });
      for (const filename of stdout.split('\n').filter(Boolean)) {
        if (seen.has(path.basename(filename))) continue;
        seen.add(path.basename(filename));
        const { stdout: text } = await runHost('cat', [filename]);
        const entry = parseDesktop(text, filename);
        if (!entry || entry.hidden) continue;
        programs.push({ name: entry.name, path: filename, lnkPath: filename, source: 'linux', iconBase64: null });
      }
    } catch { /* host bridge unavailable */ }
  }
  return programs.sort((a, b) => a.name.localeCompare(b.name));
}

const emulatorAliases = {
  duckstation: ['duckstation-qt', 'duckstation'], pcsx2: ['pcsx2-qt', 'pcsx2'],
  rpcs3: ['rpcs3'], ppsspp: ['PPSSPPSDL', 'PPSSPPQt', 'ppsspp', 'ppsspp-sdl', 'ppsspp-qt'],
  dolphin: ['dolphin-emu'], retroarch: ['retroarch'], ryujinx: ['Ryujinx', 'ryujinx'], eden: ['eden'],
};
const emulatorFlatpaks = {
  duckstation: ['org.duckstation.DuckStation'], pcsx2: ['net.pcsx2.PCSX2'], rpcs3: ['net.rpcs3.RPCS3'],
  ppsspp: ['org.ppsspp.PPSSPP'], dolphin: ['org.DolphinEmu.dolphin-emu'], retroarch: ['org.libretro.RetroArch'],
  ryujinx: ['org.ryujinx.Ryujinx'], eden: ['dev.eden_emu.eden'],
};

async function detectEmulator(names) {
  const keys = Object.keys(emulatorAliases).filter(key => names.some(n => String(n).toLowerCase().includes(key)));
  const aliases = [...new Set([...keys.flatMap(k => emulatorAliases[k]), ...names.filter(n => !n.endsWith('.exe'))])];
  for (const alias of aliases) { const found = await findCommand(alias); if (found) return found; }
  for (const p of await getInstalledPrograms()) {
    try {
      const entry = parseDesktop(isFlatpak() ? (await runHost('cat', [p.path])).stdout : await fsp.readFile(p.path, 'utf8'), p.path);
      if (keys.some(k => `${entry.name} ${entry.command} ${entry.args.join(' ')}`.toLowerCase().includes(k))) return p.path;
    } catch { /* next */ }
  }
  try {
    const installed = (await runHost('flatpak', ['list', '--app', '--columns=application'])).stdout.split(/\r?\n/);
    for (const id of keys.flatMap(k => emulatorFlatpaks[k])) if (installed.includes(id)) return `flatpak:${id}`;
  } catch { /* Flatpak is optional */ }
  // Only bounded, conventional user locations; never crawl the whole disk.
  for (const dir of [path.join(home, 'Applications'), path.join(home, 'Emulators'), path.join(home, 'Downloads')]) {
    try {
      const filenames = isFlatpak()
        ? (await runHost('find', [dir, '-maxdepth', '1', '-type', 'f', '-iname', '*.AppImage'])).stdout.split('\n').filter(Boolean).map(p => path.basename(p))
        : await fsp.readdir(dir);
      for (const filename of filenames) {
        if (!/\.AppImage$/i.test(filename) || !keys.some(k => filename.toLowerCase().includes(k))) continue;
        const full = path.join(dir, filename);
        if (await findCommand(full)) return full;
      }
    } catch { /* missing directory */ }
  }
  return null;
}

async function resolveLaunch(executable, extraArgs = '') {
  let command = executable, args = Array.isArray(extraArgs) ? extraArgs : splitArgs(extraArgs), cwd = null;
  if (executable.endsWith('.desktop')) {
    const entry = parseDesktop(isFlatpak() ? (await runHost('cat', [executable])).stdout : await fsp.readFile(executable, 'utf8'), executable);
    if (!entry || entry.hidden) throw new Error('This desktop entry cannot be launched');
    command = entry.command; args = [...entry.args, ...args]; cwd = entry.workingDir;
    if (entry.terminal) {
      const terminal = await findCommand('x-terminal-emulator') || await findCommand('xterm');
      if (!terminal) throw new Error('Install a terminal or select a non-terminal executable');
      args = ['-e', command, ...args]; command = terminal;
    }
  } else if (executable.startsWith('flatpak:')) {
    const id = executable.slice(8);
    if (!/^[\w-]+(?:\.[\w-]+){2,}$/.test(id)) throw new Error('Invalid Flatpak application ID');
    command = 'flatpak'; args = ['run', id, ...args];
  } else if (/\.exe$/i.test(command)) {
    const wine = await findCommand('wine');
    if (!wine) throw new Error('Use Steam/Proton or install Wine to launch Windows executables');
    args = [command, ...args]; command = wine; cwd = path.dirname(executable);
  } else if (/\.(bat|lnk)$/i.test(command)) {
    throw new Error('Choose the Linux executable or a .desktop shortcut');
  }
  if (!await findCommand(command)) throw new Error(`Executable not found or not executable: ${command}`);
  if (!cwd) cwd = path.isAbsolute(executable) ? path.dirname(executable) : home;
  return { command, args, cwd };
}

function steamCandidates(env = process.env, userHome = home) {
  return [...new Set([
    path.join(userHome, '.steam/steam'), path.join(userHome, '.steam/root'), path.join(userHome, '.local/share/Steam'),
    path.join(env.WPS5_HOST_DATA_HOME || env.XDG_DATA_HOME || path.join(userHome, '.local/share'), 'Steam'),
    path.join(userHome, '.var/app/com.valvesoftware.Steam/.local/share/Steam'),
  ])];
}
function getSteamPath() { return steamCandidates().find(p => fs.existsSync(path.join(p, 'steamapps'))) || null; }

// Exact directory boundaries prevent /Games/Foo from matching /Games/Foobar.
const processProbe = `
dir=$1
for proc in /proc/[0-9]*; do
  pid=\${proc##*/}
  [ "$pid" = "$$" ] && continue
  exe=$(readlink "$proc/exe" 2>/dev/null) || continue
  cwd=$(readlink "$proc/cwd" 2>/dev/null) || cwd=
  case "$exe" in "$dir"/*) printf '%s\\n' "$pid"; continue;; esac
  case "$cwd" in "$dir"|"$dir"/*) printf '%s\\n' "$pid"; continue;; esac
  if tr '\\000' '\\n' < "$proc/cmdline" 2>/dev/null | grep -F -- "$dir/" >/dev/null; then
    printf '%s\\n' "$pid"
  fi
done
`;
async function processesUnderDir(dir) {
  if (!dir || !path.isAbsolute(dir) || path.resolve(dir) === '/') return [];
  try {
    const { stdout } = await runHost('sh', ['-c', processProbe, 'wps5-probe', path.resolve(dir)]);
    return stdout.trim().split(/\s+/).map(Number).filter(pid => Number.isInteger(pid) && pid > 1 && pid !== process.pid);
  } catch { return []; }
}
async function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  if (isFlatpak()) {
    const hostPid = hostChildren.get(pid);
    if (!hostPid) return false;
    try { await runHost('/bin/kill', ['-TERM', '--', `-${hostPid}`]); return true; } catch { return false; }
  }
  try { process.kill(-pid, 'SIGTERM'); return true; } catch { return false; }
}
async function killProcessesUnderDir(dir) {
  const pids = await processesUnderDir(dir);
  if (!pids.length) return false;
  try { await runHost('/bin/kill', ['-TERM', '--', ...pids.map(String)]); return true; } catch { return false; }
}

async function getStorageInfo() {
  const disks = [], devices = new Set();
  let mounts = ['/', home];
  try {
    const content = await fsp.readFile('/proc/self/mounts', 'utf8');
    mounts.push(...content.split('\n').map(l => l.split(' ')).filter(v => /^\/dev\//.test(v[0] || '')).map(v => v[1].replace(/\\040/g, ' ')));
  } catch { /* root/home remain */ }
  for (const mount of mounts) {
    try {
      const st = await fsp.stat(mount), stat = await fsp.statfs(mount);
      if (devices.has(st.dev) || !stat.blocks) continue;
      devices.add(st.dev);
      const size = stat.blocks * stat.bsize, free = stat.bavail * stat.bsize;
      disks.push({ name: mount, percent: Math.round(100 * (size - free) / size),
        freeGB: Math.round(free / 1024 ** 3 * 10) / 10, totalGB: Math.round(size / 1024 ** 3 * 10) / 10 });
    } catch { /* inaccessible mount */ }
  }
  return { success: disks.length > 0, ...disks[0], disks: disks.slice(0, 3) };
}

function rpcs3DataDir(configured) {
  const config = process.env.WPS5_HOST_CONFIG_HOME || process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const candidates = [configured, path.join(config, 'rpcs3'), path.join(home, '.var/app/net.rpcs3.RPCS3/config/rpcs3')];
  if (configured && fs.existsSync(configured) && fs.statSync(configured).isFile()) candidates[0] = path.dirname(configured);
  return candidates.find(p => p && fs.existsSync(path.join(p, 'dev_hdd0'))) || configured;
}

function getPsBatteries(root = '/sys/class/power_supply') {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(root); } catch { return out; }
  for (const name of entries) {
    if (!/sony|ps-controller|dualshock|dualsense/i.test(name)) continue;
    try {
      const read = file => fs.readFileSync(path.join(root, name, file), 'utf8').trim();
      const model = /dualsense|ps-controller/i.test(name) ? 'DualSense' : 'DualShock 4';
      out.push({ vendorId: 0x054c, productId: model === 'DualSense' ? 0x0ce6 : 0x05c4, model,
        battery: Math.min(1, Math.max(0, Number(read('capacity')) / 100)), charging: read('status') === 'Charging', wired: false });
    } catch { /* unavailable battery properties */ }
  }
  return out;
}

function getEpicInstalledGames() {
  const config = process.env.WPS5_HOST_CONFIG_HOME || process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const dirs = [path.join(config, 'legendary'), path.join(config, 'heroic/legendaryConfig/legendary'),
    path.join(home, '.var/app/com.heroicgameslauncher.hgl/config/heroic/legendaryConfig/legendary')];
  const games = [], seen = new Set();
  for (const dir of dirs) {
    try {
      const installed = JSON.parse(fs.readFileSync(path.join(dir, 'installed.json'), 'utf8'));
      for (const [id, data] of Object.entries(installed)) {
        if (seen.has(id) || !data.install_path || !fs.existsSync(data.install_path)) continue;
        seen.add(id);
        games.push({ id: `epic_${id}`, appName: id, title: data.title || id, installLocation: data.install_path,
          launchPath: `heroic://launch/legendary/${encodeURIComponent(id)}`, executable: data.executable || '' });
      }
    } catch { /* Heroic/Legendary is optional */ }
  }
  return games;
}

function winePrefixes(appId) {
  const prefixes = [process.env.WINEPREFIX, path.join(home, '.wine')].filter(Boolean);
  if (/^\d+$/.test(String(appId))) {
    for (const root of steamCandidates()) {
      const libraries = [root];
      try {
        const vdf = fs.readFileSync(path.join(root, 'steamapps/libraryfolders.vdf'), 'utf8');
        for (const match of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) libraries.push(match[1].replace(/\\([\\"])/g, '$1'));
      } catch { /* no libraries */ }
      for (const lib of libraries) prefixes.push(path.join(lib, 'steamapps/compatdata', String(appId), 'pfx'));
    }
  }
  return [...new Set(prefixes)].filter(p => fs.existsSync(path.join(p, 'drive_c')));
}
function achievementSearchPaths(appId) {
  const data = process.env.WPS5_HOST_DATA_HOME || process.env.XDG_DATA_HOME || path.join(home, '.local/share');
  const paths = [{base:path.join(data,'Goldberg SteamEmu Saves'),source:'Goldberg'}, {base:path.join(data,'GSE Saves'),source:'Goldberg (GSE)'}];
  for (const prefix of winePrefixes(appId)) {
    const users = path.join(prefix,'drive_c/users');
    try {
      for (const user of fs.readdirSync(users)) {
        const roaming = path.join(users,user,'AppData/Roaming');
        for (const [folder,source] of [['Goldberg SteamEmu Saves','Goldberg'],['GSE Saves','Goldberg (GSE)'],['Steam/CODEX','Codex'],['Steam/RUNE','RUNE'],['SmartSteamEmu','SmartSteamEmu'],['CreamAPI','CreamAPI']]) paths.push({base:path.join(roaming,folder),source});
        for (const folder of ['Steam/CODEX','Steam/RUNE','OnlineFix']) paths.push({base:path.join(users,user,'Documents',folder),source:folder.split('/').pop()});
      }
    } catch { /* unavailable prefix */ }
  }
  return paths;
}
function parseWineAchievements(text, appId) {
  if (!/^\d+$/.test(String(appId))) return null;
  const sections = new Map(); let current;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\[(.+)\]/);
    if (header) { current = new Map(); sections.set(header[1].replace(/\\\\/g,'/'),current); continue; }
    const value = line.match(/^"([^"]+)"=dword:([0-9a-f]+)/i);
    if (current && value) current.set(value[1],parseInt(value[2],16));
  }
  for (const variant of ['GLR','GL2020']) {
    const base = 'Software/'+variant+'/AppID/'+appId;
    if (sections.get(base)?.get('SkipStatsAndAchievements') !== 0) continue;
    const values = sections.get(base+'/Achievements'); if (!values) continue;
    return new Map([...values].filter(([name])=>!name.endsWith('_Time')).map(([name,state])=>[name.toUpperCase(),{achieved:state===1,unlockTime:values.get(name+'_Time')||0}]));
  }
  return null;
}
function readWineAchievements(appId) {
  for (const prefix of winePrefixes(appId)) {
    try { const result=parseWineAchievements(fs.readFileSync(path.join(prefix,'user.reg'),'utf8'),appId); if(result)return result; } catch { /* absent registry */ }
  }
  return null;
}

async function init() {
  if (!isFlatpak()) return;
  try {
    const { stdout } = await runHost('sh', ['-c', 'printf "%s\\n%s\\n" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"']);
    const [config, data] = stdout.trimEnd().split('\n');
    process.env.WPS5_HOST_CONFIG_HOME = config || path.join(home, '.config');
    process.env.WPS5_HOST_DATA_HOME = data || path.join(home, '.local/share');
  } catch { /* standard XDG locations still work */ }
}
module.exports = { winePrefixes, achievementSearchPaths, parseWineAchievements, readWineAchievements, init, isFlatpak, runHost, cleanEnvironment, spawnExternal, splitArgs, parseDesktop,
  applicationDirs, getInstalledPrograms, detectEmulator, resolveLaunch, steamCandidates, getSteamPath,
  processesUnderDir, killProcessTree, killProcessesUnderDir, getStorageInfo, rpcs3DataDir, getPsBatteries, getEpicInstalledGames };