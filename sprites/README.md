# 스프라이트 규칙

## 크기
- 캔버스: **256×256px** (클리한 스타일로 그리기)
- 화면 표시: 128px (CSS로 축소)
- 투명배경 PNG

## 스프라이트시트
동작별로 프레임을 가로로 이어붙인 형태
예: idle 4프레임 = 1024×256px (256×4)

## 프레임 수
| 동작 | 프레임 | 시트 크기 |
|--------|--------|----------|
| idle | 4 | 1024×256 |
| walk | 6 | 1536×256 |
| fall | 2 | 512×256 |
| grabbed | 2 | 512×256 |
| land | 2 | 512×256 |
| thrown | 3 | 768×256 |
| wave | 6 | 1536×256 |
| sit | 4 | 1024×256 |
| nod | 4 | 1024×256 |
| jump | 5 | 1280×256 |

## 방향
오른쪽 보는 방향만 그리기 (좌우반전은 코드에서)

## 폴더 구조
```
sprites/
├── body/{option}/{action}.png
├── eyes/{option}/{action}.png
├── mouth/{option}/{action}.png
├── hair/{option}/{action}.png
├── clothes/{option}/{action}.png
└── accessory/{option}/{action}.png
```
