const { ipcRenderer } = require('electron');
const io = require('socket.io-client');

// ════ 설정 ════
const SERVER_URL = 'http://localhost:3000';
const CHAR_SIZE = 128, FPS = 8, GRAVITY = 0.5;
const FLOOR_Y = window.innerHeight - CHAR_SIZE;
const BUBBLE_DURATION = 4000, EMPTY_BUBBLE_DURATION = 3000;
const CLICK_THRESHOLD = 5, DBLCLICK_TIME = 300;
const WHISPER_ATTENTION = 5, CHAT_ATTENTION = 30, MOUSE_IDLE_TIME = 3000, CHASE_SPEED = 3;
const INTERACT_DIST = 40;
const THROW_SPEED_THRESHOLD = 8; // 드래그 속도 이상이면 던지기, 이하면 떨구기
const WAVE_LEAVE_DURATION = 1200; // 나갈 때 손흔들기 시간

let settingPin = true, settingAttention = true, settingBubble = true;

// ════ 파츠 ════
const LAYER_ORDER = ['body','clothes','mouth','eyes','hair','accessory'];
const PARTS_OPTIONS = {
  body:['default','light','medium','dark'], eyes:['round','cat','sleepy'],
  mouth:['smile','neutral','pout'], hair:['short','long','ponytail'],
  clothes:['hoodie','shirt','dress'], accessory:['none','hat','glasses','ribbon'],
};
const ANIM_FRAMES = { idle:2, walk:3, fall:1, grabbed:1, land:1, thrown:1, wave:4, sit:2, nod:3, jump:3 };
const RANDOM_ACTIONS = ['wave','sit','nod','jump'];

const imageCache = {};
function getPartImage(l,o,a) {
  if(o==='none') return null;
  const k=`${l}/${o}/${a}`;
  if(!imageCache[k]){const i=new Image();i.src=`sprites/${k}.png`;imageCache[k]=i;}
  return imageCache[k];
}

// ════ 캐릭터 ════
const myChar = {
  x:window.innerWidth/2, y:100, vx:0, vy:0,
  state:'fall', dir:1, frame:0, frameTimer:0,
  isGrabbed:false, forcedGrab:false, attentionGrab:false,
  name:'guest',
  parts:{body:'default',eyes:'round',mouth:'smile',hair:'short',clothes:'hoodie',accessory:'none'},
};
const otherChars = {};
let unreadChat=0, unreadWhisper=0, chatHistory=[], whisperHistory=[];
let currentRoom=null, isRoomOwner=false;

// ════ 마우스 추적 ════
let mousePos={x:window.innerWidth/2,y:FLOOR_Y}, lastActivityTime=Date.now();
let mouseIsIdle=false, hasGrabbedMouse=false;
document.addEventListener('mousemove',(e)=>{
  mousePos.x=e.clientX; mousePos.y=e.clientY; lastActivityTime=Date.now();
  if(mouseIsIdle&&hasGrabbedMouse&&myChar.attentionGrab){
    mouseIsIdle=false; myChar.attentionGrab=false; myChar.forcedGrab=false;
    myChar.state='fall'; myChar.vy=-3; myChar.vx=(Math.random()-0.5)*4;
  }
});
document.addEventListener('mousedown',()=>{lastActivityTime=Date.now();});
function isAttentionMode(){return settingAttention&&(unreadWhisper>=WHISPER_ATTENTION||unreadChat>=CHAT_ATTENTION);}

// ════ DOM ════
const myEl=document.createElement('canvas');
myEl.width=CHAR_SIZE;myEl.height=CHAR_SIZE;myEl.className='character';
myEl.style.width=CHAR_SIZE+'px';myEl.style.height=CHAR_SIZE+'px';
document.body.appendChild(myEl);
const myCtx=myEl.getContext('2d');
const alertBadge=document.createElement('div');
alertBadge.className='alert-badge';alertBadge.textContent='!';alertBadge.style.display='none';
document.body.appendChild(alertBadge);

