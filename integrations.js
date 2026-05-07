// ════════════════════════════════════════════
//  Hellowee Integrations
//  renderer.js에서 require해서 사용
//  튜토리얼 + 사운드 통합 모듈
// ════════════════════════════════════════════

const { Tutorial } = require('./tutorial');
const { SoundManager } = require('./sound');

const sfx = new SoundManager();

// 첫 사용자 인터랙션 시 사운드 초기화
function initSound() {
  sfx.init();
}

// 튜토리얼 생성
function createTutorial({ onFinish }) {
  const tutorial = new Tutorial({
    onStep: (step, index) => {
      sfx.init(); // 첫 인터랙션에서 초기화
      sfx.play('click');
    },
    onFinish: () => {
      sfx.play('phoneOpen');
      if (onFinish) onFinish();
    },
    onSkip: () => {
      if (onFinish) onFinish();
    },
  });
  return tutorial;
}

// 렌더러에서 호출할 사운드 함수들
const sounds = {
  chat:      () => sfx.play('chat'),
  whisper:   () => sfx.play('whisper'),
  alert:     () => sfx.play('alert'),
  join:      () => sfx.play('join'),
  leave:     () => sfx.play('leave'),
  grab:      () => sfx.play('grab'),
  throw:     () => sfx.play('throw'),
  land:      () => sfx.play('land'),
  click:     () => sfx.play('click'),
  phoneOpen: () => sfx.play('phoneOpen'),
  phoneClose:() => sfx.play('phoneClose'),
};

module.exports = {
  sfx,
  sounds,
  initSound,
  createTutorial,
  Tutorial,
};
