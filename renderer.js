const { ipcRenderer } = require('electron');
const io = require('socket.io-client');
const { Tutorial } = require('./tutorial');
const { SoundManager } = require('./sound');
const { Live2DManager } = require('./live2d-manager');

// ════ 설정 ════
const SERVER_URL = 'https://hellowee-server.onrender.com';
const CHAR_SIZE = 512;          // 스프라이트 원본 (512px로 그리기)
const DISPLAY_SIZE = 128;       // 화면 표시 (초선명 축소)
const FPS = 10, GRAVITY = 0.5;
const FLOOR_Y = window.innerHeight - DISPLAY_SIZE;
const BUBBLE_DURATION = 4000, EMPTY_BUBBLE_DURATION = 3000;
const CLICK_THRESHOLD = 5, DBLCLICK_TIME = 300;
const WHISPER_ATTENTION = 5, CHAT_ATTENTION = 30, MOUSE_IDLE_TIME = 3000, CHASE_SPEED = 3;
const INTERACT_DIST = 40, THROW_SPEED_THRESHOLD = 800, WAVE_LEAVE_DURATION = 1200;
let settingPin=true, settingAttention=true, settingBubble=true, settingSound=true;
const sfx = new SoundManager();
function playSound(name) { if (settingSound) sfx.play(name); }
const LAYER_ORDER=['body','clothes','mouth','eyes','hair','accessory'];
const PARTS_OPTIONS={body:['default','light','medium','dark'],eyes:['round','cat','sleepy'],mouth:['smile','neutral','pout'],hair:['short','long','ponytail'],clothes:['hoodie','shirt','dress'],accessory:['none','hat','glasses','ribbon']};
const ANIM_FRAMES={idle:4,walk:6,fall:2,grabbed:2,land:2,thrown:3,wave:6,sit:4,nod:4,jump:5};
const RANDOM_ACTIONS=['wave','sit','nod','jump'];
const EMOJIS=['👋','😂','❤️','👍','😭','🔥','🎉','🤔','😍','🙄','🐾','✨'];
const STATUS_LIST=['🟢 온라인','🟡 자리비움','🟠 밥 먹는 중','🔴 일하는 중','🟣 회의 중','⚫ 방해금지'];

// ════ Live2D 매니저 ════
const l2dManager = new Live2DManager();
let useLive2D = false;  // Live2D 로드 성공 시 true

// ════ 스프라이트 폴백 (기존 코드 유지) ════
const imageCache={};
function getPartImage(layer,option,action,frame){if(option==='none')return null;const key=layer+'/'+option+'/'+action+'_'+frame;if(!imageCache[key]){const img=new Image();img.src='sprites/'+key+'.png';imageCache[key]=img;}return imageCache[key];}

const myChar={x:window.innerWidth/2,y:100,vx:0,vy:0,state:'fall',dir:1,frame:0,frameTimer:0,isGrabbed:false,forcedGrab:false,attentionGrab:false,name:'guest',status:'',parts:{body:'default',eyes:'round',mouth:'smile',hair:'short',clothes:'hoodie',accessory:'none'}};
const otherChars={};let unreadChat=0,unreadWhisper=0,chatHistory=[],whisperHistory=[];let currentRoom=null,isRoomOwner=false;

// ════ Live2D 초기화 ════
async function initLive2D() {
  try {
    const myL2d = await l2dManager.createMyCharacter('hellowee_default');
    if (myL2d) {
      useLive2D = true;
      // Live2D 캐릭터의 canvas에 이벤트 바인딩
      const l2dEl = myL2d.getElement();
      bindCharacterEvents(l2dEl, 'self');
      // 기존 스프라이트 canvas 숨기기
      if (myEl) myEl.style.display = 'none';
      // 초기 파츠 적용
      myL2d.applyAllParts(myChar.parts);
      console.log('[Hellowee] Live2D 모드 활성화 ✨');
    } else {
      console.log('[Hellowee] 스프라이트 폴백 모드');
    }
  } catch (err) {
    console.warn('[Hellowee] Live2D 초기화 실패, 스프라이트 모드:', err);
  }
}

// ════ 인증 ════
ipcRenderer.on('auth-data',(event,data)=>{if(!data)return;if(data.nickname)myChar.name=data.nickname;if(data.parts)myChar.parts=data.parts;document.getElementById('settingsNicknameVal').textContent=myChar.name;if(Tutorial.needsTutorial()){startTutorial();}else{tryAutoReconnect();}});
function tryAutoReconnect(){try{const Store=require('electron-store');const store=new Store({name:'hellowee-auth'});const lastRoom=store.get('lastRoom');if(lastRoom&&lastRoom.code&&lastRoom.roomName){connectSocket();socket.on('connect',()=>{socket.emit('join-room',{code:lastRoom.code,roomName:lastRoom.roomName,name:myChar.name,parts:myChar.parts},(res)=>{if(res.success){currentRoom=res.code;updateLobbyUI();}else{openPhone('lobby');}});});}else{openPhone('lobby');}}catch(e){openPhone('lobby');}}