// ════ 렌더링 ════
function renderChar(ctx,el,char){
  const a=char.state||'idle', f=ANIM_FRAMES[a]||ANIM_FRAMES.idle, fr=char.frame%f;
  ctx.clearRect(0,0,CHAR_SIZE,CHAR_SIZE); ctx.save();
  if(char.dir===-1){ctx.translate(CHAR_SIZE,0);ctx.scale(-1,1);}
  let has=false;
  LAYER_ORDER.forEach(l=>{
    const o=char.parts?.[l]; if(!o||o==='none') return;
    const img=getPartImage(l,o,a);
    if(img&&img.complete&&img.naturalWidth>0){has=true;ctx.drawImage(img,fr*CHAR_SIZE,0,CHAR_SIZE,CHAR_SIZE,0,0,CHAR_SIZE,CHAR_SIZE);}
  });
  if(!has){ctx.fillStyle='#ff6b9d';ctx.roundRect(8,8,CHAR_SIZE-16,CHAR_SIZE-16,12);ctx.fill();ctx.fillStyle='#fff';ctx.font='36px sans-serif';ctx.fillText('🐾',CHAR_SIZE/2-18,CHAR_SIZE/2+12);}
  ctx.restore(); el.style.left=char.x+'px'; el.style.top=char.y+'px';
}

// ════ 빈 말풍선 ════
let activeEmptyBubble=null;
function showEmptyBubble(charGetter,type,onClickCb){
  removeEmptyBubble();
  const b=document.createElement('div');
  b.className='empty-bubble'+(type==='whisper'?' whisper':'');
  b.innerHTML=type==='whisper'?'🤫 ...':'💬 ...';
  document.body.appendChild(b);
  b.addEventListener('click',(e)=>{e.stopPropagation();removeEmptyBubble();if(onClickCb)onClickCb();});
  const tracker={el:b,charGetter};
  function up(){if(!b.parentElement)return;const p=charGetter();b.style.left=(p.x+CHAR_SIZE/2)+'px';b.style.top=(p.y-44)+'px';}
  up(); tracker.updatePos=up;
  tracker.timeout=setTimeout(()=>removeEmptyBubble(),EMPTY_BUBBLE_DURATION);
  activeEmptyBubble=tracker;
  ipcRenderer.send('set-ignore-mouse',false);
}
function removeEmptyBubble(){if(activeEmptyBubble){clearTimeout(activeEmptyBubble.timeout);if(activeEmptyBubble.el.parentElement)activeEmptyBubble.el.remove();activeEmptyBubble=null;}}

// ════ 클릭/더블클릭/드래그 ════
let mouseDownPos=null, dragTarget=null, dragOffset={x:0,y:0}, isDragging=false;
let lastClickTime=0, lastClickTarget=null;
let dragStartTime=0; // 드래그 속도 측정용

myEl.addEventListener('mousedown',(e)=>{
  e.stopPropagation();
  mouseDownPos={x:e.clientX,y:e.clientY}; dragTarget='self';
  dragOffset.x=e.clientX-myChar.x; dragOffset.y=e.clientY-myChar.y;
  isDragging=false; dragStartTime=Date.now();
  ipcRenderer.send('set-ignore-mouse',false);
  if(myChar.attentionGrab){myChar.attentionGrab=false;myChar.forcedGrab=false;}
});

document.addEventListener('mousemove',(e)=>{
  if(!dragTarget) return;
  const dist=mouseDownPos?Math.hypot(e.clientX-mouseDownPos.x,e.clientY-mouseDownPos.y):0;
  if(!isDragging&&dist>CLICK_THRESHOLD){
    isDragging=true;
    if(dragTarget==='self'){myChar.isGrabbed=true;myChar.state='grabbed';myChar.vx=0;myChar.vy=0;}
    else if(socket) socket.emit('grab-other',{targetId:dragTarget});
  }
  if(isDragging){
    if(dragTarget==='self'){myChar.x=e.clientX-dragOffset.x;myChar.y=e.clientY-dragOffset.y;}
    else if(socket) socket.emit('drag-other',{targetId:dragTarget,x:e.clientX-dragOffset.x,y:e.clientY-dragOffset.y});
  }
});

