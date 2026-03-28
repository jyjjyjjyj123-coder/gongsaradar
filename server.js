/**
 * 공사레이더 서버 v2.0
 * - JWT 인증, SQLite DB, 구독 플랜, 건축인허가 API
 */
const express  = require('express');
const cors     = require('cors');
const https    = require('https');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3001;

const API_KEY    = process.env.ARCH_API_KEY   || '703732760a8517b24a58c87adb138c1a544b0f971e87144d5d08eda4ef0029d8';
const JWT_SECRET = process.env.JWT_SECRET     || 'gongsaradar-dev-secret-change-in-prod-2024';
const ADMIN_EMAIL= process.env.ADMIN_EMAIL    || 'admin@gongsaradar.com';
const ADMIN_PW   = process.env.ADMIN_PASSWORD || 'admin1234!';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
const staticDir = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
app.use(express.static(staticDir));

// ── DB 초기화
const DB_FILE = path.join(__dirname, 'gongsaradar.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT 'free',
    plan_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS favs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    site_id INTEGER NOT NULL,
    site_name TEXT, site_addr TEXT, site_data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, site_id)
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    site_name TEXT NOT NULL DEFAULT '',
    site_addr TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    person TEXT NOT NULL DEFAULT '',
    next_action TEXT NOT NULL DEFAULT '',
    next_date TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    site_name TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    time TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '현장방문',
    memo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS pipeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    stage TEXT NOT NULL DEFAULT '발굴',
    site_name TEXT NOT NULL DEFAULT '',
    site_addr TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// 관리자 계정 자동 생성
if (!db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL)) {
  db.prepare('INSERT INTO users (email,password,name,company,plan) VALUES (?,?,?,?,?)')
    .run(ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PW, 10), '관리자', '공사레이더', 'enterprise');
  console.log('👤 관리자 계정 생성:', ADMIN_EMAIL);
}

// ── JWT 미들웨어
function authRequired(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: '토큰이 만료되었거나 유효하지 않습니다.' }); }
}
function planRequired(minPlan) {
  const order = { free:0, pro:1, enterprise:2 };
  return (req, res, next) => {
    if ((order[req.user?.plan?.toLowerCase()] ?? -1) < (order[minPlan] ?? 99))
      return res.status(403).json({ error: `${minPlan.toUpperCase()} 플랜 이상 필요합니다.`, needPlan: minPlan });
    next();
  };
}

// ══ 인증 API
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, company } = req.body;
  if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요.' });
  if (password.length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: '이미 사용 중인 이메일입니다.' });
  const r = db.prepare('INSERT INTO users (email,password,name,company) VALUES (?,?,?,?)').run(email, bcrypt.hashSync(password,10), name||'', company||'');
  const user = db.prepare('SELECT id,email,name,company,plan FROM users WHERE id=?').get(r.lastInsertRowid);
  res.json({ token: jwt.sign({ id:user.id, email:user.email, plan:user.plan }, JWT_SECRET, { expiresIn:'30d' }), user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: '이메일 또는 비밀번호가 틀렸습니다.' });
  const { password:_, ...safe } = user;
  res.json({ token: jwt.sign({ id:user.id, email:user.email, plan:user.plan }, JWT_SECRET, { expiresIn:'30d' }), user: safe });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id,email,name,company,plan,plan_until,created_at FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '없음' });
  res.json({ user });
});

app.put('/api/auth/me', authRequired, (req, res) => {
  const { name, company } = req.body;
  db.prepare('UPDATE users SET name=?,company=? WHERE id=?').run(name||'', company||'', req.user.id);
  res.json({ ok: true });
});

app.put('/api/auth/password', authRequired, (req, res) => {
  const { current, next: newPw } = req.body;
  const user = db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password)) return res.status(401).json({ error: '현재 비밀번호가 틀렸습니다.' });
  if (!newPw || newPw.length < 6) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPw,10), req.user.id);
  res.json({ ok: true });
});