// ════ 마우스 ════
let mousePos={x:window.innerWidth/2,y:FLOOR_Y},lastActivityTime=Date.now(),mouseIsIdle=false,hasGrabbedMouse=false;
document.addEventListener('mousemove',(e)=>{mousePos.x=e.clientX;mousePos.y=e.clientY;lastActivityTime=Date.now();if(mouseIsIdle&&hasGrabbedMouse&&myChar.attentionGrab){mouseIsIdle=false;myChar.attentionGrab=false;myChar.forcedGrab=false;myChar.state='fall';myChar.vy=-3;myChar.vx=(Math.random()-0.5)*4;}});
document.addEventListener('mousedown',()=>{lastActivityTime=Date.now();sfx.init();});
function isAttentionMode(){return settingAttention&&(unreadWhisper>=WHISPER_ATTENTION||unreadChat>=CHAT_ATTENTION);}

// ════ 캐릭터 엘리먼트 (스프라이트 폴백용) ════
const myEl=document.createElement('canvas');myEl.width=CHAR_SIZE;myEl.height=CHAR_SIZE;myEl.className='character';myEl.style.width=DISPLAY_SIZE+'px';myEl.style.height=DISPLAY_SIZE+'px';document.body.appendChild(myEl);const myCtx=myEl.getContext('2d');

const alertBadge=document.createElement('div');alertBadge.className='alert-badge';alertBadge.textContent='!';alertBadge.style.display='none';document.body.appendChild(alertBadge);

// ════ 렌더링 (듀얼 모드) ════
// 스프라이트 폴백 렌더
function renderCharSprite(ctx,el,char){const a=char.state||'idle',f=ANIM_FRAMES[a]||ANIM_FRAMES.idle,fr=char.frame%f;ctx.clearRect(0,0,CHAR_SIZE,CHAR_SIZE);ctx.save();if(char.dir===-1){ctx.translate(CHAR_SIZE,0);ctx.scale(-1,1);}let has=false;LAYER_ORDER.forEach(function(l){var o=char.parts?char.parts[l]:null;if(!o||o==='none')return;var img=getPartImage(l,o,a,fr);if(img&&img.complete&&img.naturalWidth>0){has=true;ctx.drawImage(img,0,0,CHAR_SIZE,CHAR_SIZE);}});if(!has){ctx.fillStyle='#ff6b9d';ctx.roundRect(32,32,CHAR_SIZE-64,CHAR_SIZE-64,48);ctx.fill();ctx.fillStyle='#fff';ctx.font='144px sans-serif';ctx.fillText('🐾',CHAR_SIZE/2-72,CHAR_SIZE/2+48);}ctx.restore();el.style.left=char.x+'px';el.style.top=char.y+'px';}

// Live2D 렌더 (위치 + 모션 + 방향 업데이트)
function renderCharLive2D(l2dChar, char) {
  if (!l2dChar || !l2dChar.isReady) return;

  // 위치
  l2dChar.setPosition(char.x, char.y);

  // 방향
  l2dChar.setDirection(char.dir);

  // 모션 (상태 변경 시만)
  l2dChar.playMotion(char.state || 'idle');

  // 물리 파라미터: 이동 속도에 따른 기울기
  if (char.vx !== undefined) {
    l2dChar.setParameter('ParamAngleX', char.vx * 3);
  }
  if (char.vy !== undefined) {
    l2dChar.setParameter('ParamAngleY', Math.max(-30, Math.min(30, char.vy * -2)));
  }
}

// 통합 렌더 함수
function renderChar(charData, id) {
  if (useLive2D) {
    const l2dChar = l2dManager.getCharacter(id);
    if (l2dChar) {
      renderCharLive2D(l2dChar, charData);
      return;
    }
  }
  // 폴백: 스프라이트 렌더
  if (id === 'self') {
    renderCharSprite(myCtx, myEl, charData);
  } else if (otherChars[id] && otherChars[id].ctx) {
    renderCharSprite(otherChars[id].ctx, otherChars[id].el, charData);
  }
}

// ════ 말풍선 ════
let activeEmptyBubble=null;
function showEmptyBubble(g,type,cb){removeEmptyBubble();const b=document.createElement('div');b.className='empty-bubble'+(type==='whisper'?' whisper':'');b.innerHTML=type==='whisper'?'🤫 ...':'💬 ...';document.body.appendChild(b);b.addEventListener('click',(e)=>{e.stopPropagation();removeEmptyBubble();if(cb)cb();});const t={el:b,charGetter:g};function up(){if(!b.parentElement)return;const p=g();b.style.left=(p.x+DISPLAY_SIZE/2)+'px';b.style.top=(p.y-44)+'px';}up();t.updatePos=up;t.timeout=setTimeout(()=>removeEmptyBubble(),EMPTY_BUBBLE_DURATION);activeEmptyBubble=t;ipcRenderer.send('set-ignore-mouse',false);}
function removeEmptyBubble(){if(activeEmptyBubble){clearTimeout(activeEmptyBubble.timeout);if(activeEmptyBubble.el.parentElement)activeEmptyBubble.el.remove();activeEmptyBubble=null;}}

// ════ 드래그/인터랙션 ════
let mouseDownPos=null,dragTarget=null,dragOffset={x:0,y:0},isDragging=false,lastClickTime=0,lastClickTarget=null,dragStartTime=0;