document.addEventListener('mouseup',(e)=>{
  if(!dragTarget) return;
  const now=Date.now();

  if(!isDragging){
    // 클릭
    if(dragTarget==='self'){
      if(lastClickTarget==='self'&&(now-lastClickTime)<DBLCLICK_TIME){
        openPhone('chat'); lastClickTarget=null; // 더블클릭
      } else {
        const action=RANDOM_ACTIONS[Math.floor(Math.random()*RANDOM_ACTIONS.length)];
        myChar.state=action;
        setTimeout(()=>{if(myChar.state===action)myChar.state='idle';},1500);
        showEmptyBubble(()=>({x:myChar.x,y:myChar.y}),'chat',
          ()=>openQuickChat(myChar.x+CHAR_SIZE/2,myChar.y-50,'chat'));
        lastClickTarget='self'; lastClickTime=now;
      }
    } else {
      const tid=dragTarget, c=otherChars[tid];
      if(c) showEmptyBubble(()=>({x:c.x,y:c.y}),'whisper',
        ()=>openQuickChat(c.x+CHAR_SIZE/2,c.y-50,'whisper',tid));
    }
  } else {
    // 드래그 끝 — 속도로 던지기/떨구기 구분
    const dt=now-dragStartTime;
    const dist=mouseDownPos?Math.hypot(e.clientX-mouseDownPos.x,e.clientY-mouseDownPos.y):0;
    const speed=dist/(dt||1)*1000; // px/sec

    if(dragTarget==='self'){
      myChar.isGrabbed=false;
      if(speed>THROW_SPEED_THRESHOLD*100){
        // 빠른 드래그 → 던지기
        myChar.state='thrown';
        myChar.vx=(e.clientX-mouseDownPos.x)*0.15;
        myChar.vy=Math.min((e.clientY-mouseDownPos.y)*0.15,-3);
      } else {
        // 느린 드래그 → 떨구기
        myChar.state='fall'; myChar.vy=1; myChar.vx=0;
      }
    } else if(socket){
      if(speed>THROW_SPEED_THRESHOLD*100){
        socket.emit('throw-other',{targetId:dragTarget,vx:(e.clientX-mouseDownPos.x)*0.1,vy:-3});
      } else {
        socket.emit('drop-other',{targetId:dragTarget});
      }
    }
  }
  ipcRenderer.send('set-ignore-mouse',true);
  dragTarget=null; mouseDownPos=null; isDragging=false;
});

// ════ 퀵 채팅 ════
const quickChat=document.getElementById('quickChat');
const quickChatInput=document.getElementById('quickChatInput');
const quickChatLabel=document.getElementById('quickChatLabel');
let quickChatMode='chat', quickWhisperTarget=null;

function openQuickChat(x,y,mode,targetId){
  quickChatMode=mode; quickWhisperTarget=targetId||null;
  quickChatLabel.textContent=mode==='whisper'?`🤫 ${otherChars[targetId]?.name||'???'}`:'💬 전체';
  quickChat.style.left=Math.min(x,window.innerWidth-220)+'px';
  quickChat.style.top=Math.max(y,30)+'px';
  quickChat.classList.add('visible'); quickChatInput.value=''; quickChatInput.focus();
  ipcRenderer.send('set-ignore-mouse',false);
}
quickChatInput.addEventListener('keydown',(e)=>{
  if(e.key==='Enter'&&quickChatInput.value.trim()&&socket){
    const m=quickChatInput.value.trim();
    if(quickChatMode==='chat') socket.emit('chat',{message:m});
    else if(quickWhisperTarget) socket.emit('whisper',{targetId:quickWhisperTarget,message:m});
    quickChatInput.value=''; quickChat.classList.remove('visible'); ipcRenderer.send('set-ignore-mouse',true);
  }
  if(e.key==='Escape'){quickChat.classList.remove('visible');ipcRenderer.send('set-ignore-mouse',true);}
});