// ══ 즐겨찾기 API
app.get('/api/favs', authRequired, (req, res) => res.json({ favs: db.prepare('SELECT * FROM favs WHERE user_id=? ORDER BY created_at DESC').all(req.user.id) }));
app.post('/api/favs', authRequired, (req, res) => {
  const { site_id, site_name, site_addr, site_data } = req.body;
  if (!site_id) return res.status(400).json({ error: 'site_id 필요' });
  db.prepare('INSERT OR IGNORE INTO favs (user_id,site_id,site_name,site_addr,site_data) VALUES (?,?,?,?,?)').run(req.user.id, site_id, site_name||'', site_addr||'', site_data ? JSON.stringify(site_data) : null);
  res.json({ ok: true });
});
app.delete('/api/favs/:siteId', authRequired, (req, res) => { db.prepare('DELETE FROM favs WHERE user_id=? AND site_id=?').run(req.user.id, req.params.siteId); res.json({ ok: true }); });

// ══ 영업노트 API
app.get('/api/notes', authRequired, (req, res) => res.json({ notes: db.prepare('SELECT * FROM notes WHERE user_id=? ORDER BY created_at DESC').all(req.user.id) }));
app.post('/api/notes', authRequired, (req, res) => {
  const { site_name, site_addr, body, person, next_action, next_date } = req.body;
  if (!body) return res.status(400).json({ error: '내용을 입력하세요.' });
  const r = db.prepare('INSERT INTO notes (user_id,site_name,site_addr,body,person,next_action,next_date) VALUES (?,?,?,?,?,?,?)').run(req.user.id, site_name||'', site_addr||'', body, person||'', next_action||'', next_date||'');
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/notes/:id', authRequired, (req, res) => {
  const { site_name,site_addr,body,person,next_action,next_date } = req.body;
  db.prepare('UPDATE notes SET site_name=?,site_addr=?,body=?,person=?,next_action=?,next_date=? WHERE id=? AND user_id=?').run(site_name||'',site_addr||'',body||'',person||'',next_action||'',next_date||'',req.params.id,req.user.id);
  res.json({ ok: true });
});
app.delete('/api/notes/:id', authRequired, (req, res) => { db.prepare('DELETE FROM notes WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });

// ══ 일정 API
app.get('/api/schedules', authRequired, (req, res) => res.json({ schedules: db.prepare('SELECT * FROM schedules WHERE user_id=? ORDER BY date,time').all(req.user.id) }));
app.post('/api/schedules', authRequired, (req, res) => {
  const { site_name,date,time,type,memo } = req.body;
  if (!site_name||!date) return res.status(400).json({ error: '현장명과 날짜를 입력하세요.' });
  const r = db.prepare('INSERT INTO schedules (user_id,site_name,date,time,type,memo) VALUES (?,?,?,?,?,?)').run(req.user.id, site_name, date, time||'09:00', type||'현장방문', memo||'');
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/schedules/:id', authRequired, (req, res) => { db.prepare('DELETE FROM schedules WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });

// ══ 파이프라인 API
app.get('/api/pipeline', authRequired, (req, res) => res.json({ items: db.prepare('SELECT * FROM pipeline WHERE user_id=? ORDER BY created_at DESC').all(req.user.id) }));
app.post('/api/pipeline', authRequired, (req, res) => {
  const { stage,site_name,site_addr,amount,memo } = req.body;
  if (!site_name) return res.status(400).json({ error: '현장명을 입력하세요.' });
  const r = db.prepare('INSERT INTO pipeline (user_id,stage,site_name,site_addr,amount,memo) VALUES (?,?,?,?,?,?)').run(req.user.id, stage||'발굴', site_name, site_addr||'', amount||'', memo||'');
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/pipeline/:id', authRequired, (req, res) => { db.prepare('UPDATE pipeline SET stage=? WHERE id=? AND user_id=?').run(req.body.stage, req.params.id, req.user.id); res.json({ ok: true }); });
app.delete('/api/pipeline/:id', authRequired, (req, res) => { db.prepare('DELETE FROM pipeline WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });

// ══ 관리자 API
app.post('/api/admin/set-plan', authRequired, planRequired('enterprise'), (req, res) => {
  const { user_email, plan, days } = req.body;
  const until = days ? new Date(Date.now() + days*86400000).toISOString() : null;
  db.prepare('UPDATE users SET plan=?,plan_until=? WHERE email=?').run(plan, until, user_email);
  res.json({ ok: true, message: `${user_email} → ${plan} 설정 완료` });
});
app.get('/api/admin/users', authRequired, planRequired('enterprise'), (req, res) => {
  res.json({ users: db.prepare('SELECT id,email,name,company,plan,plan_until,created_at FROM users ORDER BY created_at DESC').all() });
});

// ══ 건축인허가 데이터
const BJDONG_LIST = [
  {s:'11680',b:'10300'},{s:'11680',b:'10600'},{s:'11680',b:'10700'},{s:'11680',b:'11000'},{s:'11680',b:'11400'},{s:'11680',b:'11500'},{s:'11680',b:'11700'},{s:'11680',b:'12100'},{s:'11680',b:'12400'},{s:'11680',b:'12600'},
  {s:'11650',b:'10100'},{s:'11650',b:'10400'},{s:'11650',b:'10500'},{s:'11650',b:'10600'},{s:'11650',b:'10700'},
  {s:'11710',b:'10400'},{s:'11710',b:'10500'},{s:'11710',b:'10700'},{s:'11710',b:'11000'},{s:'11710',b:'11200'},{s:'11710',b:'11400'},{s:'11710',b:'11500'},{s:'11710',b:'11700'},
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
  {s:'11470',b:'10200'},{s:'11470',b:'10500'},{s:'11305',b:'10200'},{s:'11305',b:'10500'},
  {s:'11320',b:'10200'},{s:'11320',b:'10500'},{s:'11260',b:'10200'},{s:'11260',b:'10500'},
  {s:'11410',b:'10200'},{s:'11410',b:'10500'},{s:'11545',b:'10200'},{s:'11545',b:'10500'},
  {s:'11140',b:'10100'},{s:'11140',b:'10400'},
  {s:'41135',b:'11000'},{s:'41135',b:'10300'},{s:'41135',b:'10500'},{s:'41135',b:'10700'},{s:'41135',b:'11200'},{s:'41135',b:'11500'},{s:'41135',b:'11700'},{s:'41135',b:'12000'},{s:'41135',b:'12200'},{s:'41135',b:'12500'},
  {s:'41131',b:'10300'},{s:'41131',b:'10600'},{s:'41133',b:'10300'},{s:'41133',b:'10600'},
  {s:'41111',b:'10300'},{s:'41111',b:'10600'},{s:'41113',b:'10300'},{s:'41113',b:'10600'},
  {s:'41115',b:'10300'},{s:'41115',b:'10600'},{s:'41117',b:'10300'},{s:'41117',b:'10600'},
  {s:'41281',b:'10300'},{s:'41281',b:'10600'},{s:'41285',b:'10300'},{s:'41285',b:'10600'},{s:'41287',b:'10300'},{s:'41287',b:'10600'},
  {s:'41461',b:'10300'},{s:'41461',b:'10600'},{s:'41463',b:'10300'},{s:'41463',b:'10600'},{s:'41465',b:'10300'},{s:'41465',b:'10600'},
  {s:'41590',b:'10300'},{s:'41590',b:'10600'},{s:'41590',b:'10900'},
  {s:'41360',b:'10300'},{s:'41360',b:'10600'},{s:'41360',b:'10900'},
  {s:'41480',b:'10300'},{s:'41480',b:'10600'},{s:'41570',b:'10300'},{s:'41570',b:'10600'},
  {s:'41171',b:'10300'},{s:'41171',b:'10600'},{s:'41190',b:'10300'},{s:'41190',b:'10600'},{s:'41190',b:'10900'},
  {s:'41210',b:'10300'},{s:'41210',b:'10600'},{s:'41271',b:'10300'},{s:'41271',b:'10600'},
  {s:'41220',b:'10300'},{s:'41220',b:'10600'},{s:'41150',b:'10300'},{s:'41150',b:'10600'},
  {s:'41450',b:'10300'},{s:'41450',b:'10600'},{s:'41310',b:'10300'},{s:'41310',b:'10600'},
  {s:'28185',b:'10300'},{s:'28185',b:'10600'},{s:'28185',b:'10900'},
  {s:'28200',b:'10300'},{s:'28200',b:'10600'},{s:'28237',b:'10300'},{s:'28237',b:'10600'},
  {s:'28260',b:'10300'},{s:'28260',b:'10600'},{s:'28245',b:'10300'},{s:'28245',b:'10600'},
  {s:'26350',b:'10300'},{s:'26350',b:'10600'},{s:'26350',b:'10900'},
  {s:'26470',b:'10300'},{s:'26470',b:'10600'},{s:'26440',b:'10300'},{s:'26440',b:'10600'},
  {s:'26230',b:'10300'},{s:'26230',b:'10600'},{s:'26215',b:'10300'},{s:'26215',b:'10600'},{s:'26410',b:'10300'},{s:'26410',b:'10600'},
  {s:'27260',b:'10300'},{s:'27260',b:'10600'},{s:'27260',b:'10900'},{s:'27290',b:'10300'},{s:'27290',b:'10600'},{s:'27230',b:'10300'},{s:'27230',b:'10600'},
  {s:'30230',b:'10300'},{s:'30230',b:'10600'},{s:'30230',b:'10900'},{s:'30170',b:'10300'},{s:'30170',b:'10600'},
  {s:'29140',b:'10300'},{s:'29140',b:'10600'},{s:'29170',b:'10300'},{s:'29170',b:'10600'},
  {s:'31140',b:'10300'},{s:'31140',b:'10600'},{s:'31710',b:'10300'},{s:'31710',b:'10600'},
  {s:'36110',b:'10300'},{s:'36110',b:'10600'},{s:'50110',b:'10300'},{s:'50110',b:'10600'},{s:'50130',b:'10300'},{s:'50130',b:'10600'},
];

const COORDS = {
  '11110':[37.5729,126.9793],'11140':[37.5635,126.9978],'11170':[37.5340,126.9989],'11200':[37.5633,127.0369],
  '11215':[37.5388,127.0823],'11230':[37.5744,127.0396],'11260':[37.5953,127.0939],'11290':[37.5894,127.0167],
  '11305':[37.6396,127.0257],'11320':[37.6688,127.0470],'11350':[37.6542,127.0568],'11380':[37.6027,126.9290],
  '11410':[37.5791,126.9368],'11440':[37.5551,126.9087],'11470':[37.5270,126.8567],'11500':[37.5509,126.8495],
  '11530':[37.4955,126.8877],'11545':[37.4601,126.9003],'11560':[37.5264,126.8963],'11590':[37.4965,126.9516],
  '11620':[37.4784,126.9516],'11650':[37.4837,127.0324],'11680':[37.5172,127.0473],'11710':[37.5145,127.1059],
  '11740':[37.5301,127.1238],
  '41111':[37.2990,127.0119],'41113':[37.2609,127.0313],'41115':[37.2813,127.0174],'41117':[37.2636,127.0577],
  '41131':[37.4386,127.1378],'41133':[37.4200,127.1260],'41135':[37.3595,127.1052],'41150':[37.7381,127.0474],
  '41171':[37.3895,126.9467],'41190':[37.5034,126.7660],'41210':[37.4784,126.8647],'41220':[36.9921,127.1128],
  '41271':[37.3219,126.8308],'41281':[37.6581,126.8320],'41285':[37.6576,126.7719],'41287':[37.6725,126.7346],
  '41310':[37.5994,127.1296],'41360':[37.6359,127.2165],'41450':[37.5392,127.2148],'41461':[37.2356,127.2017],
  '41463':[37.2790,127.1144],'41465':[37.3218,127.0998],'41480':[37.7600,126.7798],'41570':[37.6148,126.7156],
  '41590':[37.1997,126.8316],
  '28185':[37.4100,126.6780],'28200':[37.4468,126.7314],'28237':[37.5066,126.7218],'28245':[37.5376,126.7376],'28260':[37.5450,126.6758],
  '26215':[35.1581,129.0538],'26230':[35.2057,129.0845],'26350':[35.1042,128.9749],'26410':[35.2120,128.9803],'26440':[35.1763,129.0793],'26470':[35.1452,129.1134],
  '27230':[35.9062,128.5831],'27260':[35.8581,128.6301],'27290':[35.8298,128.5327],
  '29140':[35.1467,126.8893],'29170':[35.1729,126.9126],
  '30170':[36.3521,127.3792],'30230':[36.3622,127.2961],
  '31140':[35.5383,129.3294],'31710':[35.5204,129.1394],
  '36110':[36.4801,127.2882],'50110':[33.5097,126.5219],'50130':[33.3624,126.5329],
};

function addCoords(item) {
  const cd = String(item.sigunguCd||'').padStart(5,'0');
  if (COORDS[cd]) {
    const [lat,lng] = COORDS[cd], r = ()=>(Math.random()-0.5)*0.02;
    item._lat = +(lat+r()).toFixed(6); item._lng = +(lng+r()).toFixed(6);
  }
  return item;
}

function isValidItem(item) {
  const addr = item.platPlc || item.newPlatPlc || '';
  if (!addr || addr.trim().length < 5) return false;
  if (parseFloat(item.totArea||'0') < 1) return false;
  if (!item.mainPurpsCdNm || !item.mainPurpsCdNm.trim()) return false;
  return true;
}

function callApi(serviceKey, sigunguCd, bjdongCd, numOfRows) {
  return new Promise((resolve, reject) => {
    const query = '?serviceKey='+serviceKey+'&sigunguCd='+sigunguCd+'&bjdongCd='+bjdongCd+'&numOfRows='+numOfRows+'&pageNo=1&_type=json';
    const req = https.get({ hostname:'apis.data.go.kr', path:'/1613000/ArchPmsHubService/getApBasisOulnInfo'+query, headers:{'Accept':'application/json','User-Agent':'GongsaRadar/2.0'}, timeout:15000 }, (apiRes) => {
      let data = '';
      apiRes.on('data', c => { data += c; });
      apiRes.on('end', () => {
        const t = data.trim();
        if (t.startsWith('<')) { const m=t.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/)||t.match(/<errMsg>(.*?)<\/errMsg>/); return reject(new Error('XML:'+(m?m[1]:'?'))); }
        if (!t) return reject(new Error('EMPTY'));
        try { resolve(JSON.parse(t)); } catch { reject(new Error('JSON:'+t.slice(0,60))); }
      });
    });
    req.on('error', e=>reject(new Error('NET:'+e.message)));
    req.on('timeout', ()=>{ req.destroy(); reject(new Error('TIMEOUT')); });
  });
}

const CACHE_FILE = path.join(__dirname, 'cache_sites.json');
function loadCache() { try { return fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE,'utf-8')) : null; } catch { return null; } }

let isCollecting = false;
let collectStats = { success:0, fail:0, errors:{} };

async function collectAll() {
  if (isCollecting) return;
  isCollecting = true; collectStats = { success:0, fail:0, errors:{} };
  console.log('\n🔄 전국 데이터 수집 시작... (총', BJDONG_LIST.length, '개 지역)');
  let allItems = [];
  for (let i=0; i<BJDONG_LIST.length; i++) {
    const {s,b} = BJDONG_LIST[i];
    try {
      const json = await callApi(API_KEY, s, b, '100');
      const header = json?.response?.header||json?.header, body = json?.response?.body||json?.body;
      if (header?.resultCode !== '00') { collectStats.fail++; continue; }
      const items = body?.items?.item; if (!items) continue;
      const list = Array.isArray(items)?items:[items];
      allItems = allItems.concat(list.filter(isValidItem).map(addCoords));
      collectStats.success++;
      process.stdout.write(`\r📦 ${allItems.length}건 (${i+1}/${BJDONG_LIST.length})...`);
    } catch(e) {
      collectStats.fail++;
      const k=e.message.split(':')[0]; collectStats.errors[k]=(collectStats.errors[k]||0)+1;
      if (collectStats.fail===1) console.log(`\n⚠️ 첫 오류(${s}/${b}): ${e.message}`);
    }
    await new Promise(r=>setTimeout(r,100));
  }
  console.log(`\n📊 성공:${collectStats.success} 실패:${collectStats.fail}`);
  if (allItems.length>0) {
    const prev = loadCache();
    fs.writeFileSync(CACHE_FILE,JSON.stringify({updatedAt:new Date().toISOString(),totalCount:allItems.length,items:allItems}));
    console.log(`✅ ${allItems.length}건 저장\n`);
    if (prev && allItems.length > prev.totalCount) {
      broadcastNewSites(allItems.length - prev.totalCount);
    }
  } else console.log('❌ 수집 데이터 없음\n');
  isCollecting = false;
}

async function testApiConnection() {
  try {
    const json = await callApi(API_KEY,'11680','10300','3');
    const h = json?.response?.header||json?.header;
    if (h?.resultCode==='00') { console.log('✅ API 정상! (강남구 샘플)'); return true; }
    console.log('⚠️ API 응답:', h?.resultCode); return false;
  } catch(e) { console.log('❌ API 실패:', e.message); return false; }
}

function scheduleMidnightUpdate() {
  const now=new Date(), m=new Date(now); m.setHours(24,0,5,0);
  console.log(`⏰ 다음 자동업데이트: ${m.toLocaleString('ko-KR')} (${Math.round((m-now)/60000)}분 후)`);
  setTimeout(async()=>{ await collectAll(); scheduleMidnightUpdate(); }, m-now);
}


// ══ 결제 처리 API (토스페이먼츠)
app.post('/api/payment/confirm', authRequired, async (req, res) => {
  const { paymentKey, orderId, amount, plan } = req.body;
  if (!paymentKey || !orderId || !amount) return res.status(400).json({ error: '결제 정보 누락' });

  try {
    // 토스페이먼츠 결제 승인 (실제 서비스 시 시크릿 키 필요)
    const SECRET_KEY = process.env.TOSS_SECRET_KEY || 'test_sk_D5GePWvyJnrK0W0k6q8gLzN97Eoq';
    const authHeader = 'Basic ' + Buffer.from(SECRET_KEY + ':').toString('base64');

    const tossRes = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ paymentKey, orderId, amount });
      const req2 = https.request({
        hostname: 'api.tosspayments.com',
        path: '/v1/payments/confirm',
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (r) => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d }));
      });
      req2.on('error', reject);
      req2.write(body); req2.end();
    });

    if (tossRes.status !== 200) {
      const err = JSON.parse(tossRes.body);
      return res.status(400).json({ error: err.message || '결제 승인 실패' });
    }

    // 플랜 업그레이드
    const planMap = { 'pro': 'pro', 'enterprise': 'enterprise' };
    const newPlan = planMap[plan] || 'pro';
    const until = new Date(); until.setMonth(until.getMonth() + 1);
    db.prepare('UPDATE users SET plan=?, plan_until=? WHERE id=?')
      .run(newPlan, until.toISOString().slice(0,10), req.user.id);

    const user = db.prepare('SELECT id,email,name,company,plan,plan_until FROM users WHERE id=?').get(req.user.id);
    const newToken = jwt.sign({ id:user.id, email:user.email, plan:user.plan }, JWT_SECRET, { expiresIn:'30d' });
    res.json({ ok: true, token: newToken, user });

  } catch(e) {
    console.error('[Payment Error]', e.message);
    res.status(500).json({ error: '결제 처리 중 오류: ' + e.message });
  }
});