// 캐릭터 이벤트 바인딩 (Live2D/스프라이트 공용)
function bindCharacterEvents(el, targetId) {
  el.addEventListener('mousedown',(e)=>{
    e.stopPropagation();
    mouseDownPos={x:e.clientX,y:e.clientY};
    dragTarget=targetId;
    const charData = targetId === 'self' ? myChar : otherChars[targetId];
    if (charData) {
      dragOffset.x=e.clientX-charData.x;
      dragOffset.y=e.clientY-charData.y;
    }
    isDragging=false;
    dragStartTime=Date.now();
    ipcRenderer.send('set-ignore-mouse',false);
    if(targetId==='self' && myChar.attentionGrab){myChar.attentionGrab=false;myChar.forcedGrab=false;}
  });
}

// 내 캐릭터 스프라이트에도 이벤트 바인딩
bindCharacterEvents(myEl, 'self');

document.addEventListener('mousemove',(e)=>{if(!dragTarget)return;const dist=mouseDownPos?Math.hypot(e.clientX-mouseDownPos.x,e.clientY-mouseDownPos.y):0;if(!isDragging&&dist>CLICK_THRESHOLD){isDragging=true;playSound('grab');if(dragTarget==='self'){myChar.isGrabbed=true;myChar.state='grabbed';myChar.vx=0;myChar.vy=0;}else if(socket)socket.emit('grab-other',{targetId:dragTarget});}if(isDragging){if(dragTarget==='self'){myChar.x=e.clientX-dragOffset.x;myChar.y=e.clientY-dragOffset.y;}else if(socket)socket.emit('drag-other',{targetId:dragTarget,x:e.clientX-dragOffset.x,y:e.clientY-dragOffset.y});}});
document.addEventListener('mouseup',(e)=>{if(!dragTarget)return;const now=Date.now();if(!isDragging){playSound('click');if(dragTarget==='self'){if(tutorial&&tutorial.isActive){if(tutorial.triggerAction('click-character'))return;}if(lastClickTarget==='self'&&(now-lastClickTime)<DBLCLICK_TIME){if(tutorial&&tutorial.isActive){tutorial.triggerAction('dblclick-character');}else{openPhone('home');}lastClickTarget=null;}else{const action=RANDOM_ACTIONS[Math.floor(Math.random()*RANDOM_ACTIONS.length)];myChar.state=action;setTimeout(()=>{if(myChar.state===action)myChar.state='idle';},1500);showEmptyBubble(()=>({x:myChar.x,y:myChar.y}),'chat',()=>openQuickChat(myChar.x+DISPLAY_SIZE/2,myChar.y-50,'chat'));lastClickTarget='self';lastClickTime=now;}}else{const tid=dragTarget,c=otherChars[tid];if(c)showEmptyBubble(()=>({x:c.x,y:c.y}),'whisper',()=>openQuickChat(c.x+DISPLAY_SIZE/2,c.y-50,'whisper',tid));}}else{const dt=now-dragStartTime,dist=mouseDownPos?Math.hypot(e.clientX-mouseDownPos.x,e.clientY-mouseDownPos.y):0,speed=dist/(dt||1)*1000;if(tutorial&&tutorial.isActive){tutorial.triggerAction('drag-character');}if(dragTarget==='self'){myChar.isGrabbed=false;if(speed>THROW_SPEED_THRESHOLD){playSound('throw');myChar.state='thrown';myChar.vx=(e.clientX-mouseDownPos.x)*0.15;myChar.vy=Math.min((e.clientY-mouseDownPos.y)*0.15,-3);}else{myChar.state='fall';myChar.vy=1;myChar.vx=0;}}else if(socket){if(speed>THROW_SPEED_THRESHOLD){playSound('throw');socket.emit('throw-other',{targetId:dragTarget,vx:(e.clientX-mouseDownPos.x)*0.1,vy:-3});}else socket.emit('drop-other',{targetId:dragTarget});}}ipcRenderer.send('set-ignore-mouse',true);dragTarget=null;mouseDownPos=null;isDragging=false;});

// ════ 퀵채팅 ════
const quickChat=document.getElementById('quickChat'),quickChatInput=document.getElementById('quickChatInput'),quickChatLabel=document.getElementById('quickChatLabel');
let quickChatMode='chat',quickWhisperTarget=null;
function openQuickChat(x,y,mode,tid){quickChatMode=mode;quickWhisperTarget=tid||null;quickChatLabel.textContent=mode==='whisper'?'🤫 '+(otherChars[tid]&&otherChars[tid].name||'???'):'💬 전체';quickChat.style.left=Math.min(x,window.innerWidth-260)+'px';quickChat.style.top=Math.max(y,30)+'px';quickChat.classList.add('visible');let emojiBar=quickChat.querySelector('.emoji-bar');if(!emojiBar){emojiBar=document.createElement('div');emojiBar.className='emoji-bar';emojiBar.style.cssText='display:flex;gap:2px;flex-wrap:wrap;margin-top:4px;';EMOJIS.forEach(em=>{const btn=document.createElement('button');btn.textContent=em;btn.style.cssText='background:none;border:1px solid #2a2a35;border-radius:8px;padding:4px 6px;cursor:pointer;font-size:14px;';btn.addEventListener('click',()=>{quickChatInput.value+=em;quickChatInput.focus();});emojiBar.appendChild(btn);});quickChat.appendChild(emojiBar);}quickChatInput.value='';quickChatInput.focus();ipcRenderer.send('set-ignore-mouse',false);}
quickChatInput.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&quickChatInput.value.trim()&&socket){const m=quickChatInput.value.trim();if(quickChatMode==='chat')socket.emit('chat',{message:m});else if(quickWhisperTarget)socket.emit('whisper',{targetId:quickWhisperTarget,message:m});quickChatInput.value='';quickChat.classList.remove('visible');ipcRenderer.send('set-ignore-mouse',true);}if(e.key==='Escape'){quickChat.classList.remove('visible');ipcRenderer.send('set-ignore-mouse',true);}});

