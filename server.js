// 공사레이더 — 국토부 API 프록시 서버
const express = require('express');
const cors = require('cors');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 루트 또는 public 폴더 자동 감지
const fs = require('fs');
const staticDir = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : __dirname;
app.use(express.static(staticDir));

// ─── 건축인허가 API 프록시 ───
app.get('/api/building', (req, res) => {
  const { serviceKey, sigunguCd = '11680', numOfRows = '50', pageNo = '1' } = req.query;
  if (!serviceKey) return res.status(400).json({ error: 'serviceKey 필요' });

  const decodedKey = decodeURIComponent(serviceKey);
  const apiPath = '/1613000/ArchPmsHubService/getApBasisOulnInfo'
    + '?serviceKey=' + encodeURIComponent(decodedKey)
    + '&sigunguCd=' + sigunguCd
    + '&numOfRows=' + numOfRows
    + '&pageNo=' + pageNo
    + '&_type=json';

  console.log('[API 요청] sigunguCd=' + sigunguCd, 'numOfRows=' + numOfRows);

  const options = {
    hostname: 'apis.data.go.kr',
    path: apiPath,
    headers: { 'Accept': 'application/json' }
  };

  https.get(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => { data += chunk; });
    apiRes.on('end', () => {
      console.log('[API 응답]', data.slice(0, 200));
      if (data.trim().startsWith('<')) {
        const codeMatch = data.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/);
        const msgMatch  = data.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/);
        const code = codeMatch ? codeMatch[1] : '?';
        const msg  = msgMatch  ? msgMatch[1]  : '';
        const explains = {
          '30': '서비스키 오류',
          '22': '트래픽 초과',
          '12': '서비스 없음',
          '20': '접근 거부'
        };
        return res.status(400).json({ error: '[' + code + '] ' + (explains[code] || msg) });
      }
      try {
        const json = JSON.parse(data);
        res.json(json);
      } catch(e) {
        res.status(500).json({ error: 'JSON 파싱 실패', raw: data.slice(0, 200) });
      }
    });
  }).on('error', err => res.status(500).json({ error: err.message }));
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
