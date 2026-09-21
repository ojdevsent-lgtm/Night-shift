import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/PointerLockControls.js';

const $=id=>document.getElementById(id);
const storeKey='nightShiftSaveV1';
const defaults={night:1,completed:0,master:.75,sfx:.8,sens:1,quality:'low',shadows:false,shake:true,docs:[],endings:[]};
let save=Object.assign({},defaults,JSON.parse(localStorage.getItem(storeKey)||'{}'));
function persist(){localStorage.setItem(storeKey,JSON.stringify(save))}

const scene=new THREE.Scene(); scene.background=new THREE.Color(0x020506); scene.fog=new THREE.FogExp2(0x060909,.035);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.05,150);
const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,save.quality==='high'?1.5:1));
renderer.setSize(innerWidth,innerHeight); renderer.shadowMap.enabled=save.shadows; $('game').appendChild(renderer.domElement);
const controls=new PointerLockControls(camera,renderer.domElement); camera.position.set(0,1.65,7);
const clock=new THREE.Clock();
const keys={}; let running=false, paused=false, cctvOpen=false, flashlightOn=true, battery=100, power=100, elapsed=0, night=1;
let yawVelocity=0, pitchVelocity=0, eventTimer=25, generatorHealth=1, generatorFixes=0, camerasChecked=0, eventsSeen=0, batteriesUsed=0, entityState='roam';
const velocity=new THREE.Vector3(), direction=new THREE.Vector3();
const colliders=[], interactables=[], batteries=[], doors=[], docs=[], camPoints=[], lights=[];
let entity=null, entityTarget=new THREE.Vector3(), entityCooldown=0, lastMoveNoise=0, generatorStep=0;
let audioCtx=null, masterGain=null, sfxGain=null;

function audioInit(){if(audioCtx)return;audioCtx=new AudioContext();masterGain=audioCtx.createGain();sfxGain=audioCtx.createGain();masterGain.gain.value=save.master;sfxGain.gain.value=save.sfx;sfxGain.connect(masterGain);masterGain.connect(audioCtx.destination)}
function tone(freq,dur,type='sine',gain=.025){audioInit();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.value=gain;o.connect(g);g.connect(sfxGain);o.start();g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+dur);o.stop(audioCtx.currentTime+dur)}
function noise(dur=.15,gain=.02){audioInit();const b=audioCtx.createBuffer(1,audioCtx.sampleRate*dur,audioCtx.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);const s=audioCtx.createBufferSource(),g=audioCtx.createGain();s.buffer=b;g.gain.value=gain;s.connect(g);g.connect(sfxGain);s.start()}
function msg(t,ms=3500){$('message').textContent=t;clearTimeout(msg.t);msg.t=setTimeout(()=>$('message').textContent='',ms)}