// ════ 폰 UI ════
const phone=document.getElementById('phone'),phoneClose=document.getElementById('phoneClose'),phoneBack=document.getElementById('phoneBack'),phoneTitle=document.getElementById('phoneTitle');
const pages=document.querySelectorAll('.phone-page'),homeIcons=document.querySelectorAll('.home-icon');let currentPage='home';
const PAGE_TITLES={home:'🐾 Hellowee',chat:'💬 채팅',lobby:'🏠 로비',custom:'🎨 꾸미기',settings:'⚙️ 설정'};
function openPhone(p){currentPage=p||'home';phone.classList.add('visible');playSound('phoneOpen');ipcRenderer.send('set-ignore-mouse',false);switchPage(currentPage);hideAlert();}
function closePhone(){phone.classList.remove('visible');playSound('phoneClose');ipcRenderer.send('set-ignore-mouse',true);}
phoneClose.addEventListener('click',closePhone);
phoneBack.addEventListener('click',()=>{playSound('click');switchPage('home');});
homeIcons.forEach(i=>{i.addEventListener('click',()=>{playSound('click');switchPage(i.dataset.page);});});
function switchPage(p){currentPage=p;pages.forEach(pg=>pg.classList.toggle('active',pg.id==='page'+p));phoneTitle.textContent=PAGE_TITLES[p]||'🐾 Hellowee';phoneBack.classList.toggle('visible',p!=='home');if(p==='chat')renderChatMessages();if(p==='lobby')updateLobbyUI();if(p==='settings')document.getElementById('settingsNicknameVal').textContent=myChar.name;}

// ════ 채팅 ════
const chatMessages=document.getElementById('chatMessages'),chatPageInput=document.getElementById('chatPageInput'),chatPageSend=document.getElementById('chatPageSend');
const chatSubTabs=document.querySelectorAll('.chat-sub-tab');let chatSubTab='all';
chatSubTabs.forEach(t=>{t.addEventListener('click',()=>{chatSubTab=t.dataset.subtab;chatSubTabs.forEach(x=>x.classList.toggle('active',x.dataset.subtab===chatSubTab));renderChatMessages();});});
function renderChatMessages(){chatMessages.innerHTML='';const log=chatSubTab==='all'?chatHistory:whisperHistory;log.forEach(msg=>{const div=document.createElement('div');const mine=msg.id===(socket&&socket.id)||msg.fromId===(socket&&socket.id);div.className='chat-msg '+(mine?'mine':'other');const nm=!mine?'<div class="chat-msg-name">'+(msg.name||msg.fromName)+'</div>':'';const t=new Date(msg.time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});div.innerHTML=nm+msg.message+'<div class="chat-msg-time">'+t+'</div>';chatMessages.appendChild(div);});chatMessages.scrollTop=chatMessages.scrollHeight;}
function sendChatPageMsg(){const m=chatPageInput.value.trim();if(!m||!socket)return;if(chatSubTab==='all')socket.emit('chat',{message:m});chatPageInput.value='';}
chatPageSend.addEventListener('click',sendChatPageMsg);chatPageInput.addEventListener('keydown',(e)=>{if(e.key==='Enter')sendChatPageMsg();});