// 결제 성공 리다이렉트 처리 (GET)
app.get('/payment/success', (req, res) => {
  const { plan, paymentKey, orderId, amount } = req.query;
  res.send(`<html><head><meta charset="utf-8"><title>결제 완료</title>
  <script>
    // 결제 정보를 앱으로 전달하고 메인으로 리다이렉트
    localStorage.setItem('pendingPayment', JSON.stringify({plan:'${plan}',paymentKey:'${paymentKey}',orderId:'${orderId}',amount:'${amount}'}));
    window.location.href = '/';
  </script></head><body>결제 처리 중...</body></html>`);
});

app.get('/payment/fail', (req, res) => {
  res.send(`<html><head><meta charset="utf-8"><title>결제 실패</title>
  <script>window.location.href = '/';</script></head><body>결제가 취소되었습니다.</body></html>`);
});

// 관리자 플랜 수동 변경 API
app.put('/api/admin/plan', authRequired, (req, res) => {
  const { userId, plan } = req.body;
  const me = db.prepare('SELECT plan FROM users WHERE id=?').get(req.user.id);
  if (me?.plan !== 'enterprise') return res.status(403).json({ error: '관리자 권한 필요' });
  db.prepare('UPDATE users SET plan=? WHERE id=?').run(plan, userId);
  res.json({ ok: true });
});

