'use strict';
// MPRIS works with PipeWire/PulseAudio players through the session D-Bus.
let bus;
function getBus() {
  if (!bus) {
    bus = require('dbus-next').sessionBus();
    bus.on('error', error => console.warn('[MPRIS]', error.message));
  }
  return bus;
}
const unwrap = v => v && typeof v === 'object' && 'value' in v ? v.value : v;
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const ROOT = 'org.mpris.MediaPlayer2';

async function playerNames() {
  const proxy = await getBus().getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
  const names = await proxy.getInterface('org.freedesktop.DBus').ListNames();
  return names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));
}
function normalize(name, root, props) {
  const meta = unwrap(props.Metadata) || {};
  const value = key => unwrap(meta[key]);
  const artists = value('xesam:artist');
  return {
    id: name, sourceAppUserModelId: name,
    sourceAppDisplayName: unwrap(root.Identity) || name.slice('org.mpris.MediaPlayer2.'.length),
    title: value('xesam:title') || '', artist: Array.isArray(artists) ? artists.join(', ') : '',
    albumTitle: value('xesam:album') || '', thumbnail: value('mpris:artUrl'),
    playbackStatus: String(unwrap(props.PlaybackStatus) || 'Stopped').toLowerCase(),
    timeline: { positionMs: Number(unwrap(props.Position) || 0) / 1000, durationMs: Number(value('mpris:length') || 0) / 1000 },
    controls: { canPlay: Boolean(unwrap(props.CanPlay)), canPause: Boolean(unwrap(props.CanPause)),
      canSkipNext: Boolean(unwrap(props.CanGoNext)), canSkipPrevious: Boolean(unwrap(props.CanGoPrevious)) },
  };
}
async function getSessions() {
  try {
    const names = await playerNames();
    const settled = await Promise.allSettled(names.map(async name => {
      const proxy = await getBus().getProxyObject(name, '/org/mpris/MediaPlayer2');
      const properties = proxy.getInterface('org.freedesktop.DBus.Properties');
      const [root, props] = await Promise.all([properties.GetAll(ROOT), properties.GetAll(PLAYER)]);
      return normalize(name, root, props);
    }));
    return settled.filter(r => r.status === 'fulfilled').map(r => r.value);
  } catch { return []; }
}
async function control(action, target = {}) {
  const method = { play_pause: 'PlayPause', next: 'Next', prev: 'Previous' }[action];
  if (!method) return { success: false, error: 'Unknown media action' };
  try {
    const names = await playerNames();
    const requested = target.id || target.sourceAppUserModelId;
    const name = requested ? names.find(n => n === requested) : names[0];
    if (!name) return { success: false, error: 'Media player no longer available' };
    const proxy = await getBus().getProxyObject(name, '/org/mpris/MediaPlayer2');
    await proxy.getInterface(PLAYER)[method]();
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}
function shutdown() { if (bus) bus.disconnect(); bus = null; }
module.exports = { getSessions, control, normalize, shutdown };