// 공사레이더 — 국토부 API 프록시 서버
const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname + '/public'));

// ─── 건축인허가 API 프록시 ───
app.get('/api/building', (req, res) => {
  const { serviceKey, sigunguCd = '11680', numOfRows = '50', pageNo = '1' } = req.query;
  if (!serviceKey) return res.status(400).json({ error: 'serviceKey 필요' });

  // API 키 디코딩 (URL 인코딩된 경우 처리)
  const decodedKey = decodeURIComponent(serviceKey);

  const apiPath = '/1613000/ArchPmsHubService/getApBasisOulnInfo'
    + '?serviceKey=' + encodeURIComponent(decodedKey)
    + '&sigunguCd=' + sigunguCd
    + '&numOfRows=' + numOfRows
    + '&pageNo=' + pageNo
    + '&_type=json';

  console.log('[API 요청]', 'sigunguCd=' + sigunguCd, 'numOfRows=' + numOfRows);

  const options = {
    hostname: 'apis.data.go.kr',
    path: apiPath,
    headers: { 'Accept': 'application/json' }
  };

  https.get(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => { data += chunk; });
    apiRes.on('end', () => {
      console.log('[API 응답 앞부분]', data.slice(0, 150));

      // XML 오류 응답 처리
      if (data.trim().startsWith('<')) {
        const codeMatch = data.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/);
        const msgMatch  = data.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/);
        const code = codeMatch ? codeMatch[1] : '?';
        const msg  = msgMatch  ? msgMatch[1]  : '';
        const explains = {
          '30': '서비스키 오류 — 키를 확인하거나 재발급 후 시도',
          '22': '일일 트래픽 초과',
          '12': '해당 API 서비스 없음',
          '20': '접근 거부',
          '99': '기타 오류'
        };
        console.log('[XML 오류] 코드:', code, msg);
        return res.status(400).json({ error: '[' + code + '] ' + (explains[code] || msg || 'XML 오류 응답') });
      }

      // JSON 파싱
      try {
        const json = JSON.parse(data);
        console.log('[성공] resultCode:', json?.response?.header?.resultCode);
        res.json(json);
      } catch(e) {
        console.log('[JSON 파싱 실패] 원본:', data.slice(0, 300));
        res.status(500).json({ error: 'JSON 파싱 실패 — 원본: ' + data.slice(0, 200) });
      }
    });
  }).on('error', err => {
    console.log('[요청 오류]', err.message);
    res.status(500).json({ error: '서버 요청 오류: ' + err.message });
  });
});

// ─── 좌표 변환 프록시 ───
app.get('/api/geocode', (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q 필요' });
  const encoded = encodeURIComponent(q + ' 대한민국');
  const options = {
    hostname: 'nominatim.openstreetmap.org',
    path: '/search?q=' + encoded + '&format=json&limit=1',
    headers: { 'User-Agent': 'GongsaRadar/1.0' }
  };
  https.get(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => { data += chunk; });
    apiRes.on('end', () => {
      try { res.json(JSON.parse(data)); }
      catch(e) { res.status(500).json({ error: 'JSON 파싱 실패' }); }
    });
  }).on('error', err => res.status(500).json({ error: err.message }));
});

app.listen(PORT, () => {
  console.log('');
  console.log('✅ 공사레이더 서버 실행 중!');
  console.log('👉 브라우저에서 열기: http://localhost:' + PORT);
  console.log('');
});