// 알림 구독 (신규 인허가 감지용 SSE)
const alertSubscribers = new Map();
app.get('/api/alerts/stream', (req, res) => {
  // EventSource는 헤더 설정 불가 → 쿼리 파람으로 토큰 받기
  const token = req.headers.authorization?.replace('Bearer ','') || req.query.token || '';
  let userObj;
  try { userObj = jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).send('Unauthorized'); }
  req.user = userObj;
  // eslint-disable-next-line no-shadow
  const authRequired_done = true;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const userId = req.user.id;
  alertSubscribers.set(userId, res);
  res.write(`data: ${JSON.stringify({type:'connected',msg:'실시간 알림 연결됨'})}\n\n`);

  req.on('close', () => { alertSubscribers.delete(userId); });
});

// 캐시 업데이트 후 구독자에게 알림 브로드캐스트
function broadcastNewSites(count) {
  const msg = JSON.stringify({ type:'new_sites', count });
  alertSubscribers.forEach((res) => {
    try { res.write(`data: ${msg}\n\n`); } catch(e) {}
  });
}

// ══ 건축데이터 API
app.get('/api/building/all', authRequired, (req, res) => {
  const cache = loadCache();
  if (cache?.items?.length > 0) {
    const plan = (req.user?.plan||'free').toLowerCase();
    const items = plan==='free' ? cache.items.slice(0,500) : cache.items;
    return res.json({ header:{resultCode:'00',resultMsg:'CACHE'}, body:{items:{item:items},totalCount:items.length}, meta:{updatedAt:cache.updatedAt,fromCache:true,plan,totalInDB:cache.totalCount} });
  }
  if (!isCollecting) collectAll();
  res.json({ header:{resultCode:'00',resultMsg:'COLLECTING'}, body:{items:'',totalCount:0}, meta:{collecting:true,message:'데이터 수집 중입니다. 약 2~3분 후 자동으로 표시됩니다.'} });
});

