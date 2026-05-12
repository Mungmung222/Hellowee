# Hellowee Live2D 전환 가이드

## 개요

PNG 스프라이트 프레임 애니메이션 → Live2D Cubism 4 모델 기반 렌더링으로 전환.
**하위 호환**: .moc3 파일이 없으면 자동으로 기존 스프라이트 모드로 폴백.

## 변경 파일

| 파일 | 상태 | 설명 |
|------|------|------|
| `package.json` | 수정 | pixi.js@7 + pixi-live2d-display 의존성 추가 |
| `renderer.js` | 수정 | 듀얼 렌더링 (Live2D/스프라이트 폴백) |
| `live2d-manager.js` | **신규** | Live2D 모델 관리 클래스 |
| `models/` | **신규** | Live2D 모델 파일 디렉토리 |

## 셋업

```bash
npm install
# models/hellowee_default/hellowee_default.moc3 필요!
npm start
```

## 아키텍처

```
renderer.js
  ├─ initLive2D()           → Live2DManager로 모델 로드 시도
  ├─ renderChar(charData, id)
  │   ├─ useLive2D=true  → renderCharLive2D()  (위치/모션/방향)
  │   └─ useLive2D=false → renderCharSprite()   (기존 Canvas)
  ├─ 꾸미기 UI 변경 시     → l2d.swapTexture()
  └─ 소켓 이벤트           → l2d.applyAllParts()

live2d-manager.js
  ├─ Live2DCharacter        → 개별 모델 래퍼
  │   ├─ load()             → PIXI.Application + Live2DModel.from()
  │   ├─ playMotion()       → MOTION_MAP으로 상태→모션 매핑
  │   ├─ setDirection()     → scale.x 반전
  │   ├─ swapTexture()      → 텍스처 슬롯별 교체
  │   └─ setParameter()     → 물리 파라미터 직접 제어
  └─ Live2DManager          → 멀티 캐릭터 관리 (Map)
```

## 모션 매핑

| Hellowee 상태 | Live2D 그룹 | 루프 | 설명 |
|---------------|-------------|------|------|
| idle | Idle | ✅ | 호흡 + 미세 움직임 |
| walk | Walk | ✅ | 좌우 흔들림 |
| fall | Fall | ✅ | 놀란 표정 |
| grabbed | Grabbed | ✅ | 몸 흔들림 |
| land | Land | ❌ | 찌그러짐→복귀 |
| thrown | Thrown | ❌ | 회전 |
| wave | Wave | ❌ | 손 흔들기 |
| sit | Sit | ✅ | 웅크림 |
| nod | Nod | ❌ | 고개 끄덕 |
| jump | Jump | ❌ | 점프 |

## 텍스처 교체 플로우

```
유저가 꾸미기에서 "고양이 눈" 선택
  → myChar.parts.eyes = 'cat'
  → l2d.swapTexture('eyes', 'cat')
  → models/hellowee_default/textures/eyes_cat.png 로드
  → PIXI 텍스처 → Live2D 텍스처 슬롯[2] 교체
  → socket.emit('update-parts') → 다른 유저에게 동기화
```

## TODO (모델 제작)

1. [ ] Cubism Editor에서 hellowee_default.moc3 제작
2. [ ] 기본 텍스처 아틀라스 (body_default.png) 제작
3. [ ] 10개 모션 Cubism Editor에서 키프레임 작업 후 내보내기
4. [ ] 텍스처 변형 (피부/눈/입/헤어/옷/악세 각 옵션) 제작
5. [ ] 물리 파라미터 튜닝 (바운시한 시메지 느낌)
6. [ ] 테스트: 모델 없이 실행 → 스프라이트 폴백 확인
7. [ ] 테스트: 모델 있이 실행 → Live2D 렌더 확인