// ════ 핸드폰 UI ════
const phone=document.getElementById('phone');
const phoneClose=document.getElementById('phoneClose');
const navItems=document.querySelectorAll('.phone-nav-item');
const pages=document.querySelectorAll('.phone-page');
let currentPage='chat';
function openPhone(p){currentPage=p||'chat';phone.classList.add('visible');ipcRenderer.send('set-ignore-mouse',false);switchPage(currentPage);hideAlert();}
function closePhone(){phone.classList.remove('visible');ipcRenderer.send('set-ignore-mouse',true);}
phoneClose.addEventListener('click',closePhone);
navItems.forEach(i=>{i.addEventListener('click',()=>switchPage(i.dataset.page));});
function switchPage(p){
  currentPage=p;
  navItems.forEach(n=>n.classList.toggle('active',n.dataset.page===p));
  pages.forEach(pg=>pg.classList.toggle('active',pg.id==='page'+p));
  if(p==='chat') renderChatMessages();
  if(p==='lobby') updateLobbyUI();
}

// ════ 채팅 페이지 ════
const chatMessages=document.getElementById('chatMessages');
const chatPageInput=document.getElementById('chatPageInput');
const chatPageSend=document.getElementById('chatPageSend');
const chatSubTabs=document.querySelectorAll('.chat-sub-tab');
let chatSubTab='all';
chatSubTabs.forEach(t=>{t.addEventListener('click',()=>{chatSubTab=t.dataset.subtab;chatSubTabs.forEach(x=>x.classList.toggle('active',x.dataset.subtab===chatSubTab));renderChatMessages();});});
function renderChatMessages(){
  chatMessages.innerHTML='';
  const log=chatSubTab==='all'?chatHistory:whisperHistory;
  log.forEach(msg=>{
    const div=document.createElement('div');
    const mine=msg.id===socket?.id||msg.fromId===socket?.id;
    div.className='chat-msg '+(mine?'mine':'other');
    const nm=!mine?`<div class="chat-msg-name">${msg.name||msg.fromName}</div>`:'';
    const t=new Date(msg.time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
    div.innerHTML=`${nm}${msg.message}<div class="chat-msg-time">${t}</div>`;
    chatMessages.appendChild(div);
  });
  chatMessages.scrollTop=chatMessages.scrollHeight;
}
function sendChatPageMsg(){const m=chatPageInput.value.trim();if(!m||!socket)return;if(chatSubTab==='all')socket.emit('chat',{message:m});chatPageInput.value='';}
chatPageSend.addEventListener('click',sendChatPageMsg);
chatPageInput.addEventListener('keydown',(e)=>{if(e.key==='Enter')sendChatPageMsg();});

// ════ 로비 (방이름 + 코드 매칭) ════
const lobbyCreate=document.getElementById('lobbyCreate');
const lobbyJoin=document.getElementById('lobbyJoin');
const lobbyMyName=document.getElementById('lobbyMyName');
const lobbyRoomName=document.getElementById('lobbyRoomName');
const lobbyCode=document.getElementById('lobbyCode');
const lobbyJoinName=document.getElementById('lobbyJoinName');
const lobbyJoinRoomName=document.getElementById('lobbyJoinRoomName');
const lobbyRoomCode=document.getElementById('lobbyRoomCode');
const lobbyRoomTitle=document.getElementById('lobbyRoomTitle');
const lobbyMembers=document.getElementById('lobbyMembers');
const lobbyError=document.getElementById('lobbyError');

lobbyCreate.addEventListener('click',()=>{
  const name=lobbyMyName.value.trim()||'guest';
  const roomName=lobbyRoomName.value.trim()||'Hellowee Room';
  myChar.name=name;
  if(socket) socket.disconnect();
  connectSocket();
  socket.on('connect',()=>{
    socket.emit('create-room',{roomName,name,parts:myChar.parts},(res)=>{
      if(res.success){currentRoom=res.code;updateLobbyUI();switchPage('chat');lobbyError.textContent='';}
    });
  });
});

lobbyJoin.addEventListener('click',()=>{
  const code=lobbyCode.value.trim().toUpperCase();
  const roomName=lobbyJoinRoomName.value.trim();
  const name=lobbyJoinName.value.trim()||'guest';
  if(!code||!roomName){lobbyError.textContent='방 이름과 코드를 모두 입력해주세요';return;}
  myChar.name=name;
  if(socket) socket.disconnect();
  connectSocket();
  socket.on('connect',()=>{
    socket.emit('join-room',{code,roomName,name,parts:myChar.parts},(res)=>{
      if(res.success){currentRoom=res.code;updateLobbyUI();switchPage('chat');lobbyError.textContent='';}
      else {lobbyError.textContent=res.error;}
    });
  });
});

function updateLobbyUI(){
  lobbyRoomCode.textContent=currentRoom||'---';
  lobbyRoomTitle.textContent=currentRoom?'':'---';
  lobbyMembers.innerHTML='';
  if(currentRoom){
    const me=document.createElement('div');me.className='lobby-member';
    me.innerHTML=`<span class="lobby-member-dot"></span> ${myChar.name} (나)${isRoomOwner?' 👑':''}`;
    lobbyMembers.appendChild(me);
    Object.entries(otherChars).forEach(([id,c])=>{
      const div=document.createElement('div');div.className='lobby-member';
      div.innerHTML=`<span class="lobby-member-dot"></span> ${c.name}`;
      lobbyMembers.appendChild(div);
    });
  }
}

// ════ 꾸미기 ════
const customSection=document.querySelector('.custom-section');
const labelMap={body:'피부',eyes:'눈',mouth:'입',hair:'헤어',clothes:'옷',accessory:'악세서리'};
LAYER_ORDER.forEach(layer=>{
  const row=document.createElement('div');row.className='custom-row';
  const label=document.createElement('div');label.className='custom-label';label.textContent=labelMap[layer];row.appendChild(label);
  const wrap=document.createElement('div');wrap.className='custom-options';
  PARTS_OPTIONS[layer].forEach(opt=>{
    const btn=document.createElement('button');btn.className='custom-btn';
    if(myChar.parts[layer]===opt)btn.classList.add('active');
    btn.textContent=opt;
    btn.addEventListener('click',()=>{myChar.parts[layer]=opt;wrap.querySelectorAll('.custom-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');if(socket)socket.emit('update-parts',myChar.parts);});
    wrap.appendChild(btn);
  });
  row.appendChild(wrap);customSection.appendChild(row);
});

// ════ 설정 ════
const togglePin=document.getElementById('togglePin');
const toggleAttention=document.getElementById('toggleAttention');
const toggleBubble=document.getElementById('toggleBubble');
const settingsLeave=document.getElementById('settingsLeave');
togglePin.addEventListener('click',()=>{settingPin=!settingPin;togglePin.classList.toggle('on',settingPin);ipcRenderer.send('toggle-pin');});
toggleAttention.addEventListener('click',()=>{settingAttention=!settingAttention;toggleAttention.classList.toggle('on',settingAttention);});
toggleBubble.addEventListener('click',()=>{settingBubble=!settingBubble;toggleBubble.classList.toggle('on',settingBubble);});
settingsLeave.addEventListener('click',()=>{
  if(socket)socket.disconnect();
  currentRoom=null;isRoomOwner=false;
  Object.keys(otherChars).forEach(id=>{otherChars[id].el.remove();otherChars[id].nameEl.remove();delete otherChars[id];});
  chatHistory=[];whisperHistory=[];updateLobbyUI();switchPage('lobby');
});
ipcRenderer.on('pin-status',(ev,p)=>{settingPin=p;togglePin.classList.toggle('on',p);});
ipcRenderer.send('get-pin-status');

// ════ 말풍선 ════
const activeBubbles=[];
function showBubble(cx,cy,msg,type){
  if(!settingBubble)return null;
  const b=document.createElement('div');b.className='bubble'+(type==='whisper'?' whisper':'');
  b.textContent=msg;b.style.left=(cx+CHAR_SIZE/2)+'px';b.style.top=(cy-40)+'px';
  document.body.appendChild(b);
  setTimeout(()=>{b.style.opacity='0';b.style.transition='opacity 0.3s';setTimeout(()=>b.remove(),300);},BUBBLE_DURATION);
  return b;
}
function createTrackedBubble(g,msg,type){
  const p=g();const b=showBubble(p.x,p.y,msg,type);if(!b)return;
  const t={el:b,charGetter:g};activeBubbles.push(t);
  setTimeout(()=>{const i=activeBubbles.indexOf(t);if(i>-1)activeBubbles.splice(i,1);},BUBBLE_DURATION+300);
}
function updateBubbles(){
  activeBubbles.forEach(b=>{if(!b.el.parentElement)return;const p=b.charGetter();b.el.style.left=(p.x+CHAR_SIZE/2)+'px';b.el.style.top=(p.y-40)+'px';});
  if(activeEmptyBubble?.updatePos) activeEmptyBubble.updatePos();
}

// ════ 알림 ════
function showAlert(){alertBadge.style.display='block';alertBadge.textContent=isAttentionMode()?'!!':'!';alertBadge.style.background=isAttentionMode()?'#ff2020':'#ff4757';document.getElementById('dotChat').classList.add('show');}
function hideAlert(){alertBadge.style.display='none';unreadChat=0;unreadWhisper=0;hasGrabbedMouse=false;document.getElementById('dotChat').classList.remove('show');}
function updateAlertPos(){alertBadge.style.left=(myChar.x+CHAR_SIZE-5)+'px';alertBadge.style.top=(myChar.y-10)+'px';}

// ════ 근접 상호작용 ════
let interactCooldown=0;
function checkProximityInteract(){
  if(interactCooldown>0){interactCooldown--;return;}
  const mx=myChar.x+CHAR_SIZE/2;
  Object.values(otherChars).forEach(c=>{
    const cx=c.x+CHAR_SIZE/2;
    if(Math.abs(mx-cx)<INTERACT_DIST&&Math.abs(myChar.y-c.y)<CHAR_SIZE/2){
      myChar.state='wave';myChar.dir=cx>mx?1:-1;
      if(socket)socket.emit('interact',{});
      interactCooldown=300;
      setTimeout(()=>{if(myChar.state==='wave')myChar.state='idle';},1500);
    }
  });
}

// ════ 걷기 + 어텐션 ════
let walkTimer=0;
function randomWalk(){
  if(Math.random()<0.4){myChar.state='walk';myChar.dir=Math.random()<0.5?1:-1;myChar.vx=myChar.dir*1.5;walkTimer=60+Math.random()*120;}
  else{myChar.state='idle';myChar.vx=0;walkTimer=60+Math.random()*180;}
}
function updateAttentionMode(){
  if(!isAttentionMode()||myChar.isGrabbed||myChar.forcedGrab||myChar.y<FLOOR_Y) return false;
  const cx=myChar.x+CHAR_SIZE/2,d=Math.abs(mousePos.x-cx);
  mouseIsIdle=(Date.now()-lastActivityTime)>MOUSE_IDLE_TIME;
  if(d>CHAR_SIZE/2){myChar.state='walk';myChar.dir=mousePos.x>cx?1:-1;myChar.vx=myChar.dir*CHASE_SPEED;}
  else{myChar.vx=0;if(mouseIsIdle&&!hasGrabbedMouse){hasGrabbedMouse=true;myChar.state='grabbed';myChar.attentionGrab=true;myChar.forcedGrab=true;myChar.x=mousePos.x-CHAR_SIZE/2;myChar.y=mousePos.y-CHAR_SIZE/2;setTimeout(()=>openPhone('chat'),500);}else if(!mouseIsIdle)myChar.state='idle';}
  return true;
}

// ════ 메인 루프 ════
let lastTime=0;
function loop(ts){
  const dt=ts-lastTime;lastTime=ts;
  if(!myChar.isGrabbed&&!myChar.forcedGrab){
    if(myChar.y<FLOOR_Y){myChar.vy+=GRAVITY;if(myChar.state!=='thrown')myChar.state='fall';}
    else{
      myChar.y=FLOOR_Y;myChar.vy=0;
      if(myChar.state==='fall'||myChar.state==='thrown'){myChar.state='land';myChar.vx=0;setTimeout(()=>{myChar.state='idle';randomWalk();},300);}
      if(!updateAttentionMode()&&!RANDOM_ACTIONS.includes(myChar.state)){walkTimer--;if(walkTimer<=0&&myChar.state!=='land')randomWalk();}
      myChar.x+=myChar.vx; checkProximityInteract();
    }
    myChar.y+=myChar.vy;
    myChar.x=Math.max(0,Math.min(window.innerWidth-CHAR_SIZE,myChar.x));
    myChar.y=Math.min(FLOOR_Y,myChar.y);
  }else if(myChar.attentionGrab){myChar.x=mousePos.x-CHAR_SIZE/2;myChar.y=mousePos.y-CHAR_SIZE/2;}

  myChar.frameTimer+=dt;
  if(myChar.frameTimer>1000/FPS){myChar.frameTimer=0;myChar.frame=(myChar.frame+1)%(ANIM_FRAMES[myChar.state]||2);}
  renderChar(myCtx,myEl,myChar);updateAlertPos();updateBubbles();

  Object.values(otherChars).forEach(c=>{if(c.ctx){renderChar(c.ctx,c.el,c);c.nameEl.style.left=(c.x+CHAR_SIZE/2)+'px';c.nameEl.style.top=(c.y-18)+'px';}});
  if(socket&&socket.connected){socket.volatile.emit('move',{x:myChar.x,y:myChar.y,state:myChar.state,dir:myChar.dir,frame:myChar.frame});}
  requestAnimationFrame(loop);
}

// ════ 상대 나갈 때 손흔들고 사라지기 ════
function animateLeave(id, name){
  const c=otherChars[id];
  if(!c) return;
  // 손 흔들기 애니메이션
  c.state='wave';
  // 말풍선
  createTrackedBubble(()=>({x:c.x,y:c.y}), '👋 안녕~', 'chat');
  // 페이드아웃 후 제거
  setTimeout(()=>{
    if(c.el){c.el.style.transition='opacity 0.5s';c.el.style.opacity='0';}
    if(c.nameEl){c.nameEl.style.transition='opacity 0.5s';c.nameEl.style.opacity='0';}
    setTimeout(()=>{
      if(c.el) c.el.remove();
      if(c.nameEl) c.nameEl.remove();
      delete otherChars[id];
      updateLobbyUI();
    },500);
  },WAVE_LEAVE_DURATION);
}

// ════ Socket.io ════
let socket;
function connectSocket(){
  socket=io(SERVER_URL);

  socket.on('room-info',({code,name,isOwner,memberCount})=>{
    currentRoom=code; isRoomOwner=isOwner;
    lobbyRoomCode.textContent=code;
    lobbyRoomTitle.textContent=name;
    updateLobbyUI();
  });

  socket.on('user-joined',({id,name,parts})=>{
    if(otherChars[id]) return;
    const el=document.createElement('canvas');el.width=CHAR_SIZE;el.height=CHAR_SIZE;
    el.className='character';el.style.width=CHAR_SIZE+'px';el.style.height=CHAR_SIZE+'px';
    document.body.appendChild(el);
    const nameEl=document.createElement('div');nameEl.className='nameplate';nameEl.textContent=name;
    document.body.appendChild(nameEl);
    otherChars[id]={x:Math.random()*(window.innerWidth-CHAR_SIZE),y:FLOOR_Y,vx:0,vy:0,state:'idle',dir:1,frame:0,frameTimer:0,name,parts:parts||{},el,ctx:el.getContext('2d'),nameEl};
    el.addEventListener('mousedown',(e)=>{e.stopPropagation();mouseDownPos={x:e.clientX,y:e.clientY};dragTarget=id;dragOffset.x=e.clientX-otherChars[id].x;dragOffset.y=e.clientY-otherChars[id].y;isDragging=false;dragStartTime=Date.now();ipcRenderer.send('set-ignore-mouse',false);});
    updateLobbyUI();
  });

  socket.on('user-parts-updated',({id,parts})=>{if(otherChars[id])otherChars[id].parts=parts;});
  socket.on('user-moved',({id,x,y,state,dir,frame})=>{if(otherChars[id])Object.assign(otherChars[id],{x,y,state,dir,frame});});

  // 상대 나감 → 안녕 애니메이션
  socket.on('user-leaving',({id,name})=>{ animateLeave(id,name); });
  // 강퇴 당함
  socket.on('user-left',({id,type})=>{
    if(type==='kicked'&&otherChars[id]){otherChars[id].el.remove();otherChars[id].nameEl.remove();delete otherChars[id];updateLobbyUI();}
  });
  socket.on('kicked',({reason})=>{
    alert(reason); currentRoom=null;isRoomOwner=false;
    Object.keys(otherChars).forEach(id=>{otherChars[id].el.remove();otherChars[id].nameEl.remove();delete otherChars[id];});
    switchPage('lobby');
  });

  socket.on('chat-message',(data)=>{
    chatHistory.push(data);
    if(data.id===socket.id) createTrackedBubble(()=>({x:myChar.x,y:myChar.y}),data.message,'chat');
    else if(otherChars[data.id]){createTrackedBubble(()=>({x:otherChars[data.id].x,y:otherChars[data.id].y}),data.message,'chat');unreadChat++;showAlert();}
    if(phone.classList.contains('visible')&&currentPage==='chat'&&chatSubTab==='all'){renderChatMessages();unreadChat=0;}
  });
  socket.on('whisper-message',(data)=>{
    whisperHistory.push(data);
    if(data.fromId===socket.id) createTrackedBubble(()=>({x:myChar.x,y:myChar.y}),data.message,'whisper');
    else if(otherChars[data.fromId]){createTrackedBubble(()=>({x:otherChars[data.fromId].x,y:otherChars[data.fromId].y}),data.message,'whisper');unreadWhisper++;showAlert();}
    if(phone.classList.contains('visible')&&currentPage==='chat'&&chatSubTab==='whisper'){renderChatMessages();unreadWhisper=0;}
  });
  socket.on('chat-history',(log)=>{chatHistory=log;});
  socket.on('whisper-history',(log)=>{whisperHistory=log;});
  socket.on('force-grabbed',()=>{myChar.forcedGrab=true;myChar.state='grabbed';myChar.vx=0;myChar.vy=0;});
  socket.on('char-dragged',({targetId,x,y})=>{if(targetId===socket.id){myChar.x=x;myChar.y=y;}else if(otherChars[targetId]){otherChars[targetId].x=x;otherChars[targetId].y=y;otherChars[targetId].state='grabbed';}});
  socket.on('force-thrown',({vx,vy})=>{myChar.forcedGrab=false;myChar.attentionGrab=false;myChar.state='thrown';myChar.vx=vx;myChar.vy=vy;});
  socket.on('force-dropped',()=>{myChar.forcedGrab=false;myChar.attentionGrab=false;myChar.state='fall';myChar.vy=1;myChar.vx=0;});
  socket.on('char-thrown',({targetId})=>{if(otherChars[targetId])otherChars[targetId].state='fall';});
  socket.on('char-dropped',({targetId})=>{if(otherChars[targetId])otherChars[targetId].state='fall';});
  socket.on('char-grabbed',({targetId})=>{if(otherChars[targetId])otherChars[targetId].state='grabbed';});
}

// ════ 시작 ════
openPhone('lobby');
requestAnimationFrame(loop);
