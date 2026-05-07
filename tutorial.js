// ════════════════════════════════════════════
//  Hellowee Tutorial System
//  첫 실행 시 자동 / 설정에서 다시보기
// ════════════════════════════════════════════

const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    message: '안녕! 나는 너의 Hellowee 캐릭터야 🐾',
    target: 'character',   // 캐릭터 옆에 말풍선
    action: 'next',         // 다음 버튼으로 진행
  },
  {
    id: 'click-me',
    message: '나를 한번 클릭해봐!',
    target: 'character',
    action: 'click-character', // 유저가 캐릭터 클릭해야 다음
  },
  {
    id: 'bubble-explain',
    message: '이 말풍선을 누르면 모두에게 \n메시지를 보낼 수 있어! 💬',
    target: 'character',
    action: 'next',
  },
  {
    id: 'double-click',
    message: '이번엔 나를 빠르게 \n두 번 클릭해봐!',
    target: 'character',
    action: 'dblclick-character',
  },
  {
    id: 'phone-explain',
    message: '짠! 이게 너의 Hellowee 폰이야 📱\n여기서 다 할 수 있어!',
    target: 'phone',
    action: 'next',
  },
  {
    id: 'home-icons',
    message: '💬채팅  🏠로비  🎨꾸미기  ⚙️설정\n아이콘을 탭해서 이동해!',
    target: 'phone',
    action: 'next',
  },
  {
    id: 'lobby-explain',
    message: '🏠 로비에서 방을 만들거나\n친구 방에 입장할 수 있어!',
    target: 'phone',
    action: 'next',
  },
  {
    id: 'drag-explain',
    message: '나를 드래그해봐!\n느리면 떨구기, 빠르면 던지기 😆',
    target: 'character',
    action: 'drag-character',
  },
  {
    id: 'whisper-explain',
    message: '친구 캐릭터를 클릭하면\n귓속말을 보낼 수 있어 🤫',
    target: 'character',
    action: 'next',
  },
  {
    id: 'done',
    message: '준비 완료! \n친구들이랑 놀자 🐾🎉',
    target: 'character',
    action: 'finish',
  },
];

class Tutorial {
  constructor({ onStep, onFinish, onSkip }) {
    this.currentStep = 0;
    this.isActive = false;
    this.onStep = onStep;       // (step, index) => void
    this.onFinish = onFinish;   // () => void
    this.onSkip = onSkip;       // () => void
    this.overlay = null;
    this.guideEl = null;
  }

  // 튜토리얼 시작
  start() {
    this.currentStep = 0;
    this.isActive = true;
    this.createOverlay();
    this.showStep();
  }

  // 오버레이 생성
  createOverlay() {
    if (this.overlay) this.overlay.remove();

    this.overlay = document.createElement('div');
    this.overlay.className = 'tutorial-overlay';
    this.overlay.innerHTML = `
      <div class="tutorial-guide" id="tutorialGuide">
        <div class="tutorial-message" id="tutorialMsg"></div>
        <div class="tutorial-btns">
          <button class="tutorial-btn skip" id="tutorialSkip">건너뛰기</button>
          <button class="tutorial-btn next" id="tutorialNext">다음</button>
        </div>
        <div class="tutorial-progress" id="tutorialProgress"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.guideEl = document.getElementById('tutorialGuide');
    document.getElementById('tutorialSkip').addEventListener('click', () => this.skip());
    document.getElementById('tutorialNext').addEventListener('click', () => this.next());
  }

  // 현재 스텝 표시
  showStep() {
    if (this.currentStep >= TUTORIAL_STEPS.length) {
      this.finish();
      return;
    }

    const step = TUTORIAL_STEPS[this.currentStep];
    const msgEl = document.getElementById('tutorialMsg');
    const nextBtn = document.getElementById('tutorialNext');
    const progressEl = document.getElementById('tutorialProgress');

    // 메시지 (\n 줄바꿈 지원)
    msgEl.innerHTML = step.message.replace(/\n/g, '<br>');

    // 버튼 텍스트
    if (step.action === 'finish') {
      nextBtn.textContent = '시작하기! 🎉';
      nextBtn.style.display = 'block';
    } else if (step.action === 'next') {
      nextBtn.textContent = '다음';
      nextBtn.style.display = 'block';
    } else {
      // 유저 액션 필요 → 다음 버튼 숨김
      nextBtn.style.display = 'none';
    }

    // 프로그레스 도트
    progressEl.innerHTML = TUTORIAL_STEPS.map((_, i) =>
      `<span class="tutorial-dot ${i === this.currentStep ? 'active' : i < this.currentStep ? 'done' : ''}"></span>`
    ).join('');

    // 콜백
    if (this.onStep) this.onStep(step, this.currentStep);
  }

  // 다음 스텝
  next() {
    const step = TUTORIAL_STEPS[this.currentStep];
    if (step.action === 'finish') {
      this.finish();
      return;
    }
    this.currentStep++;
    this.showStep();
  }

  // 유저 액션으로 진행
  triggerAction(actionType) {
    if (!this.isActive) return false;
    const step = TUTORIAL_STEPS[this.currentStep];
    if (step && step.action === actionType) {
      this.currentStep++;
      this.showStep();
      return true; // 액션 소비됨
    }
    return false;
  }

  // 건너뛰기
  skip() {
    this.isActive = false;
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    localStorage.setItem('hellowee_tutorial_done', 'true');
    if (this.onSkip) this.onSkip();
  }

  // 완료
  finish() {
    this.isActive = false;
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    localStorage.setItem('hellowee_tutorial_done', 'true');
    if (this.onFinish) this.onFinish();
  }

  // 튜토리얼 필요 여부
  static needsTutorial() {
    return localStorage.getItem('hellowee_tutorial_done') !== 'true';
  }

  // 리셋 (설정에서 다시보기)
  static reset() {
    localStorage.removeItem('hellowee_tutorial_done');
  }
}

module.exports = { Tutorial, TUTORIAL_STEPS };