// ════ 로비 ════
const lobbyCreate=document.getElementById('lobbyCreate'),lobbyJoin=document.getElementById('lobbyJoin'),lobbyMyName=document.getElementById('lobbyMyName'),lobbyRoomName=document.getElementById('lobbyRoomName');
const lobbyCode=document.getElementById('lobbyCode'),lobbyJoinName=document.getElementById('lobbyJoinName'),lobbyJoinRoomName=document.getElementById('lobbyJoinRoomName');
const lobbyRoomCode=document.getElementById('lobbyRoomCode'),lobbyRoomTitle=document.getElementById('lobbyRoomTitle'),lobbyMembers=document.getElementById('lobbyMembers'),lobbyError=document.getElementById('lobbyError');
const lobbyCopyCode=document.getElementById('lobbyCopyCode');
lobbyCopyCode.addEventListener('click',()=>{if(!currentRoom)return;const text='🐾 Hellowee 방 초대!\n방 이름: '+lobbyRoomTitle.textContent+'\n방 코드: '+currentRoom;navigator.clipboard.writeText(text);lobbyCopyCode.textContent='✅ 복사됨';setTimeout(()=>{lobbyCopyCode.textContent='📋 초대링크';},1500);});
function saveLastRoom(code,roomName){try{const Store=require('electron-store');const s=new Store({name:'hellowee-auth'});s.set('lastRoom',{code:code,roomName:roomName});}catch(e){}}
lobbyCreate.addEventListener('click',()=>{const name=lobbyMyName.value.trim()||myChar.name;const roomName=lobbyRoomName.value.trim()||'Hellowee Room';myChar.name=name;if(socket)socket.disconnect();connectSocket();socket.on('connect',()=>{socket.emit('create-room',{roomName:roomName,name:name,parts:myChar.parts},(res)=>{if(res.success){currentRoom=res.code;saveLastRoom(res.code,roomName);updateLobbyUI();switchPage('home');lobbyError.textContent='';}});});});
lobbyJoin.addEventListener('click',()=>{const code=lobbyCode.value.trim().toUpperCase(),roomName=lobbyJoinRoomName.value.trim(),name=lobbyJoinName.value.trim()||myChar.name;if(!code||!roomName){lobbyError.textContent='방 이름과 코드를 모두 입력해주세요';return;}myChar.name=name;if(socket)socket.disconnect();connectSocket();socket.on('connect',()=>{socket.emit('join-room',{code:code,roomName:roomName,name:name,parts:myChar.parts},(res)=>{if(res.success){currentRoom=res.code;saveLastRoom(res.code,roomName);updateLobbyUI();switchPage('home');lobbyError.textContent='';}else{lobbyError.textContent=res.error;}});});});
function updateLobbyUI(){lobbyRoomCode.textContent=currentRoom||'---';lobbyMembers.innerHTML='';if(currentRoom){const me=document.createElement('div');me.className='lobby-member';me.innerHTML='<div class="lobby-member-left"><span class="lobby-member-dot"></span> '+myChar.name+' (나)'+(isRoomOwner?' 👑':'')+'</div>';lobbyMembers.appendChild(me);Object.entries(otherChars).forEach(function(entry){var id=entry[0],c=entry[1];const div=document.createElement('div');div.className='lobby-member';let statusTag=c.status?' <span style="font-size:9px;color:#888">'+c.status+'</span>':'';let html='<div class="lobby-member-left"><span class="lobby-member-dot"></span> '+c.name+statusTag+'</div>';if(isRoomOwner){html+='<div style="display:flex;gap:4px;"><button class="lobby-kick-btn" data-kick-id="'+id+'">강퇴</button><button class="lobby-kick-btn" data-transfer-id="'+id+'" style="border-color:#6C8EBF;color:#6C8EBF;">위임</button></div>';}div.innerHTML=html;lobbyMembers.appendChild(div);});lobbyMembers.querySelectorAll('.lobby-kick-btn[data-kick-id]').forEach(btn=>{btn.addEventListener('click',(e)=>{e.stopPropagation();const tid=btn.dataset.kickId;if(socket&&confirm((otherChars[tid]&&otherChars[tid].name||'')+'님을 강퇴할까요?'))socket.emit('kick-user',{targetId:tid});});});lobbyMembers.querySelectorAll('.lobby-kick-btn[data-transfer-id]').forEach(btn=>{btn.addEventListener('click',(e)=>{e.stopPropagation();const tid=btn.dataset.transferId;if(socket&&confirm((otherChars[tid]&&otherChars[tid].name||'')+'님에게 방장을 넘길까요?'))socket.emit('transfer-owner',{targetId:tid});});});}}

