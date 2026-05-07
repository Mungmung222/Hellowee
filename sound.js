// ════════════════════════════════════════════
//  Hellowee Sound System
//  알림음, 채팅음, 상호작용음 등
// ════════════════════════════════════════════

class SoundManager {
  constructor() {
    this.enabled = true;
    this.volume = 0.5;
    this.sounds = {};
    this.audioCtx = null;
  }

  // Web Audio API 초기화 (유저 인터랙션 후 호출)
  init() {
    if (this.audioCtx) return;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.generateSounds();
  }

  // 합성 사운드 생성 (외부 파일 불필요!)
  generateSounds() {
    this.sounds = {
      // 채팅 메시지 수신
      chat: { freq: 800, duration: 0.08, type: 'sine', ramp: 900 },
      // 귓속말 수신
      whisper: { freq: 600, duration: 0.1, type: 'sine', ramp: 700 },
      // 알림 (! 뱃지)
      alert: { freq: 500, duration: 0.15, type: 'triangle', ramp: 700 },
      // 다른 캐릭터 입장
      join: { freq: 400, duration: 0.2, type: 'sine', ramp: 600 },
      // 다른 캐릭터 나감
      leave: { freq: 500, duration: 0.25, type: 'sine', ramp: 300 },
      // 잡기
      grab: { freq: 300, duration: 0.05, type: 'square', ramp: 200 },
      // 던지기
      throw: { freq: 200, duration: 0.12, type: 'sawtooth', ramp: 500 },
      // 착지
      land: { freq: 150, duration: 0.08, type: 'triangle', ramp: 100 },
      // UI 클릭
      click: { freq: 1000, duration: 0.04, type: 'sine', ramp: 800 },
      // 폰 열기
      phoneOpen: { freq: 600, duration: 0.06, type: 'sine', ramp: 800 },
      // 폰 닫기
      phoneClose: { freq: 800, duration: 0.06, type: 'sine', ramp: 500 },
    };
  }

  play(name) {
    if (!this.enabled || !this.audioCtx) return;
    const s = this.sounds[name];
    if (!s) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = s.type;
      osc.frequency.setValueAtTime(s.freq, this.audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(s.ramp, this.audioCtx.currentTime + s.duration);

      gain.gain.setValueAtTime(this.volume * 0.3, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + s.duration);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + s.duration + 0.05);
    } catch (e) {
      // 사운드 에러 무시
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  setEnabled(val) {
    this.enabled = val;
  }
}

module.exports = { SoundManager };
