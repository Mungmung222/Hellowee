/**
 * live2d-manager.js
 * Hellowee Live2D 모델 관리 모듈
 * 
 * pixi-live2d-display를 래핑하여:
 * - 모델 로드/해제
 * - 텍스처 런타임 교체 (커스터마이징)
 * - 모션 매핑 및 재생
 * - 물리 시뮬레이션 (bounce/grab 반응)
 * - fallback (모델 없으면 기존 스프라이트)
 */

const path = require('path');
const PIXI = require('pixi.js');
const { Live2DModel, MotionPreloadStrategy } = require('pixi-live2d-display/cubism4');

// Live2D → PIXI 글로벌 연결 (필수)
Live2DModel.registerTicker(PIXI.Ticker);

// 상수
const MODEL_BASE = path.join(__dirname, 'models');
const CANVAS_SIZE = 512;
const DISPLAY_SIZE = 128;

// 모션 이름 매핑: Hellowee state → motion3.json 그룹
const MOTION_MAP = {
  idle:    { group: 'Idle',    index: 0, loop: true  },
  walk:    { group: 'Walk',    index: 0, loop: true  },
  fall:    { group: 'Fall',    index: 0, loop: true  },
  grabbed: { group: 'Grabbed', index: 0, loop: true  },
  land:    { group: 'Land',    index: 0, loop: false },
  thrown:  { group: 'Thrown',  index: 0, loop: false },
  wave:    { group: 'Wave',    index: 0, loop: false },
  sit:     { group: 'Sit',     index: 0, loop: true  },
  nod:     { group: 'Nod',     index: 0, loop: false },
  jump:    { group: 'Jump',    index: 0, loop: false },
};

// 텍스처 슬롯 매핑: 커스텀 카테고리 → 텍스처 인덱스
const TEXTURE_SLOTS = {
  body:      0,
  clothes:   1,
  eyes:      2,
  mouth:     3,
  hair:      4,
  accessory: 5,
};

// Live2D 캐릭터 래퍼
class Live2DCharacter {
  constructor(modelName, container) {
    this.modelName = modelName;
    this.container = container;
    this.model = null;
    this.app = null;
    this.canvas = null;
    this.currentState = 'idle';
    this.currentDir = 1;
    this.isReady = false;
    this.onReady = null;
    this._pendingTextures = {};
  }

  async load() {
    const modelDir = path.join(MODEL_BASE, this.modelName);
    const modelJsonPath = path.join(modelDir, this.modelName + '.model3.json');

    const fs = require('fs');
    if (!fs.existsSync(modelJsonPath)) {
      console.warn('[Live2D] 모델 파일 없음:', modelJsonPath);
      return false;
    }

    try {
      this.app = new PIXI.Application({
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        backgroundAlpha: 0,
        antialias: true,
        resolution: 1,
      });

      this.canvas = this.app.view;
      this.canvas.className = 'character';
      this.canvas.style.width = DISPLAY_SIZE + 'px';
      this.canvas.style.height = DISPLAY_SIZE + 'px';
      this.container.appendChild(this.canvas);

      const modelUrl = 'file://' + modelJsonPath.replace(/\\/g, '/');
      this.model = await Live2DModel.from(modelUrl, {
        motionPreload: MotionPreloadStrategy.IDLE,
      });

      this.model.anchor.set(0.5, 0.5);
      this.model.x = CANVAS_SIZE / 2;
      this.model.y = CANVAS_SIZE / 2;

      var scaleX = CANVAS_SIZE / this.model.width;
      var scaleY = CANVAS_SIZE / this.model.height;
      var scale = Math.min(scaleX, scaleY) * 0.9;
      this.model.scale.set(scale);

      this.app.stage.addChild(this.model);

      for (var slot in this._pendingTextures) {
        await this._applyTexture(slot, this._pendingTextures[slot]);
      }
      this._pendingTextures = {};

      this.isReady = true;
      if (this.onReady) this.onReady();
      console.log('[Live2D] 모델 로드 완료:', this.modelName);
      return true;
    } catch (err) {
      console.error('[Live2D] 모델 로드 실패:', err);
      this.destroy();
      return false;
    }
  }

