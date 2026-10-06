'use strict';
// Run on Linux after packaging. Root-only --no-sandbox is confined to this test.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const assert=require('node:assert/strict');
(async()=>{
  const frontend=path.resolve(__dirname,'..');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wps5-smoke-'));
  const bin=process.argv[2]||path.join(frontend,'dist-electron/linux-unpacked/wps5-linux');
  const root=process.getuid()===0;
  const port=47822;
  const args=[bin,...(root?['--no-sandbox']:[]),'--remote-debugging-port='+port];
  const child=spawn('xvfb-run',['-a','-s','-screen 0 1920x1080x24',...args],{detached:true,env:{...process.env,XDG_CONFIG_HOME:path.join(dir,'config'),STORE_API_PORT:'3000'},stdio:['ignore','pipe','pipe']});
  let logs='',ws;
  child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  try{
    let pages;
    for(let i=0;i<120;i++){
      try{pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(pages.some(p=>p.type==='page'&&p.url.includes('47821')))break;}catch{}
      if(child.exitCode!==null)throw Error('Launcher exited: '+logs);
      await new Promise(r=>setTimeout(r,250));
    }
    const page=pages?.find(p=>p.type==='page'&&p.url.includes('47821'));assert.ok(page,'Packaged UI did not load: '+logs);
    ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');
    let id=0;const pending=new Map();
    ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}});
    const send=(method,params={})=>new Promise((resolve,reject)=>{const seq=++id;pending.set(seq,resolve);ws.send(JSON.stringify({id:seq,method,params}));setTimeout(()=>{if(pending.delete(seq))reject(Error('CDP timeout: '+method));},20000).unref();});
    const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.result?.exceptionDetails)throw Error(JSON.stringify(response.result.exceptionDetails));return response.result.result.value;};
    let api;
    for(let i=0;i<60;i++){api=await evaluate('Boolean(window.electronAPI)');if(api)break;await new Promise(r=>setTimeout(r,250));}
    assert.equal(api,true,'Preload API must be available');
    const result=await evaluate(`(async()=>({platform:window.electronAPI.platform, storage:await window.electronAPI.getStorageInfo(),programs:await window.electronAPI.getInstalledPrograms(),apps:await window.electronAPI.getApps(),batteries:await window.electronAPI.getPsBatteries(),media:await window.electronAPI.getMediaSessions()}))()`);
    assert.equal(result.platform,'linux');assert.equal(result.storage.success,true);assert.equal(result.programs.success,true);assert.ok(Array.isArray(result.media));assert.ok(result.apps);
    if(process.env.SMOKE_EXPECT_PROGRAM) assert.ok(result.programs.programs.some(p=>p.name===process.env.SMOKE_EXPECT_PROGRAM),'Host user desktop entry must be discoverable from the package');
    const failure=await evaluate(`window.electronAPI.launchApp(null,'/definitely/missing/wps5-game')`);assert.equal(failure.success,false);
    const launch=await evaluate(`window.electronAPI.launchApp(null,'/bin/sleep','"2"')`);assert.equal(launch.success,true);
    await new Promise(r=>setTimeout(r,4000));
    const active=await evaluate('window.electronAPI.getActiveGameInfo()');assert.equal(active,null);
    const backend=await fetch('http://127.0.0.1:3000/');assert.equal(backend.status,404);
    await new Promise(r=>setTimeout(r,7000));
    const shot=await send('Page.captureScreenshot',{format:'png'});
    const output=path.join(frontend,'dist-electron/linux-smoke.png');await fs.writeFile(output,Buffer.from(shot.result.data,'base64'));
    const report={platform:result.platform,programs:result.programs.programs.length,storage:result.storage.disks,launchAndReturn:true,backend:true,screenshot:output};
    await fs.writeFile(path.join(frontend,'dist-electron/linux-smoke.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }finally{
    if(ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({id:999999,method:'Runtime.evaluate',params:{expression:'window.electronAPI.closeApp()'}})); await new Promise(r=>setTimeout(r,1000)); }
    if(ws)ws.close();try{process.kill(-child.pid,'SIGTERM');}catch{}
    await new Promise(r=>setTimeout(r,500));
    try{process.kill(-child.pid,'SIGKILL');}catch{}
    child.stdout.destroy();child.stderr.destroy();child.unref();
    await fs.writeFile(path.join(frontend,'dist-electron/linux-smoke.log'),logs);
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});