function mat(color,rough=1){return new THREE.MeshStandardMaterial({color,roughness:rough,metalness:.05})}
const M={wall:mat(0x343a38),floor:mat(0x252b2a),dark:mat(0x111615),metal:mat(0x515a57,.65),wood:mat(0x3b3028),red:mat(0x7d2522),paper:mat(0xb9b3a0),black:mat(0x030505),green:mat(0x4b6558),white:mat(0xb8c0bc)};
function box(name,x,y,z,w,h,d,material=M.wall,cast=false){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.name=name;m.position.set(x,y,z);m.castShadow=cast;m.receiveShadow=true;scene.add(m);if(material!==M.paper&&h>1.5)colliders.push(new THREE.Box3().setFromObject(m));return m}
function floor(x,z,w,d){box('floor',x,-.08,z,w,.16,d,M.floor);box('ceiling',x,3.15,z,w,.16,d,M.dark)}
function wall(x,y,z,w,h,d){return box('wall',x,y,z,w,h,d,M.wall)}
function light(x,y,z,color=0xdde8df,intensity=1.2,dist=9){const l=new THREE.PointLight(color,intensity,dist);l.position.set(x,y,z);l.castShadow=save.shadows;l.userData.base=intensity;scene.add(l);lights.push(l);return l}
function door(x,z,rot=0,label='Door'){const m=box(label,x,1.35,z,.16,2.7,1.2,M.wood);m.rotation.y=rot;m.userData.closed=true;m.userData.openRot=rot+Math.PI/2;m.userData.interact=()=>{m.userData.closed=!m.userData.closed;m.rotation.y=m.userData.closed?rot:m.userData.openRot;tone(120,.12,'square');};interactables.push({obj:m,range:2.2,text:'[E] '+label,action:m.userData.interact});doors.push(m);return m}
function battery(x,y,z){const m=box('battery',x,y,z,.22,.35,.12,M.green);m.userData.interact=()=>{battery=Math.min(100,battery+28);batteriesUsed++;m.visible=false;tone(480,.12);msg('Battery recovered.');};interactables.push({obj:m,range:1.8,text:'[E] Pick up battery',action:m.userData.interact});batteries.push(m)}
function documentObj(x,z,title,text){const m=box('document',x,.45,z,.35,.03,.5,M.paper);m.userData.interact=()=>openDocument(title,text);interactables.push({obj:m,range:1.7,text:'[E] Read '+title,action:m.userData.interact});docs.push(m)}
function openDocument(title,text){if(!save.docs.includes(title)){save.docs.push(title);persist()}showModal(title,'<div class="doc"><p>'+text.replaceAll('<','&lt;')+'</p></div>',[['CLOSE',closeModal]])}
function addRoom(cx,cz,w,d){floor(cx,cz,w,d);wall(cx-w/2,1.5,cz,0.2,3,w?d:1);wall(cx+w/2,1.5,cz,0.2,3,d);wall(cx,1.5,cz-d/2,w,3,.2);wall(cx,1.5,cz+d/2,w,3,.2)}
function buildFacility(){
  floor(0,0,42,32);
  wall(-21,1.5,0,.3,3,32);wall(21,1.5,0,.3,3,32);wall(0,1.5,-16,42,3,.3);wall(0,1.5,16,42,3,.3);
  // central corridors and room partitions
  wall(-9,1.5,-9,24,.25,.2);wall(9,1.5,9,24,.25,.2);wall(-9,1.5,9,.2,3,14);wall(9,1.5,-9,.2,3,14);
  wall(-2,1.5,0,.2,3,18);wall(2,1.5,0,.2,3,18);
  for(const x of [-17,-12,-7,7,12,17])light(x,2.75,0,0xdce7df,.8,8);
  for(const z of [-12,-6,6,12])light(0,2.7,z,0xdce7df,.7,8);
  // red emergency lights
  for(const p of [[-19,-13],[19,-13],[-19,13],[19,13]])light(p[0],2.5,p[1],0xff3328,.45,7);
  door(-2,-8,0,'Security Office');door(2,8,Math.PI/2,'Basement Door');door(-9,0,Math.PI/2,'Reception Door');door(9,0,Math.PI/2,'Archive Door');
  // furniture
  box('desk',-14,.55,-11,4,1,1.5,M.wood,true);const monitor=box('monitor',-14,1.45,-11,.9,.6,.15,M.black);monitor.userData.interact=()=>openCCTV();interactables.push({obj:monitor,range:2.4,text:'[E] Use security monitor',action:monitor.userData.interact});const radio=box('radio',-12.8,1.2,-11,.45,.25,.3,M.metal);radio.userData.interact=()=>{noise(.55,.03);msg(['RADIO: All clear on the east wing.','RADIO: …there is someone on Camera 06.','RADIO: Do not answer the phone.'][Math.floor(Math.random()*3)],5000)};interactables.push({obj:radio,range:1.8,text:'[E] Use radio',action:radio.userData.interact});const phone=box('phone',-15.2,1.2,-11,.32,.12,.5,M.black);phone.userData.interact=()=>{tone(430,.15);showModal('INCOMING CALL','<p>“Are you still inside?”</p><p class="small">The line goes dead before you can answer.</p>',[['CLOSE',closeModal]])};interactables.push({obj:phone,range:1.8,text:'[E] Answer phone',action:phone.userData.interact});
  const generator=box('generator',15,1.1,11,2.4,2,1.4,M.metal,true);generator.userData.interact=()=>{if(generatorHealth>=1){msg('Generator is stable.');return}generatorStep++;tone(160+generatorStep*70,.1,'square');if(generatorStep<3)msg('Electrical repair: switch '+generatorStep+'/3.');else{generatorHealth=1;generatorStep=0;generatorFixes++;msg('Generator stabilized. Power is returning.',4500);tone(520,.3)}};interactables.push({obj:generator,range:2.5,text:'[E] Repair generator',action:generator.userData.interact});light(15,2.3,11,0xff7d44,.5,5);
  for(let i=0;i<8;i++)box('crate',-15+(i%4)*2,.7,10+Math.floor(i/4)*2,1.2,1.4,1.2,M.wood,true);
  // server racks
  for(let i=0;i<5;i++){box('server',11+i*1.3,1.2,-11,1,2.2,1.2,M.metal,true);light(11+i*1.3,1.8,-10.2,0x3377aa,.25,2)}
  battery(-10,.25,-5);battery(14,.25,4);battery(-15,.25,8);battery(16,.25,-7);
  documentObj(-13,-10,'SHIFT LOG 01','11:00 PM — Routine shift.\nMaintenance reports a recurring power fault in the lower electrical circuit.\nThe previous guard wrote: “If the lights go out, wait. Do not investigate alone.”');
  documentObj(13,-10,'INCIDENT REPORT','02:14 AM — Camera 06 recorded movement in the generator corridor. No employee was scheduled downstairs.\nFootage was overwritten before morning review.');
  documentObj(-14,12,'HANDWRITTEN NOTE','“It knows when you are watching.”\n“Do not trust the phone.”\n“06 is not a camera number. It is a warning.”');
  // stairs
  for(let i=0;i<8;i++)box('step',-5+i*.55,.15+i*.18,14,.5,.3,2,M.metal);
  // camera points
  const pts=[[-14,2.2,-13],[0,2.2,-6],[12,2.2,-10],[12,2.2,8],[14,2.2,13],[-16,2.2,12],[16,2.2,-2],[0,2.2,13]];
  pts.forEach(p=>{const o=new THREE.Object3D();o.position.set(...p);o.lookAt(0,1,0);scene.add(o);camPoints.push(o)});
}
function makeEntity(){
  const g=new THREE.Group();g.name='THE ENTITY';
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.42,1.35,3,6),M.black);body.position.y=1.15;g.add(body);
  const head=new THREE.Mesh(new THREE.IcosahedronGeometry(.48,1),M.black);head.position.y=2.1;head.scale.set(.65,1.35,.65);g.add(head);
  const armGeo=new THREE.CapsuleGeometry(.12,1.4,2,5);
  for(const s of [-1,1]){const a=new THREE.Mesh(armGeo,M.black);a.position.set(s*.58,1.25,0);a.rotation.z=s*.12;g.add(a)}
  const legGeo=new THREE.CapsuleGeometry(.15,1.15,2,5);
  for(const s of [-1,1]){const l=new THREE.Mesh(legGeo,M.black);l.position.set(s*.22,.35,0);g.add(l)}
  const eye=mat(0x111111);for(const s of [-1,1]){const e=new THREE.Mesh(new THREE.SphereGeometry(.045,6,4),eye);e.position.set(s*.13,2.15,-.43);g.add(e)}
  g.position.set(16,0,-2);g.visible=false;scene.add(g);return g
}
function nearestOpenTarget(){const options=[[16,-2],[15,11],[-14,-11],[0,-6],[-16,12],[12,-10],[0,13]];return options[Math.floor(Math.random()*options.length)]}
function updateEntity(dt){
  if(!entity||!running)return;
  entityCooldown-=dt;
  const dist=entity.position.distanceTo(camera.position);
  const playerLight=flashlightOn&&battery>5;
  if(entityCooldown<=0){
    entityCooldown=8+Math.random()*14;
    const roll=Math.random();
    if(dist<9 && roll<(.24+night*.025)) entityState='hunt';
    else if(roll<.45) entityState='observe';
    else if(roll<.75) entityState='roam';
    else entityState='retreat';
    if(entityState==='observe'){const p=camera.position.clone();p.y=0;entityTarget.copy(p);msg('Something moves somewhere nearby.')}
    else {const t=nearestOpenTarget();entityTarget.set(t[0],0,t[1])}
  }
  let speed=entityState==='hunt'?(0.8+night*.08):entityState==='roam'?.38:.22;
  if(playerLight&&entityState==='hunt'&&dist<12) speed*=.35;
  if(entityState==='retreat')speed=.7;
  const d=entityTarget.clone().sub(entity.position);d.y=0;
  if(d.length()>1){d.normalize();entity.position.addScaledVector(d,speed*dt);entity.lookAt(entity.position.clone().add(d))}
  entity.position.y=Math.sin(performance.now()*.003)*.015;
  if(dist<1.15&&entityState==='hunt'){die();return}
  if(dist<8&&entity.visible&&Math.random()<dt*.02){tone(55,.5,'sawtooth',.05)}
  // visibility: entity prefers uncertainty
  if(entityState==='observe'&&playerLight&&dist<14){entity.visible=false;entityState='retreat'}
  else if(dist<18&&Math.random()<dt*.12)entity.visible=true;
  else if(dist>18)entity.visible=false;
}
function randomEvent(){
  if(!running)return;
  eventsSeen++;const r=Math.random();
  if(r<.16){msg('A fluorescent tube snaps somewhere in the facility.');lights[Math.floor(Math.random()*lights.length)].intensity=0;tone(70,.35,'square')}
  else if(r<.29){msg('A door closes in the distance.');const d=doors[Math.floor(Math.random()*doors.length)];d.userData.closed=true;tone(90,.18,'square')}
  else if(r<.4){msg('The phone rings in the security office.');tone(430,.2);setTimeout(()=>tone(360,.2),260)}
  else if(r<.51){msg('RADIO: “…repeat… do not enter the lower corridor…”');noise(.7,.035)}
  else if(r<.62){msg('CCTV signal interference detected.');noise(.4,.03)}
  else if(r<.73){msg('A metal object falls somewhere nearby.');tone(120,.12,'square');setTimeout(()=>noise(.2,.03),150)}
  else if(r<.84){generatorHealth=Math.max(0,generatorHealth-.25);msg('GENERATOR FAULT — basement repair required.');}
  else {const t=nearestOpenTarget();entity.visible=true;entity.position.set(t[0],0,t[1]);msg('CAMERA MOTION ALERT.');tone(180,.4,'sawtooth',.04)}
}
function updatePower(dt){power=Math.max(0,power-dt*(.105+night*.018+(cctvOpen?.045:0)));if(power<25){lights.forEach(l=>l.intensity=l.userData.base*(.35+power/100));}if(power<=0){lights.forEach(l=>l.intensity=0);if(Math.random()<dt*.1)msg('TOTAL POWER LOSS.')}if(generatorHealth<=0){power=Math.max(0,power-dt*.09);if(Math.random()<dt*.035)msg('The generator is failing. Find it in the basement.')}}
function updateFlashlight(dt){if(flashlightOn){battery=Math.max(0,battery-dt*.45);if(battery<=0)flashlightOn=false;}}
function interact(){
  let best=null,bd=Infinity;
  for(const i of interactables){if(!i.obj.visible)continue;const d=i.obj.position.distanceTo(camera.position);if(d<i.range&&d<bd){bd=d;best=i}}
  if(best){best.action();return true}return false
}
function doMove(dt){direction.set(Number(keys.KeyD)-Number(keys.KeyA),0,Number(keys.KeyS)-Number(keys.KeyW));if(direction.lengthSq()>0){direction.normalize();const speed=keys.ShiftLeft||keys.ShiftRight?4.3:2.7;velocity.x=direction.x*speed;velocity.z=direction.z*speed;const old=camera.position.clone();controls.moveRight(velocity.x*dt);controls.moveForward(-velocity.z*dt);if(camera.position.x<-20||camera.position.x>20||camera.position.z<-15||camera.position.z>15){camera.position.copy(old)}lastMoveNoise=1}else{velocity.multiplyScalar(.8);lastMoveNoise=0}}
function updatePrompt(){let best=null,bd=Infinity;for(const i of interactables){if(!i.obj.visible)continue;const d=i.obj.position.distanceTo(camera.position);if(d<i.range&&d<bd){bd=d;best=i}}$('prompt').textContent=best?best.text:''}
function flashlight(){flashlightOn=!flashlightOn&&battery>0?true:false;if(!flashlightOn&&battery>0)flashlightOn=true}
let flashlightLight;
function setupFlashlight(){flashlightLight=new THREE.SpotLight(0xeef3ed,2.7,16,Math.PI/7,.45,1.4);flashlightLight.position.set(0,0,0);flashlightLight.target.position.set(0,0,-1);camera.add(flashlightLight);camera.add(flashlightLight.target)}
function updateLight(){flashlightLight.visible=flashlightOn;flashlightLight.intensity=battery<20?1.2:2.7;flashlightLight.position.set(0,.05,0)}
function openCCTV(){
  if(!running)return;cctvOpen=!cctvOpen;$('cctv').classList.toggle('hidden',!cctvOpen);if(cctvOpen){controls.unlock();camerasChecked++;power=Math.max(0,power-1.5);renderCCTV(0)}else{$('game').appendChild(renderer.domElement);controls.lock()}
}
function renderCCTV(i){
  const cp=camPoints[i];if(!cp)return;$('camTitle').textContent=['CAM 01 — RECEPTION','CAM 02 — CORRIDOR','CAM 03 — OFFICES','CAM 04 — ARCHIVE','CAM 05 — BASEMENT','CAM 06 — GENERATOR','CAM 07 — STORAGE','CAM 08 — STAIRWELL'][i];
  const v=new THREE.Scene();v.background=new THREE.Color(0x030505);const c=new THREE.PerspectiveCamera(65,1.8,.1,100);c.position.copy(cp.position);c.quaternion.copy(cp.quaternion);const oldBg=scene.background;scene.background=v.background;
  const oldCam=camera.position.clone();const oldQ=camera.quaternion.clone();camera.position.copy(cp.position);camera.quaternion.copy(cp.quaternion);renderer.setRenderTarget(null);renderer.render(scene,camera);camera.position.copy(oldCam);camera.quaternion.copy(oldQ);scene.background=oldBg;
  if(cctvOpen){$('cctvView').innerHTML='';$('cctvView').appendChild(renderer.domElement);if(night>=2&&Math.random()<.28){const t=nearestOpenTarget();msg('CAMERA '+String(i+1).padStart(2,'0')+' shows movement.');entity.visible=true;entity.position.set(t[0],0,t[1])}}
}
function startNight(n=1){
  night=n;running=true;paused=false;cctvOpen=false;elapsed=0;power=Math.max(55,100-(n-1)*8);battery=100;generatorHealth=1;generatorFixes=0;eventsSeen=0;camerasChecked=0;batteriesUsed=0;entityCooldown=Math.max(2,12-night);entity.visible=false;eventTimer=Math.max(7,25-night*2);
  camera.position.set(-14,1.65,-11);camera.rotation.set(0,0,0);controls.lock();$('menu').classList.add('hidden');$('pause').classList.add('hidden');$('modal').classList.add('hidden');$('hud').classList.remove('hidden');$('crosshair').classList.remove('hidden');msg('SHIFT START — 11:00 PM. Check the facility and keep the power alive.');audioInit();tone(180,.2)
}
function endNight(){running=false;controls.unlock();save.completed=Math.max(save.completed,night);save.night=Math.min(7,night+1);persist();showModal('SHIFT COMPLETE','<p class="good">06:00 AM</p><p>The lights return. Whatever was moving through Blackwood is gone.</p>'+stats(),[['CONTINUE',()=>{closeModal();startNight(Math.min(7,night+1))}],['MENU',quit]])}
function stats(){return '<div class="stat"><span>Time survived</span><b>06:00 AM</b></div><div class="stat"><span>Batteries used</span><b>'+batteriesUsed+'</b></div><div class="stat"><span>Cameras checked</span><b>'+camerasChecked+'</b></div><div class="stat"><span>Generator repairs</span><b>'+generatorFixes+'</b></div><div class="stat"><span>Events encountered</span><b>'+eventsSeen+'</b></div>'}
function die(){if(!running)return;running=false;controls.unlock();noise(.6,.06);showModal('SHIFT FAILED','<p class="danger">Something found you.</p>'+stats(),[['TRY AGAIN',()=>{closeModal();startNight(night)}],['MENU',quit]])}
function showModal(title,body,buttons=[]){$('modalTitle').textContent=title;$('modalBody').innerHTML=body;const b=$('modalButtons');b.innerHTML='';buttons.forEach(([t,fn])=>{const x=document.createElement('button');x.textContent=t;x.onclick=fn;b.appendChild(x)});$('modal').classList.remove('hidden')}
function closeModal(){$('modal').classList.add('hidden')}
function quit(){closeModal();running=false;cctvOpen=false;$('cctv').classList.add('hidden');controls.unlock();$('hud').classList.add('hidden');$('crosshair').classList.add('hidden');$('menu').classList.remove('hidden');updateContinue()}
function updateContinue(){$('continueGame').disabled=save.completed<1;$('menuHint').textContent=save.completed?'Completed nights: '+save.completed+' · Next: Night '+Math.min(7,save.night):'No completed shifts yet.'}
function settings(open){$('settings').classList.toggle('hidden',!open);$('master').value=save.master;$('sfx').value=save.sfx;$('sens').value=save.sens;$('quality').value=save.quality;$('shadows').checked=save.shadows;$('shake').checked=save.shake}
function setup(){
  buildFacility();entity=makeEntity();setupFlashlight();
  $('newGame').onclick=()=>startNight(1);$('continueGame').onclick=()=>startNight(Math.max(1,save.night));$('settingsBtn').onclick=()=>settings(true);$('closeSettings').onclick=()=>{save.master=+$('master').value;save.sfx=+$('sfx').value;save.sens=+$('sens').value;save.quality=$('quality').value;save.shadows=$('shadows').checked;save.shake=$('shake').checked;persist();renderer.setPixelRatio(Math.min(devicePixelRatio,save.quality==='high'?1.5:1));renderer.shadowMap.enabled=save.shadows;settings(false)};
  $('howBtn').onclick=()=>showModal('HOW TO PLAY','<p><b>WASD</b> move · <b>SHIFT</b> sprint · <b>MOUSE</b> look · <b>E</b> interact · <b>F</b> flashlight · <b>C</b> CCTV · <b>ESC</b> pause.</p><p>Survive until 06:00 AM. Conserve power, repair the generator when necessary, collect batteries and investigate only when you must. The entity reacts to what you do — and it is not always where you expect.</p>',[['CLOSE',closeModal]]);
  $('resume').onclick=()=>{paused=false;$('pause').classList.add('hidden');controls.lock()};$('pauseSettings').onclick=()=>settings(true);$('quit').onclick=quit;
  document.querySelectorAll('[data-cam]').forEach(b=>b.onclick=()=>renderCCTV(+b.dataset.cam));
  window.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='KeyE'&&!e.repeat)interact();if(e.code==='KeyF'&&!e.repeat){flashlightOn=!flashlightOn;if(flashlightOn&&battery<=0)flashlightOn=false;tone(flashlightOn?600:180,.05)}if(e.code==='KeyC'&&!e.repeat)openCCTV();if(e.code==='Escape'&&!e.repeat&&running&&!cctvOpen){paused=!paused;$('pause').classList.toggle('hidden',!paused);if(paused)controls.unlock();else controls.lock()}});
  window.addEventListener('keyup',e=>keys[e.code]=false);
  renderer.domElement.addEventListener('click',()=>{if(running&&!paused&&!cctvOpen)controls.lock()});
  updateContinue();
}
setup();
function tick(){
  requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),.05);
  if(running&&!paused&&!cctvOpen){
    doMove(dt);updateEntity(dt);updatePower(dt);updateFlashlight(dt);updateLight();eventTimer-=dt;
    if(eventTimer<=0){eventTimer=Math.max(10,26-night*3)+Math.random()*28;randomEvent()}
    elapsed+=dt;const shiftMinutes=420*(elapsed/420);const total=23*60+shiftMinutes;const mins=Math.floor(total%1440),hh=Math.floor(mins/60),mm=mins%60;const h12=hh%12||12;const ampm=hh<12?'AM':'PM';$('clock').textContent=String(h12).padStart(2,'0')+':'+String(mm).padStart(2,'0')+' '+ampm;
    $('power').textContent='POWER '+Math.round(power)+'%';$('battery').textContent='FLASHLIGHT: '+Math.round(battery)+'%';updatePrompt();
    if(elapsed>=420)endNight();
  }
  if(entity&&entity.visible){entity.children.forEach((m,i)=>{if(m.material)m.material.emissive?.setHex(0x000000)})}
  renderer.render(scene,camera);
}
tick();
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
setTimeout(()=>{$('loading').classList.add('hidden')},900);
