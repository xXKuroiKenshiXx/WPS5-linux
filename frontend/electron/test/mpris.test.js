'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const media=require('../linuxMedia');
test('MPRIS reads and controls a player over a real session bus', {skip:!process.env.DBUS_SESSION_BUS_ADDRESS}, async t=>{
  const dbus=require('dbus-next');
  const {Interface,ACCESS_READ}=dbus.interface;
  class Root extends Interface { constructor(){super('org.mpris.MediaPlayer2');this.Identity='WPS5 test player';} }
  Root.configureMembers({properties:{Identity:{signature:'s',access:ACCESS_READ}}});
  class Player extends Interface {
    constructor(){super('org.mpris.MediaPlayer2.Player');this.PlaybackStatus='Playing';this.Position=1000000n;
      this.Metadata={'xesam:title':new dbus.Variant('s','Test song'),'xesam:artist':new dbus.Variant('as',['Test artist']),'mpris:length':new dbus.Variant('x',5000000n)};
      this.CanPlay=true;this.CanPause=true;this.CanGoNext=true;this.CanGoPrevious=true;this.calls=[];
    }
    PlayPause(){this.calls.push('pause');} Next(){this.calls.push('next');} Previous(){this.calls.push('previous');}
  }
  Player.configureMembers({properties:Object.fromEntries(Object.entries({PlaybackStatus:'s',Position:'x',Metadata:'a{sv}',CanPlay:'b',CanPause:'b',CanGoNext:'b',CanGoPrevious:'b'}).map(([key,signature])=>[key,{signature,access:ACCESS_READ}])),methods:Object.fromEntries(['PlayPause','Next','Previous'].map(key=>[key,{inSignature:'',outSignature:''}]))});
  const bus=dbus.sessionBus();const player=new Player();
  t.after(()=>{media.shutdown();bus.disconnect();});
  bus.export('/org/mpris/MediaPlayer2',new Root());bus.export('/org/mpris/MediaPlayer2',player);
  const id=`org.mpris.MediaPlayer2.wps5_test_${process.pid}`;
  await bus.requestName(id,0);
  const sessions=await media.getSessions();const session=sessions.find(s=>s.id===id);
  assert.ok(session);assert.equal(session.title,'Test song');assert.equal(session.timeline.durationMs,5000);
  for(const action of ['play_pause','next','prev']) assert.equal((await media.control(action,{id})).success,true);
  assert.deepEqual(player.calls,['pause','next','previous']);
  assert.equal((await media.control('next',{id:'org.mpris.MediaPlayer2.missing'})).success,false);
});