const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

const staticDir = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public') : __dirname;
app.use(express.static(staticDir));

const API_KEY = '703732760a8517b24a58c87adb138c1a544b0f971e87144d5d08eda4ef0029d8';
const CACHE_FILE = path.join(__dirname, 'cache_sites.json');

// ─── 법정동 목록 ───
const BJDONG_LIST = [
  {s:'11680',b:'10300'},{s:'11680',b:'10600'},{s:'11680',b:'10700'},{s:'11680',b:'11000'},
  {s:'11680',b:'11400'},{s:'11680',b:'11500'},{s:'11680',b:'11700'},{s:'11680',b:'12100'},
  {s:'11680',b:'12400'},{s:'11680',b:'12600'},
  {s:'11650',b:'10100'},{s:'11650',b:'10400'},{s:'11650',b:'10500'},{s:'11650',b:'10600'},{s:'11650',b:'10700'},
  {s:'11710',b:'10400'},{s:'11710',b:'10500'},{s:'11710',b:'10700'},{s:'11710',b:'11000'},
  {s:'11710',b:'11200'},{s:'11710',b:'11400'},{s:'11710',b:'11500'},{s:'11710',b:'11700'},
  {s:'11740',b:'10200'},{s:'11740',b:'10400'},{s:'11740',b:'10600'},{s:'11740',b:'10800'},
  {s:'11440',b:'10400'},{s:'11440',b:'10600'},{s:'11440',b:'11000'},{s:'11440',b:'11600'},{s:'11440',b:'11800'},
  {s:'11560',b:'10100'},{s:'11560',b:'10900'},{s:'11560',b:'11100'},{s:'11560',b:'11500'},{s:'11560',b:'11700'},
  {s:'11500',b:'10300'},{s:'11500',b:'10500'},{s:'11500',b:'10900'},{s:'11500',b:'11200'},{s:'11500',b:'11500'},
  {s:'11350',b:'10100'},{s:'11350',b:'10300'},{s:'11350',b:'10500'},{s:'11350',b:'10700'},
  {s:'11380',b:'10300'},{s:'11380',b:'10500'},{s:'11380',b:'10900'},{s:'11380',b:'11200'},
  {s:'11290',b:'10300'},{s:'11290',b:'10600'},{s:'11290',b:'10900'},
  {s:'11230',b:'10200'},{s:'11230',b:'10600'},{s:'11230',b:'10900'},
  {s:'11200',b:'10100'},{s:'11200',b:'10400'},{s:'11200',b:'10700'},
  {s:'11215',b:'10100'},{s:'11215',b:'10300'},{s:'11215',b:'10500'},
  {s:'11170',b:'10200'},{s:'11170',b:'10600'},{s:'11170',b:'10900'},
  {s:'11110',b:'10100'},{s:'11110',b:'10600'},{s:'11110',b:'11200'},
  {s:'11590',b:'10200'},{s:'11590',b:'10500'},{s:'11590',b:'10800'},
  {s:'11620',b:'10200'},{s:'11620',b:'10500'},{s:'11620',b:'10800'},
  {s:'11530',b:'10200'},{s:'11530',b:'10500'},{s:'11530',b:'10800'},
  {s:'11470',b:'10200'},{s:'11470',b:'10500'},
  {s:'11305',b:'10200'},{s:'11305',b:'10500'},
  {s:'11320',b:'10200'},{s:'11320',b:'10500'},
  {s:'11260',b:'10200'},{s:'11260',b:'10500'},
  {s:'11410',b:'10200'},{s:'11410',b:'10500'},
  {s:'11545',b:'10200'},{s:'11545',b:'10500'},
  {s:'11140',b:'10100'},{s:'11140',b:'10400'},
  {s:'41135',b:'11000'},{s:'41135',b:'10300'},{s:'41135',b:'10500'},{s:'41135',b:'10700'},
  {s:'41135',b:'11200'},{s:'41135',b:'11500'},{s:'41135',b:'11700'},{s:'41135',b:'12000'},
  {s:'41135',b:'12200'},{s:'41135',b:'12500'},
  {s:'41131',b:'10300'},{s:'41131',b:'10600'},{s:'41133',b:'10300'},{s:'41133',b:'10600'},
  {s:'41111',b:'10300'},{s:'41111',b:'10600'},{s:'41113',b:'10300'},{s:'41113',b:'10600'},
  {s:'41115',b:'10300'},{s:'41115',b:'10600'},{s:'41117',b:'10300'},{s:'41117',b:'10600'},
  {s:'41281',b:'10300'},{s:'41281',b:'10600'},{s:'41285',b:'10300'},{s:'41285',b:'10600'},
  {s:'41287',b:'10300'},{s:'41287',b:'10600'},
  {s:'41461',b:'10300'},{s:'41461',b:'10600'},{s:'41463',b:'10300'},{s:'41463',b:'10600'},
  {s:'41465',b:'10300'},{s:'41465',b:'10600'},
  {s:'41590',b:'10300'},{s:'41590',b:'10600'},{s:'41590',b:'10900'},
  {s:'41360',b:'10300'},{s:'41360',b:'10600'},{s:'41360',b:'10900'},
  {s:'41480',b:'10300'},{s:'41480',b:'10600'},
  {s:'41570',b:'10300'},{s:'41570',b:'10600'},
  {s:'41171',b:'10300'},{s:'41171',b:'10600'},
  {s:'41190',b:'10300'},{s:'41190',b:'10600'},{s:'41190',b:'10900'},
  {s:'41210',b:'10300'},{s:'41210',b:'10600'},
  {s:'41271',b:'10300'},{s:'41271',b:'10600'},
  {s:'41220',b:'10300'},{s:'41220',b:'10600'},
  {s:'41150',b:'10300'},{s:'41150',b:'10600'},
  {s:'41450',b:'10300'},{s:'41450',b:'10600'},
  {s:'41310',b:'10300'},{s:'41310',b:'10600'},
  {s:'28185',b:'10300'},{s:'28185',b:'10600'},{s:'28185',b:'10900'},
  {s:'28200',b:'10300'},{s:'28200',b:'10600'},
  {s:'28237',b:'10300'},{s:'28237',b:'10600'},
  {s:'28260',b:'10300'},{s:'28260',b:'10600'},
  {s:'28245',b:'10300'},{s:'28245',b:'10600'},
  {s:'26350',b:'10300'},{s:'26350',b:'10600'},{s:'26350',b:'10900'},
  {s:'26470',b:'10300'},{s:'26470',b:'10600'},
  {s:'26440',b:'10300'},{s:'26440',b:'10600'},
  {s:'26230',b:'10300'},{s:'26230',b:'10600'},
  {s:'26215',b:'10300'},{s:'26215',b:'10600'},
  {s:'26410',b:'10300'},{s:'26410',b:'10600'},
  {s:'27260',b:'10300'},{s:'27260',b:'10600'},{s:'27260',b:'10900'},
  {s:'27290',b:'10300'},{s:'27290',b:'10600'},
  {s:'27230',b:'10300'},{s:'27230',b:'10600'},
  {s:'30230',b:'10300'},{s:'30230',b:'10600'},{s:'30230',b:'10900'},
  {s:'30170',b:'10300'},{s:'30170',b:'10600'},
  {s:'29140',b:'10300'},{s:'29140',b:'10600'},
  {s:'29170',b:'10300'},{s:'29170',b:'10600'},
  {s:'31140',b:'10300'},{s:'31140',b:'10600'},
  {s:'31710',b:'10300'},{s:'31710',b:'10600'},
  {s:'36110',b:'10300'},{s:'36110',b:'10600'},
  {s:'50110',b:'10300'},{s:'50110',b:'10600'},
  {s:'50130',b:'10300'},{s:'50130',b:'10600'},
];

