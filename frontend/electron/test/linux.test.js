'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const linux = require('../linux');
const media = require('../linuxMedia');
const gamepad = require('../linuxGamepad');

const desktop = (exec, extra = '') => `[Desktop Entry]\nType=Application\nName=Example Game\nExec=${exec}\n${extra}`;

test('arguments preserve quoted paths, empty arguments and literal shell characters', () => {
  assert.deepEqual(linux.splitArgs('--rom "/Games/My Game.iso" "" "$(touch /tmp/no)"'), ['--rom','/Games/My Game.iso','','$(touch /tmp/no)']);
  assert.throws(() => linux.splitArgs('"unterminated'), /quote/);
  assert.throws(() => linux.splitArgs('ending\\'), /escape/);
});
test('desktop entries expand localized names, icons and literal percent independently', () => {
  const p = linux.parseDesktop(desktop('"/opt/My Emulator/emulator" %i %c %k %% %F', 'Name[es]=Mi Juego\nIcon=game\nPath=/Games'), '/apps/game.desktop', { locale: 'es_AR.UTF-8' });
  assert.equal(p.name, 'Mi Juego');
  assert.equal(p.command, '/opt/My Emulator/emulator');
  assert.deepEqual(p.args, ['--icon','game','Mi Juego','/apps/game.desktop','%']);
  assert.equal(p.workingDir, '/Games');
});
test('hidden, unsupported and desktop-specific entries are handled safely', () => {
  assert.equal(linux.parseDesktop(desktop('game', 'Hidden=true'), '/g.desktop').hidden, true);
  assert.equal(linux.parseDesktop(desktop('game', 'OnlyShowIn=KDE;'), '/g.desktop', { desktop: 'GNOME' }).hidden, true);
  assert.equal(linux.parseDesktop(desktop('game', 'OnlyShowIn=KDE;'), '/g.desktop', { desktop: 'KDE' }).command, 'game');
  assert.throws(() => linux.parseDesktop(desktop('game %z'), '/g.desktop'), /field code/);
});
test('desktop action sections do not replace the primary command', () => {
  const p = linux.parseDesktop(desktop('main', '[Desktop Action Other]\nExec=other\nName=Other'), '/g.desktop');
  assert.equal(p.command, 'main');
});
test('AppImage/Electron runtime variables do not leak into external games', () => {
  assert.deepEqual(linux.cleanEnvironment({ PATH:'/usr/bin', APPIMAGE:'/launcher', APPDIR:'/tmp/mount', LD_LIBRARY_PATH:'/launcher/lib', LD_PRELOAD:'/inject', ELECTRON_RUN_AS_NODE:'1', WINEPREFIX:'/games/prefix' }), { PATH:'/usr/bin', WINEPREFIX:'/games/prefix' });
});
test('Steam detection covers XDG, native and Flatpak installations', () => {
  const roots=linux.steamCandidates({XDG_DATA_HOME:'/custom/data'}, '/home/test');
  assert.ok(roots.includes(path.join('/custom/data','Steam')));
  assert.ok(roots.includes(path.join('/home/test','.local/share/Steam')));
  assert.ok(roots.includes(path.join('/home/test','.var/app/com.valvesoftware.Steam/.local/share/Steam')));
});
test('MPRIS metadata converts microseconds and capability variants', () => {
  const v=value=>({value});
  const result=media.normalize('org.mpris.MediaPlayer2.test', {Identity:v('Music')}, {
    Metadata:v({'xesam:title':v('Song'),'xesam:artist':v(['Artist']), 'mpris:length':v(3000000n)}),
    PlaybackStatus:v('Playing'), Position:v(1000000n), CanPlay:v(true), CanGoNext:v(false)
  });
  assert.equal(result.title, 'Song'); assert.equal(result.playbackStatus, 'playing');
  assert.deepEqual(result.timeline,{positionMs:1000,durationMs:3000});
  assert.equal(result.controls.canPlay,true); assert.equal(result.controls.canSkipNext,false);
});
test('evdev combinations distinguish button presses and analog triggers', () => {
  assert.equal(gamepad.matches('SELECT_START',new Set([314,315]),new Map()),true);
  assert.equal(gamepad.matches('SELECT_START',new Set([314]),new Map()),false);
  assert.equal(gamepad.matches('L3_R3',new Set([317,318]),new Map()),true);
  assert.equal(gamepad.matches('L2_R2_START',new Set([315]),new Map([[2,150],[5,150]])),true);
  assert.equal(gamepad.matches('L2_R2_START',new Set([315]),new Map([[2,0],[5,150]])),false);
});
test('evdev capability detection excludes keyboards', () => {
  assert.equal(gamepad.hasGamepadButtons((1n<<304n).toString(16)),true);
  assert.equal(gamepad.hasGamepadButtons('0 0 1'),false);
});
test('controller batteries are read from kernel sysfs without altering HID mode', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wps5-battery-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'ps-controller-battery-test'));
  await fs.writeFile(path.join(dir,'ps-controller-battery-test/capacity'),'70');
  await fs.writeFile(path.join(dir,'ps-controller-battery-test/status'),'Charging');
  assert.equal(linux.getPsBatteries(dir)[0].battery,0.7);
  assert.equal(linux.getPsBatteries(dir)[0].charging,true);
});
test('user Hidden entries mask system apps and desktop identities are unique', {skip:process.platform!=='linux'}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wps5-desktop-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const user=path.join(dir,'user'),system=path.join(dir,'system');
  await fs.mkdir(user);await fs.mkdir(system);
  await fs.writeFile(path.join(user,'masked.desktop'),desktop('/bin/true','Hidden=true'));
  await fs.writeFile(path.join(system,'masked.desktop'),desktop('/bin/true'));
  await fs.writeFile(path.join(system,'game.desktop'),desktop('/bin/true'));
  const apps=await linux.getInstalledPrograms([user,system]);
  assert.equal(apps.length,1); assert.ok(apps[0].path.endsWith('game.desktop'));
});
test('native and Flatpak emulator launches preserve ROM arguments', {skip:process.platform!=='linux'}, async()=>{
  const native=await linux.resolveLaunch('/bin/true','"/Games/My Game.iso"');
  assert.deepEqual(native.args,['/Games/My Game.iso']);
  if (await linux.detectEmulator(['definitely-not-an-emulator'])) assert.fail('Unexpected detection');
  await assert.rejects(linux.resolveLaunch('/bin/not-present'),'Executable');
  await assert.rejects(linux.resolveLaunch('flatpak:invalid'),'Invalid Flatpak');
});
test('process tracking distinguishes neighboring game directories and closes its process group', {skip:process.platform!=='linux'}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wps5-process-'));
  await fs.mkdir(path.join(dir,'Game')); await fs.mkdir(path.join(dir,'GameOther'));
  const child=spawn('/bin/sleep',['30'],{cwd:path.join(dir,'Game'),detached:true,stdio:'ignore'});
  await once(child,'spawn');
  t.after(async()=>{try{process.kill(-child.pid,'SIGKILL');}catch{} await fs.rm(dir,{recursive:true,force:true});});
  assert.ok((await linux.processesUnderDir(path.join(dir,'Game'))).includes(child.pid));
  assert.equal((await linux.processesUnderDir(path.join(dir,'GameOther'))).includes(child.pid),false);
  const closed=once(child,'close');
  assert.equal(await linux.killProcessTree(child.pid),true); await closed;
  assert.equal((await linux.processesUnderDir(path.join(dir,'Game'))).includes(child.pid),false);
  assert.deepEqual(await linux.processesUnderDir('/'),[]);
  assert.equal(await linux.killProcessTree(0),false);
});
test('storage reports real Linux free space', {skip:process.platform!=='linux'}, async()=>{
  const result=await linux.getStorageInfo(); assert.equal(result.success,true);
  assert.ok(result.disks[0].totalGB>0); assert.ok(result.disks[0].freeGB>=0);
});
test('Wine registry achievement data preserves unlock times and honors opt-out', () => {
  const text = String.raw`[Software\\GLR\\AppID\\123]
"SkipStatsAndAchievements"=dword:00000000
[Software\\GLR\\AppID\\123\\Achievements]
"FIRST"=dword:00000001
"FIRST_Time"=dword:000000ff
`;
  const result = linux.parseWineAchievements(text,123);
  assert.deepEqual(result.get('FIRST'),{achieved:true,unlockTime:255});
  assert.equal(linux.parseWineAchievements(text.replace('"SkipStatsAndAchievements"=dword:00000000','"SkipStatsAndAchievements"=dword:00000001'),123),null);
});