  playMotion(stateName) {
    if (!this.isReady || !this.model) return;
    if (this.currentState === stateName) return;
    this.currentState = stateName;
    var mapping = MOTION_MAP[stateName];
    if (!mapping) return;
    try {
      var priority = mapping.loop ? 1 : 2;
      this.model.motion(mapping.group, mapping.index, priority);
    } catch (err) {
      console.warn('[Live2D] 모션 없음:', mapping.group, err.message);
    }
  }

  setDirection(dir) {
    if (!this.isReady || !this.model) return;
    if (this.currentDir === dir) return;
    this.currentDir = dir;
    this.model.scale.x = Math.abs(this.model.scale.x) * dir;
  }

  setPosition(x, y) {
    if (this.canvas) {
      this.canvas.style.left = x + 'px';
      this.canvas.style.top = y + 'px';
    }
  }

  async swapTexture(slotName, optionName) {
    if (optionName === 'none') return;
    var texturePath = path.join(
      MODEL_BASE, this.modelName, 'textures',
      slotName + '_' + optionName + '.png'
    );
    if (!this.isReady) {
      this._pendingTextures[slotName] = texturePath;
      return;
    }
    await this._applyTexture(slotName, texturePath);
  }

  async _applyTexture(slotName, texturePath) {
    if (!this.model) return;
    var fs = require('fs');
    if (!fs.existsSync(texturePath)) {
      console.warn('[Live2D] 텍스처 없음:', texturePath);
      return;
    }
    var slotIndex = TEXTURE_SLOTS[slotName];
    if (slotIndex === undefined) return;
    try {
      var modelRenderer = this.model.internalModel.renderer;
      var textureUrl = 'file://' + texturePath.replace(/\\/g, '/');
      var newTexture = await PIXI.Texture.fromURL(textureUrl);
      if (modelRenderer && modelRenderer.textures) {
        var oldTexture = modelRenderer.textures[slotIndex];
        if (oldTexture) oldTexture.destroy(true);
        modelRenderer.textures[slotIndex] = newTexture;
      }
      console.log('[Live2D] 텍스처 교체:', slotName);
    } catch (err) {
      console.error('[Live2D] 텍스처 교체 실패:', err);
    }
  }

  async applyAllParts(parts) {
    for (var slot in parts) {
      await this.swapTexture(slot, parts[slot]);
    }
  }

  setParameter(paramId, value) {
    if (!this.isReady || !this.model) return;
    try {
      var coreModel = this.model.internalModel.coreModel;
      var index = coreModel.getParameterIndex(paramId);
      if (index >= 0) {
        coreModel.setParameterValueById(paramId, value);
      }
    } catch (err) {}
  }

  getElement() { return this.canvas; }

  destroy() {
    if (this.model) { this.model.destroy(); this.model = null; }
    if (this.app) { this.app.destroy(true); this.app = null; }
    if (this.canvas && this.canvas.parentElement) this.canvas.remove();
    this.canvas = null;
    this.isReady = false;
  }
}

// 매니저: 여러 캐릭터 관리
class Live2DManager {
  constructor() {
    this.characters = new Map();
    this.fallbackMode = false;
  }

  async createMyCharacter(modelName) {
    var char = new Live2DCharacter(modelName || 'hellowee_default', document.body);
    var success = await char.load();
    if (!success) {
      console.warn('[Live2D] fallback 모드 (스프라이트)');
      this.fallbackMode = true;
      return null;
    }
    this.characters.set('self', char);
    return char;
  }

  async createOtherCharacter(id, modelName) {
    if (this.fallbackMode) return null;
    var char = new Live2DCharacter(modelName || 'hellowee_default', document.body);
    var success = await char.load();
    if (!success) return null;
    this.characters.set(id, char);
    return char;
  }

  removeCharacter(id) {
    var char = this.characters.get(id);
    if (char) { char.destroy(); this.characters.delete(id); }
  }

  getCharacter(id) { return this.characters.get(id) || null; }

  destroyAll() {
    this.characters.forEach(function(char) { char.destroy(); });
    this.characters.clear();
  }
}

module.exports = { Live2DManager, Live2DCharacter, MOTION_MAP, TEXTURE_SLOTS, DISPLAY_SIZE };
