# 스프라이트 규칙

## 크기
- 그리기: **512×512px** (클리한 스타일로 그리기)
- 화면 표시: 128px (CSS로 축소 → 초선명)
- 투명배경 PNG

## 파일 형식
개별 PNG 파일 (Live2D PNG 시퀀스 내보내기 그대로)

예: idle 4프레임
```
sprites/body/default/idle_0.png
sprites/body/default/idle_1.png
sprites/body/default/idle_2.png
sprites/body/default/idle_3.png
```

## 프레임 수
아라가 정해서 알려주면 코드 반영 예정

## 방향
오른쪽 보는 방향만 (좌우반전은 코드에서)

## 폴더 구조
```
sprites/
├── body/{option}/{action}_{frame}.png
├── eyes/{option}/{action}_{frame}.png
├── mouth/{option}/{action}_{frame}.png
├── hair/{option}/{action}_{frame}.png
├── clothes/{option}/{action}_{frame}.png
└── accessory/{option}/{action}_{frame}.png
```
