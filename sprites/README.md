# 스프라이트 규칙

## 크기
- 캔버스: **256×256px**
- 화면 표시: 128px (CSS로 축소)
- 투명배경 PNG

## 파일 형식
개별 PNG 파일 (스프라이트시트 X)

예: idle 4프레임
```
sprites/body/default/idle_0.png
sprites/body/default/idle_1.png
sprites/body/default/idle_2.png
sprites/body/default/idle_3.png
```

## 프레임 수
| 동작 | 프레임 |
|--------|--------|
| idle | 4 |
| walk | 6 |
| fall | 2 |
| grabbed | 2 |
| land | 2 |
| thrown | 3 |
| wave | 6 |
| sit | 4 |
| nod | 4 |
| jump | 5 |

→ 아라가 프레임 수 정하면 코드 반영 예정

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

Live2D에서 PNG 시퀀스로 내보내서 그대로 넣으면 됨!