// ─── 좌표 매핑 ───
const COORDS = {
  '11110':[37.5729,126.9793],'11140':[37.5635,126.9978],'11170':[37.5340,126.9989],
  '11200':[37.5633,127.0369],'11215':[37.5388,127.0823],'11230':[37.5744,127.0396],
  '11260':[37.5953,127.0939],'11290':[37.5894,127.0167],'11305':[37.6396,127.0257],
  '11320':[37.6688,127.0470],'11350':[37.6542,127.0568],'11380':[37.6027,126.9290],
  '11410':[37.5791,126.9368],'11440':[37.5551,126.9087],'11470':[37.5270,126.8567],
  '11500':[37.5509,126.8495],'11530':[37.4955,126.8877],'11545':[37.4601,126.9003],
  '11560':[37.5264,126.8963],'11590':[37.4965,126.9516],'11620':[37.4784,126.9516],
  '11650':[37.4837,127.0324],'11680':[37.5172,127.0473],'11710':[37.5145,127.1059],
  '11740':[37.5301,127.1238],
  '41111':[37.2990,127.0119],'41113':[37.2609,127.0313],'41115':[37.2813,127.0174],
  '41117':[37.2636,127.0577],'41131':[37.4386,127.1378],'41133':[37.4200,127.1260],
  '41135':[37.3595,127.1052],'41150':[37.7381,127.0474],'41171':[37.3895,126.9467],
  '41173':[37.3943,126.9570],'41190':[37.5034,126.7660],'41210':[37.4784,126.8647],
  '41220':[36.9921,127.1128],'41271':[37.3219,126.8308],'41281':[37.6581,126.8320],
  '41285':[37.6576,126.7719],'41287':[37.6725,126.7346],'41310':[37.5994,127.1296],
  '41360':[37.6359,127.2165],'41450':[37.5392,127.2148],'41461':[37.2356,127.2017],
  '41463':[37.2790,127.1144],'41465':[37.3218,127.0998],'41480':[37.7600,126.7798],
  '41570':[37.6148,126.7156],'41590':[37.1997,126.8316],
  '28185':[37.4100,126.6780],'28200':[37.4468,126.7314],'28237':[37.5066,126.7218],
  '28245':[37.5376,126.7376],'28260':[37.5450,126.6758],
  '26215':[35.1581,129.0538],'26230':[35.2057,129.0845],'26350':[35.1042,128.9749],
  '26410':[35.2120,128.9803],'26440':[35.1763,129.0793],'26470':[35.1452,129.1134],
  '27230':[35.9062,128.5831],'27260':[35.8581,128.6301],'27290':[35.8298,128.5327],
  '29140':[35.1467,126.8893],'29170':[35.1729,126.9126],
  '30170':[36.3521,127.3792],'30230':[36.3622,127.2961],
  '31140':[35.5383,129.3294],'31710':[35.5204,129.1394],
  '36110':[36.4801,127.2882],
  '50110':[33.5097,126.5219],'50130':[33.3624,126.5329],
};