// ════ 꾸미기 (Live2D 텍스처 교체 연동) ════
const customSection=document.querySelector('.custom-section');const labelMap={body:'피부',eyes:'눈',mouth:'입',hair:'헤어',clothes:'옷',accessory:'악세서리'};
LAYER_ORDER.forEach(layer=>{const row=document.createElement('div');row.className='custom-row';const label=document.createElement('div');label.className='custom-label';label.textContent=labelMap[layer];row.appendChild(label);const wrap=document.createElement('div');wrap.className='custom-options';PARTS_OPTIONS[layer].forEach(opt=>{const btn=document.createElement('button');btn.className='custom-btn';if(myChar.parts[layer]===opt)btn.classList.add('active');btn.textContent=opt;btn.addEventListener('click',()=>{myChar.parts[layer]=opt;wrap.querySelectorAll('.custom-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
      // ★ Live2D 텍스처 교체
      if(useLive2D){const l2d=l2dManager.getCharacter('self');if(l2d)l2d.swapTexture(layer,opt);}
      if(socket)socket.emit('update-parts',myChar.parts);});wrap.appendChild(btn);});row.appendChild(wrap);customSection.appendChild(row);});

// ════ 설정 ════
const togglePin=document.getElementById('togglePin'),toggleAttention=document.getElementById('toggleAttention'),toggleBubble=document.getElementById('toggleBubble'),toggleSound=document.getElementById('toggleSound');
const settingsLeave=document.getElementById('settingsLeave'),settingsNickname=document.getElementById('settingsNickname'),settingsTutorial=document.getElementById('settingsTutorial');
togglePin.addEventListener('click',()=>{settingPin=!settingPin;togglePin.classList.toggle('on',settingPin);ipcRenderer.send('toggle-pin');});
toggleAttention.addEventListener('click',()=>{settingAttention=!settingAttention;toggleAttention.classList.toggle('on',settingAttention);});
toggleBubble.addEventListener('click',()=>{settingBubble=!settingBubble;toggleBubble.classList.toggle('on',settingBubble);});
toggleSound.addEventListener('click',()=>{settingSound=!settingSound;toggleSound.classList.toggle('on',settingSound);});
settingsLeave.addEventListener('click',()=>{if(socket)socket.disconnect();currentRoom=null;isRoomOwner=false;try{const Store=require('electron-store');const s=new Store({name:'hellowee-auth'});s.delete('lastRoom');}catch(e){}Object.keys(otherChars).forEach(id=>{
  // ★ Live2D 캐릭터도 제거
  l2dManager.removeCharacter(id);
  if(otherChars[id].el)otherChars[id].el.remove();if(otherChars[id].nameEl)otherChars[id].nameEl.remove();delete otherChars[id];});chatHistory=[];whisperHistory=[];updateLobbyUI();switchPage('lobby');});
const nicknameModal=document.getElementById('nicknameModal'),nicknameInput=document.getElementById('nicknameInput'),nicknameCancel=document.getElementById('nicknameCancel'),nicknameConfirm=document.getElementById('nicknameConfirm');
settingsNickname.addEventListener('click',()=>{nicknameInput.value=myChar.name;nicknameModal.classList.add('visible');});
nicknameCancel.addEventListener('click',()=>nicknameModal.classList.remove('visible'));
nicknameConfirm.addEventListener('click',()=>{const n=nicknameInput.value.trim();if(n){myChar.name=n;document.getElementById('settingsNicknameVal').textContent=n;nicknameModal.classList.remove('visible');}});
const statusContainer=document.getElementById('statusContainer');
if(statusContainer){STATUS_LIST.forEach(s=>{const btn=document.createElement('button');btn.textContent=s;btn.style.cssText='padding:5px 10px;border-radius:99px;border:1px solid #2a2a35;background:#1a1a22;color:#aaa;font-size:10px;cursor:pointer;margin:2px;';btn.addEventListener('click',()=>{myChar.status=s;if(socket)socket.emit('update-status',{status:s});statusContainer.querySelectorAll('button').forEach(b=>b.style.borderColor='#2a2a35');btn.style.borderColor='#6C8EBF';});statusContainer.appendChild(btn);});}
settingsTutorial.addEventListener('click',()=>{closePhone();Tutorial.reset();startTutorial();});
ipcRenderer.on('pin-status',(ev,p)=>{settingPin=p;togglePin.classList.toggle('on',p);});ipcRenderer.send('get-pin-status');

// ════ 튜토리얼 ════
let tutorial=null;
function startTutorial(){tutorial=new Tutorial({onStep:function(step,i){playSound('click');},onFinish:function(){tutorial=null;openPhone('lobby');},onSkip:function(){tutorial=null;openPhone('lobby');}});tutorial.start();}

// ════ 말풍선 시스템 ════
const activeBubbles=[];
function showBubble(cx,cy,msg,type){if(!settingBubble)return null;const b=document.createElement('div');b.className='bubble'+(type==='whisper'?' whisper':'');b.textContent=msg;b.style.left=(cx+DISPLAY_SIZE/2)+'px';b.style.top=(cy-40)+'px';document.body.appendChild(b);setTimeout(()=>{b.style.opacity='0';b.style.transition='opacity 0.3s';setTimeout(()=>b.remove(),300);},BUBBLE_DURATION);return b;}
function createTrackedBubble(g,msg,type){const p=g();const b=showBubble(p.x,p.y,msg,type);if(!b)return;const t={el:b,charGetter:g};activeBubbles.push(t);setTimeout(()=>{const i=activeBubbles.indexOf(t);if(i>-1)activeBubbles.splice(i,1);},BUBBLE_DURATION+300);}
function updateBubbles(){activeBubbles.forEach(b=>{if(!b.el.parentElement)return;const p=b.charGetter();b.el.style.left=(p.x+DISPLAY_SIZE/2)+'px';b.el.style.top=(p.y-40)+'px';});if(activeEmptyBubble&&activeEmptyBubble.updatePos)activeEmptyBubble.updatePos();}
function showAlert(){alertBadge.style.display='block';alertBadge.textContent=isAttentionMode()?'!!':'!';alertBadge.style.background=isAttentionMode()?'#ff2020':'#ff4757';document.getElementById('badgeChat').classList.add('show');playSound('alert');}
function hideAlert(){alertBadge.style.display='none';unreadChat=0;unreadWhisper=0;hasGrabbedMouse=false;document.getElementById('badgeChat').classList.remove('show');}
function updateAlertPos(){alertBadge.style.left=(myChar.x+DISPLAY_SIZE-5)+'px';alertBadge.style.top=(myChar.y-10)+'px';}

// ════ 근접 인터랙션 ════
let interactCooldown=0;
function checkProximityInteract(){if(interactCooldown>0){interactCooldown--;return;}const mx=myChar.x+DISPLAY_SIZE/2;Object.values(otherChars).forEach(c=>{const cx=c.x+DISPLAY_SIZE/2;if(Math.abs(mx-cx)<INTERACT_DIST&&Math.abs(myChar.y-c.y)<DISPLAY_SIZE/2){myChar.state='wave';myChar.dir=cx>mx?1:-1;if(socket)socket.emit('interact',{});interactCooldown=300;setTimeout(()=>{if(myChar.state==='wave')myChar.state='idle';},1500);}});}

// ════ 랜덤 걷기 ════
let walkTimer=0;
function randomWalk(){if(Math.random()<0.4){myChar.state='walk';myChar.dir=Math.random()<0.5?1:-1;myChar.vx=myChar.dir*1.5;walkTimer=60+Math.random()*120;}else{myChar.state='idle';myChar.vx=0;walkTimer=60+Math.random()*180;}}

// ════ 어텐션 모드 ════
function updateAttentionMode(){if(!isAttentionMode()||myChar.isGrabbed||myChar.forcedGrab||myChar.y<FLOOR_Y)return false;const cx=myChar.x+DISPLAY_SIZE/2,d=Math.abs(mousePos.x-cx);mouseIsIdle=(Date.now()-lastActivityTime)>MOUSE_IDLE_TIME;if(d>DISPLAY_SIZE/2){myChar.state='walk';myChar.dir=mousePos.x>cx?1:-1;myChar.vx=myChar.dir*CHASE_SPEED;}else{myChar.vx=0;if(mouseIsIdle&&!hasGrabbedMouse){hasGrabbedMouse=true;myChar.state='grabbed';myChar.attentionGrab=true;myChar.forcedGrab=true;myChar.x=mousePos.x-DISPLAY_SIZE/2;myChar.y=mousePos.y-DISPLAY_SIZE/2;setTimeout(()=>openPhone('chat'),500);}else if(!mouseIsIdle)myChar.state='idle';}return true;}

// ════ 메인 루프 ════
let lastTime=0;
function loop(ts){const dt=ts-lastTime;lastTime=ts;if(!myChar.isGrabbed&&!myChar.forcedGrab){if(myChar.y<FLOOR_Y){myChar.vy+=GRAVITY;if(myChar.state!=='thrown')myChar.state='fall';}else{myChar.y=FLOOR_Y;myChar.vy=0;if(myChar.state==='fall'||myChar.state==='thrown'){playSound('land');myChar.state='land';myChar.vx=0;setTimeout(()=>{myChar.state='idle';randomWalk();},300);}if(!updateAttentionMode()&&!RANDOM_ACTIONS.includes(myChar.state)){walkTimer--;if(walkTimer<=0&&myChar.state!=='land')randomWalk();}myChar.x+=myChar.vx;checkProximityInteract();}myChar.y+=myChar.vy;myChar.x=Math.max(0,Math.min(window.innerWidth-DISPLAY_SIZE,myChar.x));myChar.y=Math.min(FLOOR_Y,myChar.y);}else if(myChar.attentionGrab){myChar.x=mousePos.x-DISPLAY_SIZE/2;myChar.y=mousePos.y-DISPLAY_SIZE/2;}

  // ★ 프레임 애니메이션 (스프라이트 폴백용)
  myChar.frameTimer+=dt;if(myChar.frameTimer>1000/FPS){myChar.frameTimer=0;myChar.frame=(myChar.frame+1)%(ANIM_FRAMES[myChar.state]||2);}

  // ★ 렌더 (Live2D 또는 스프라이트)
  renderChar(myChar, 'self');
  updateAlertPos();updateBubbles();

  Object.entries(otherChars).forEach(function(entry){
    var id=entry[0], c=entry[1];
    renderChar(c, id);
    if(c.nameEl){c.nameEl.style.left=(c.x+DISPLAY_SIZE/2)+'px';c.nameEl.style.top=(c.y-18)+'px';}
  });

  if(socket&&socket.connected){socket.volatile.emit('move',{x:myChar.x,y:myChar.y,state:myChar.state,dir:myChar.dir,frame:myChar.frame});}requestAnimationFrame(loop);}

// ════ 퇴장 애니메이션 ════
function animateLeave(id){const c=otherChars[id];if(!c)return;c.state='wave';createTrackedBubble(()=>({x:c.x,y:c.y}),'👋 안녕~','chat');playSound('leave');setTimeout(()=>{
  // ★ Live2D 캐릭터 페이드아웃
  const l2d=l2dManager.getCharacter(id);
  if(l2d){const el=l2d.getElement();if(el){el.style.transition='opacity 0.5s';el.style.opacity='0';}}
  if(c.el){c.el.style.transition='opacity 0.5s';c.el.style.opacity='0';}if(c.nameEl){c.nameEl.style.transition='opacity 0.5s';c.nameEl.style.opacity='0';}setTimeout(()=>{
    l2dManager.removeCharacter(id);
    if(c.el)c.el.remove();if(c.nameEl)c.nameEl.remove();delete otherChars[id];updateLobbyUI();},500);},WAVE_LEAVE_DURATION);}

// ════ 소켓 ════
let socket;
function connectSocket(){socket=io(SERVER_URL);
  socket.on('room-info',function(data){currentRoom=data.code;isRoomOwner=data.isOwner;lobbyRoomCode.textContent=data.code;lobbyRoomTitle.textContent=data.name;updateLobbyUI();});

  socket.on('user-joined',async function(data){
    var id=data.id, name=data.name, parts=data.parts, status=data.status;
    if(otherChars[id])return;playSound('join');

    // ★ Live2D 모드: 다른 유저도 Live2D로 생성
    let l2dChar = null;
    if(useLive2D){
      l2dChar = await l2dManager.createOtherCharacter(id, 'hellowee_default');
      if(l2dChar && parts) l2dChar.applyAllParts(parts);
    }

    // 스프라이트 폴백 (또는 Live2D 실패 시)
    let el, ctx;
    if(!l2dChar){
      el=document.createElement('canvas');el.width=CHAR_SIZE;el.height=CHAR_SIZE;el.className='character';el.style.width=DISPLAY_SIZE+'px';el.style.height=DISPLAY_SIZE+'px';document.body.appendChild(el);ctx=el.getContext('2d');
    } else {
      el=l2dChar.getElement();
      ctx=null;
    }

    const nameEl=document.createElement('div');nameEl.className='nameplate';nameEl.textContent=name;document.body.appendChild(nameEl);
    otherChars[id]={x:Math.random()*(window.innerWidth-DISPLAY_SIZE),y:FLOOR_Y,vx:0,vy:0,state:'idle',dir:1,frame:0,frameTimer:0,name:name,status:status||'',parts:parts||{},el:el,ctx:ctx,nameEl:nameEl};

    // 이벤트 바인딩 (Live2D든 Canvas든)
    bindCharacterEvents(el, id);
    updateLobbyUI();
  });

  socket.on('user-parts-updated',function(data){
    if(otherChars[data.id])otherChars[data.id].parts=data.parts;
    // ★ Live2D 텍스처 동기화
    if(useLive2D){const l2d=l2dManager.getCharacter(data.id);if(l2d)l2d.applyAllParts(data.parts);}
  });

  socket.on('user-status-updated',function(data){if(otherChars[data.id]){otherChars[data.id].status=data.status;updateLobbyUI();}});
  socket.on('user-moved',function(data){if(otherChars[data.id])Object.assign(otherChars[data.id],{x:data.x,y:data.y,state:data.state,dir:data.dir,frame:data.frame});});
  socket.on('user-leaving',function(data){animateLeave(data.id);});
  socket.on('user-left',function(data){if(data.type==='kicked'&&otherChars[data.id]){l2dManager.removeCharacter(data.id);otherChars[data.id].el.remove();otherChars[data.id].nameEl.remove();delete otherChars[data.id];updateLobbyUI();}});
  socket.on('kicked',function(data){alert(data.reason);currentRoom=null;isRoomOwner=false;Object.keys(otherChars).forEach(id=>{l2dManager.removeCharacter(id);otherChars[id].el.remove();otherChars[id].nameEl.remove();delete otherChars[id];});switchPage('lobby');});
  socket.on('owner-changed',function(data){isRoomOwner=(data.newOwnerId===socket.id);updateLobbyUI();createTrackedBubble(()=>({x:myChar.x,y:myChar.y}),'👑 '+data.newOwnerName+'님이 새 방장!','chat');});
  socket.on('chat-message',function(data){chatHistory.push(data);if(data.id===socket.id)createTrackedBubble(()=>({x:myChar.x,y:myChar.y}),data.message,'chat');else if(otherChars[data.id]){createTrackedBubble(()=>({x:otherChars[data.id].x,y:otherChars[data.id].y}),data.message,'chat');unreadChat++;showAlert();playSound('chat');}if(phone.classList.contains('visible')&&currentPage==='chat'&&chatSubTab==='all'){renderChatMessages();unreadChat=0;}});
  socket.on('whisper-message',function(data){whisperHistory.push(data);if(data.fromId===socket.id)createTrackedBubble(()=>({x:myChar.x,y:myChar.y}),data.message,'whisper');else if(otherChars[data.fromId]){createTrackedBubble(()=>({x:otherChars[data.fromId].x,y:otherChars[data.fromId].y}),data.message,'whisper');unreadWhisper++;showAlert();playSound('whisper');}if(phone.classList.contains('visible')&&currentPage==='chat'&&chatSubTab==='whisper'){renderChatMessages();unreadWhisper=0;}});
  socket.on('chat-history',function(log){chatHistory=log;});socket.on('whisper-history',function(log){whisperHistory=log;});
  socket.on('force-grabbed',function(){myChar.forcedGrab=true;myChar.state='grabbed';myChar.vx=0;myChar.vy=0;playSound('grab');});
  socket.on('char-dragged',function(data){if(data.targetId===socket.id){myChar.x=data.x;myChar.y=data.y;}else if(otherChars[data.targetId]){otherChars[data.targetId].x=data.x;otherChars[data.targetId].y=data.y;otherChars[data.targetId].state='grabbed';}});
  socket.on('force-thrown',function(data){myChar.forcedGrab=false;myChar.attentionGrab=false;myChar.state='thrown';myChar.vx=data.vx;myChar.vy=data.vy;playSound('throw');});
  socket.on('force-dropped',function(){myChar.forcedGrab=false;myChar.attentionGrab=false;myChar.state='fall';myChar.vy=1;myChar.vx=0;});
  socket.on('char-thrown',function(data){if(otherChars[data.targetId])otherChars[data.targetId].state='fall';});
  socket.on('char-dropped',function(data){if(otherChars[data.targetId])otherChars[data.targetId].state='fall';});
  socket.on('char-grabbed',function(data){if(otherChars[data.targetId])otherChars[data.targetId].state='grabbed';});
}

// ════ 시작 ════
// Live2D 초기화 시도 후 루프 시작
initLive2D().then(function() {
  requestAnimationFrame(loop);
});