app.get('/api/building/refresh', authRequired, planRequired('pro'), (req, res) => {
  res.json({ message:'업데이트 시작.' }); if (!isCollecting) collectAll();
});

app.get('/api/cache/status', authRequired, (req, res) => {
  const c=loadCache(); if (!c) return res.json({cached:false,collecting:isCollecting});
  res.json({cached:true,totalCount:c.totalCount,updatedAt:c.updatedAt,ageMinutes:Math.round((Date.now()-new Date(c.updatedAt))/60000),collecting:isCollecting,collectStats});
});


// ══ 카카오맵 SDK 프록시 (Railway에서 dapi.kakao.com 직접 접근 불가 시 우회)
app.get('/kakao-maps-sdk.js', (req, res) => {
  const https = require('https');
  const url = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + (req.query.appkey || '') + '&libraries=' + (req.query.libraries || '') + '&autoload=' + (req.query.autoload || 'false');
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gongsaradar-production.up.railway.app' } }, (apiRes) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    apiRes.pipe(res);
  }).on('error', (e) => {
    res.status(503).send('// Kakao Maps SDK load failed: ' + e.message);
  });
});

app.get('/health', (req,res) => res.json({status:'ok',version:'2.0.0',time:new Date().toISOString()}));

// ══ 서버 시작
app.listen(PORT, async () => {
  console.log('\n╔══════════════════════════════════╗');
  console.log('║   공사레이더 서버 v2.0 실행!     ║');
  console.log('╚══════════════════════════════════╝');
  console.log('👉 http://localhost:' + PORT);
  const cache = loadCache();
  if (cache?.items?.length>0) {
    console.log(`📂 캐시: ${cache.totalCount.toLocaleString()}건 (${Math.round((Date.now()-new Date(cache.updatedAt))/3600000)}시간 전)\n`);
    scheduleMidnightUpdate();
  } else {
    console.log('🔍 API 테스트 중...');
    const ok = await testApiConnection();
    if (ok) { console.log('📭 캐시 없음 → 수집 시작\n'); collectAll(); }
    else console.log('⚠️ API 연결 실패\n');
    scheduleMidnightUpdate();
  }
});