// ─── 유효 데이터 필터 ───
function isValidItem(item) {
  // 주소 없음 제외
  const addr = item.platPlc || item.newPlatPlc || '';
  if (!addr || addr.trim().length < 5) return false;
  // 연면적 0 또는 극소(1㎡ 미만) 제외
  const area = parseFloat(item.totArea || '0');
  if (area < 1) return false;
  // 용도 없음 제외
  if (!item.mainPurpsCdNm || item.mainPurpsCdNm.trim() === '') return false;
  return true;
}

function addCoords(item) {
  const cd = String(item.sigunguCd || '').padStart(5,'0');
  if (COORDS[cd]) {
    const [lat, lng] = COORDS[cd];
    const r = () => (Math.random()-0.5)*0.02;
    item._lat = +(lat + r()).toFixed(6);
    item._lng = +(lng + r()).toFixed(6);
  }
  return item;
}

// ─── API 호출 (디버그 로그 포함, 재시도 지원) ───
function callApi(serviceKey, sigunguCd, bjdongCd, numOfRows) {
  return new Promise((resolve, reject) => {
    // 공공데이터포털은 serviceKey를 raw 그대로 전달해야 함 (이중인코딩 X)
    const query = '?serviceKey=' + serviceKey
      + '&sigunguCd=' + sigunguCd + '&bjdongCd=' + bjdongCd
      + '&numOfRows=' + numOfRows + '&pageNo=1&_type=json';

    const options = {
      hostname: 'apis.data.go.kr',
      path: '/1613000/ArchPmsHubService/getApBasisOulnInfo' + query,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; GongsaRadar/1.0)',
      },
      timeout: 15000
    };

    const req = https.get(options, (apiRes) => {
      let data = '';
      apiRes.on('data', c => { data += c; });
      apiRes.on('end', () => {
        const trimmed = data.trim();

        // XML 응답 = 인증오류 또는 잘못된 요청
        if (trimmed.startsWith('<')) {
          // XML에서 오류 메시지 추출
          const match = trimmed.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/) ||
                        trimmed.match(/<errMsg>(.*?)<\/errMsg>/);
          const errMsg = match ? match[1] : 'XML_RESPONSE';
          return reject(new Error('XML:' + errMsg));
        }

        // 빈 응답
        if (!trimmed) return reject(new Error('EMPTY_RESPONSE'));

        try {
          resolve(JSON.parse(trimmed));
        } catch(e) {
          reject(new Error('JSON_PARSE_ERROR: ' + trimmed.slice(0, 100)));
        }
      });
    });

    req.on('error', (e) => reject(new Error('NETWORK:' + e.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });
  });
}

