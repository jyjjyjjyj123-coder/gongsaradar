# 공사레이더 백엔드 서버

## 빠른 시작

```bash
# 1. 패키지 설치
npm install

# 2. 서버 실행
node server.js

# 3. 브라우저에서 접속
http://localhost:3001
```

## API 엔드포인트

### 건축인허가 데이터 조회
```
GET /api/building?serviceKey=YOUR_KEY&sigunguCd=11680&numOfRows=50
```

#### 주요 시군구코드
| 지역 | 코드 |
|------|------|
| 서울 강남구 | 11680 |
| 서울 서초구 | 11650 |
| 서울 송파구 | 11710 |
| 경기 성남 분당구 | 41135 |
| 경기 수원시 | 41011 |
| 인천 연수구 | 28185 |
| 부산 해운대구 | 26350 |

### 좌표 변환
```
GET /api/geocode?q=서울특별시+강남구+삼성동
```

## 프론트엔드 연동

index.html에서 API 호출 시 프록시 서버 URL 사용:
```javascript
const res = await fetch(`http://localhost:3001/api/building?serviceKey=${KEY}&sigunguCd=11680`);
```

## 배포 (Render.com 무료)
1. GitHub에 이 폴더 업로드
2. render.com → New Web Service → 연결
3. Start Command: `node server.js`
4. 환경변수 설정 불필요 (serviceKey는 프론트에서 전달)
