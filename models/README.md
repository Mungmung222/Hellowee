# Hellowee Live2D 모델 가이드

## 디렉토리 구조

```
models/
  hellowee_default/
    hellowee_default.model3.json    ← 모델 설정 (진입점)
    hellowee_default.moc3           ← 컴파일된 모델 (Cubism Editor에서 내보내기)
    hellowee_default.physics3.json  ← 물리 시뮬레이션
    textures/                       ← 텍스처 PNG들
    motions/                        ← 모션 JSON들
```

## Cubism Editor 작업 규격
- 캔버스: **512 x 512 px**, 화면 표시: 128px
- 텍스처 아틀라스: **1024x1024** 또는 **2048x2048**
- 파츠: 시메지 스타일 SD 캐릭터

## 필수 파라미터

ParamAngleX/Y/Z, ParamBodyAngleX/Y/Z, ParamBreath,
ParamEyeLOpen/ROpen, ParamMouthOpenY, ParamHairFront,
ParamArmR, ParamAccessory

## 텍스처 교체 시스템

멀티 텍스처 슬롯 (0:body, 1:clothes, 2:eyes, 3:mouth, 4:hair, 5:accessory)
네이밍: `{slot}_{option}.png` (e.g. eyes_cat.png)
UV 매핑 절대 변경 금지!

## 모션 10종

idle(4s루프), walk(1s루프), wave(1.5s), sit(3s루프),
nod(1s), jump(0.8s), fall(루프), grabbed(루프), land(0.5s), thrown(0.8s)

## 물리: 바운시+말랑 (Delay 0.7~0.85, Accel 1.2~1.8)

자세한 내용은 docs/LIVE2D-MIGRATION.md 참고
