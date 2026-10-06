'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Linux evdev button codes are independent of the controller's vendor.
const combos = { SELECT_START: [314, 315], L3_R3: [317, 318], L1_R1: [310, 311], L2_R2_START: [312, 313, 315] };
function matches(combo, buttons, axes) {
  const required = combos[combo] || combos.SELECT_START;
  return required.every(code => buttons.has(code) || (code === 312 && ((axes.get(2) || 0) > 80 || (axes.get(10) || 0) > 80))
    || (code === 313 && ((axes.get(5) || 0) > 80 || (axes.get(9) || 0) > 80)));
}
function hasGamepadButtons(mask) {
  const bits = BigInt('0x' + mask.trim().split(/\s+/).join(''));
  return Boolean(bits & (1n << 304n)); // BTN_GAMEPAD / BTN_SOUTH
}
function start(combo, onTrigger) {
  const devices = new Map();
  const size = process.arch === 'ia32' || process.arch === 'arm' ? 16 : 24;
  let lastTrigger = 0, stopped = false;
  function scan() {
    if (stopped) return;
    let names;
    try { names = fs.readdirSync('/sys/class/input'); } catch { return; }
    for (const name of names.filter(n => /^event\d+$/.test(n))) {
      if (devices.has(name)) continue;
      try {
        if (!hasGamepadButtons(fs.readFileSync(`/sys/class/input/${name}/device/capabilities/key`, 'utf8'))) continue;
        const fd = fs.openSync(path.join('/dev/input', name), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        devices.set(name, { fd, buttons: new Set(), axes: new Map(), matched: false, buffer: Buffer.alloc(size * 64) });
      } catch { /* only devices accessible to this user/session */ }
    }
  }
  function poll() {
    for (const [name, device] of devices) {
      try {
        const length = fs.readSync(device.fd, device.buffer, 0, device.buffer.length, null);
        if (!length) { fs.closeSync(device.fd); devices.delete(name); continue; }
        for (let offset = 0; offset + size <= length; offset += size) {
          const type = device.buffer.readUInt16LE(offset + size - 8);
          const code = device.buffer.readUInt16LE(offset + size - 6);
          const value = device.buffer.readInt32LE(offset + size - 4);
          if (type === 1) { if (value) device.buttons.add(code); else device.buttons.delete(code); }
          if (type === 3) device.axes.set(code, value);
          const active = matches(combo, device.buttons, device.axes);
          if (active && !device.matched && Date.now() - lastTrigger > 600) { lastTrigger = Date.now(); onTrigger(); }
          device.matched = active;
        }
      } catch (error) {
        if (error.code !== 'EAGAIN') { try { fs.closeSync(device.fd); } catch {} devices.delete(name); }
      }
    }
  }
  scan();
  const scanner = setInterval(scan, 3000), poller = setInterval(poll, 25);
  return () => {
    stopped = true; clearInterval(scanner); clearInterval(poller);
    for (const device of devices.values()) { try { fs.closeSync(device.fd); } catch {} }
    devices.clear();
  };
}
module.exports = { start, matches, hasGamepadButtons };