// ─── API 연결 테스트 (서버 시작 시) ───
async function testApiConnection() {
  console.log('\n🔍 API 연결 테스트 중...');
  try {
    const json = await callApi(API_KEY, '11680', '10300', '3');
    const header = json?.response?.header || json?.header;
    const body   = json?.response?.body   || json?.body;

    if (header?.resultCode === '00') {
      const count = body?.totalCount || 0;
      console.log(`✅ API 정상! (강남구 샘플 ${count}건)`);
      return true;
    } else {
      console.log(`⚠️ API 응답 코드: ${header?.resultCode} / ${header?.resultMsg}`);
      return false;
    }
  } catch(e) {
    console.log(`❌ API 연결 실패: ${e.message}`);
    console.log('   → 공공데이터포털에서 해당 API 활용 승인 여부를 확인하세요.');
    console.log('   → https://www.data.go.kr 에서 "건축인허가" 검색 후 활용 신청 확인');
    return false;
  }
}

// ─── 캐시 로드 ───
function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    return data;
  } catch(e) { return null; }
}

// ─── 전체 수집 (백그라운드) ───
let isCollecting = false;
let collectStats = { success: 0, fail: 0, errors: {} };

async function collectAll() {
  if (isCollecting) { console.log('⏳ 이미 수집 중...'); return; }
  isCollecting = true;
  collectStats = { success: 0, fail: 0, errors: {} };
  console.log('\n🔄 전국 데이터 수집 시작... (총', BJDONG_LIST.length, '개 지역)');

  let allItems = [];

  for (let i = 0; i < BJDONG_LIST.length; i++) {
    const {s, b} = BJDONG_LIST[i];
    try {
      const json = await callApi(API_KEY, s, b, '100');
      const header = json?.response?.header || json?.header;
      const body   = json?.response?.body   || json?.body;

      if (header?.resultCode !== '00') {
        collectStats.fail++;
        const errKey = `RC:${header?.resultCode}`;
        collectStats.errors[errKey] = (collectStats.errors[errKey] || 0) + 1;
        continue;
      }

      const items = body?.items?.item;
      if (!items) {
        // 데이터 없는 지역 (정상)
        continue;
      }

      const list = Array.isArray(items) ? items : [items];
      const valid = list.filter(isValidItem);
      allItems = allItems.concat(valid.map(addCoords));
      collectStats.success++;
      process.stdout.write(`\r📦 수집 중: ${allItems.length}건 (${i+1}/${BJDONG_LIST.length})...`);

    } catch(e) {
      collectStats.fail++;
      const errKey = e.message.split(':')[0];
      collectStats.errors[errKey] = (collectStats.errors[errKey] || 0) + 1;

      // 첫 번째 에러는 상세 출력
      if (collectStats.fail === 1) {
        console.log(`\n⚠️ 첫 번째 오류 (sigungu:${s}, bjdong:${b}): ${e.message}`);
      }
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\n📊 수집 결과:`);
  console.log(`   성공: ${collectStats.success}건`);
  console.log(`   실패: ${collectStats.fail}건`);
  if (Object.keys(collectStats.errors).length > 0) {
    console.log(`   오류 유형:`, collectStats.errors);
  }

  if (allItems.length > 0) {
    const cacheData = { updatedAt: new Date().toISOString(), totalCount: allItems.length, items: allItems };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData));
    console.log(`✅ 수집 완료: ${allItems.length}건 저장\n`);
  } else {
    console.log('❌ 수집된 데이터 없음 — API 키 또는 네트워크 문제를 확인하세요.\n');
  }

  isCollecting = false;
  return allItems.length;
}

// ─── 자정 자동 업데이트 ───
function scheduleMidnightUpdate() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 5, 0);
  const ms = midnight - now;
  console.log(`⏰ 다음 자동 업데이트: ${midnight.toLocaleString('ko-KR')} (${Math.round(ms/60000)}분 후)`);
  setTimeout(async () => {
    console.log('\n🌙 자정 자동 업데이트 시작...');
    await collectAll();
    scheduleMidnightUpdate();
  }, ms);
}

// ─── API: 캐시 즉시 반환 ───
app.get('/api/building/all', (req, res) => {
  const cache = loadCache();

  if (cache && cache.items && cache.items.length > 0) {
    console.log(`[캐시 응답] ${cache.items.length}건 즉시 반환 (${cache.updatedAt.slice(0,10)})`);
    return res.json({
      header: { resultCode: '00', resultMsg: 'CACHE' },
      body: { items: { item: cache.items }, totalCount: cache.items.length },
      meta: { updatedAt: cache.updatedAt, fromCache: true }
    });
  }

  if (!isCollecting) {
    console.log('[캐시 없음] 백그라운드 수집 시작...');
    collectAll();
  }

  return res.json({
    header: { resultCode: '00', resultMsg: 'COLLECTING' },
    body: { items: '', totalCount: 0 },
    meta: { collecting: true, message: '데이터 수집 중입니다. 약 2-3분 후 자동으로 표시됩니다.' }
  });
});

// ─── API: 캐시 상태 확인 ───
app.get('/api/cache/status', (req, res) => {
  const cache = loadCache();
  if (!cache) return res.json({ cached: false, collecting: isCollecting });
  const ageMin = Math.round((Date.now() - new Date(cache.updatedAt)) / 60000);
  res.json({
    cached: true, totalCount: cache.totalCount,
    updatedAt: cache.updatedAt, ageMinutes: ageMin,
    collecting: isCollecting,
    collectStats,
    message: `${cache.totalCount.toLocaleString()}건 (${ageMin}분 전 업데이트)`
  });
});

// ─── API: 수동 업데이트 ───
app.get('/api/building/refresh', (req, res) => {
  res.json({ message: '업데이트 시작. 완료까지 2-3분 소요.' });
  if (!isCollecting) collectAll();
});

// ─── API: 수집 진행상태 실시간 확인 ───
app.get('/api/collect/status', (req, res) => {
  res.json({
    isCollecting,
    collectStats,
    message: isCollecting ? '수집 중...' : '수집 대기 중'
  });
});

// ─── API: 일반 검색 (캐시 슬라이스) ───
app.get('/api/building', async (req, res) => {
  const target = parseInt(req.query.numOfRows || '100');
  const cache = loadCache();

  if (cache && cache.items && cache.items.length > 0) {
    const sliced = cache.items.slice(0, target);
    return res.json({
      header: { resultCode: '00', resultMsg: 'CACHE' },
      body: { items: { item: sliced }, totalCount: sliced.length }
    });
  }

  // 캐시 없으면 실시간 소량 수집
  let allItems = [];
  for (const {s, b} of BJDONG_LIST.slice(0, 10)) {
    if (allItems.length >= target) break;
    try {
      const json = await callApi(API_KEY, s, b, '20');
      const header = json?.response?.header || json?.header;
      const body   = json?.response?.body   || json?.body;
      if (header?.resultCode !== '00') continue;
      const items = body?.items?.item;
      if (!items) continue;
      const list = Array.isArray(items) ? items : [items];
      const valid = list.filter(isValidItem);
      allItems = allItems.concat(valid.map(addCoords));
    } catch(e) {
      console.log(`[실시간 수집 오류] ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  res.json({
    header: { resultCode: '00', resultMsg: 'REALTIME' },
    body: { items: allItems.length ? { item: allItems } : '', totalCount: allItems.length }
  });
});

// ─── 서버 시작 ───
app.listen(PORT, async () => {
  console.log('\n✅ 공사레이더 서버 실행!');
  console.log('👉 http://localhost:' + PORT);
  console.log('🔑 API 키 내장 완료\n');

  const cache = loadCache();
  if (cache && cache.items && cache.items.length > 0) {
    const ageHour = Math.round((Date.now() - new Date(cache.updatedAt)) / 3600000);
    console.log(`📂 캐시 로드: ${cache.totalCount.toLocaleString()}건 (${ageHour}시간 전)\n`);
    console.log('⚡ 브라우저 접속 시 즉시 표시됩니다!\n');
    scheduleMidnightUpdate();
  } else {
    // API 연결 테스트 후 수집 시작
    const ok = await testApiConnection();
    if (ok) {
      console.log('📭 캐시 없음 → 전국 데이터 수집 시작...\n');
      collectAll();
    } else {
      console.log('\n⚠️  API 연결 실패로 수집을 시작하지 않습니다.');
      console.log('   수동으로 수집하려면: http://localhost:3001/api/building/refresh\n');
    }
    scheduleMidnightUpdate();
  }
});
