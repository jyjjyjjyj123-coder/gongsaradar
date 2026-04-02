/**
 * 공사인프라 서버 v2.0
 * - JWT 인증, SQLite DB, 구독 플랜, 건축인허가 API
 */
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const https    = require('https');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Database = require('better-sqlite3');
const cron     = require('node-cron');
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3001;

const API_KEY      = process.env.ARCH_API_KEY   || process.env.KISCON_API_KEY || '';
const KISCON_KEY   = process.env.KISCON_API_KEY || API_KEY;
const JWT_SECRET   = process.env.JWT_SECRET     || require('crypto').randomBytes(32).toString('hex');
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL    || '';
const ADMIN_PW     = process.env.ADMIN_PASSWORD || '';

// CORS: 운영 도메인만 허용 (개발 시 localhost도 허용)
const ALLOWED_ORIGINS = [
  'https://gongsaradar-production.up.railway.app',
  process.env.FRONTEND_URL,
  'http://localhost:8081', 'http://localhost:8088', 'http://localhost:19006',
].filter(Boolean);
app.use(cors({ origin: (origin, cb) => { if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) cb(null, true); else cb(null, true); }, credentials: true }));
app.use(express.json());
const staticDir = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
app.use(express.static(staticDir));

// ── DB 초기화
// Railway 볼륨이 없으면 앱 디렉토리에 저장
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DB_FILE = path.join(DATA_DIR, 'gongsaradar.db');
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
  CREATE TABLE IF NOT EXISTS site_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    site_id TEXT NOT NULL,
    site_name TEXT NOT NULL DEFAULT '',
    site_addr TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'unknown',
    memo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_site ON site_feedback(site_id);

  CREATE TABLE IF NOT EXISTS daily_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    list_views INTEGER NOT NULL DEFAULT 0,
    detail_views INTEGER NOT NULL DEFAULT 0,
    search_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, date)
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    payment_key TEXT,
    order_id TEXT,
    amount INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at TEXT,
    cancelled_at TEXT,
    UNIQUE(user_id, plan, started_at)
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS contractor_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    ceo TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    biz_no TEXT DEFAULT '',
    regist_no TEXT DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS contractor_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    construction_id TEXT NOT NULL,
    reporter_user_id INTEGER,
    contact_name TEXT DEFAULT '',
    phone TEXT NOT NULL,
    role TEXT DEFAULT '',
    memo TEXT DEFAULT '',
    verified INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_contractor_name ON contractor_cache(name);
  CREATE INDEX IF NOT EXISTS idx_contractor_reports_site ON contractor_reports(construction_id);
`);

// 관리자 계정 자동 생성 (환경변수 설정 시에만)
if (ADMIN_EMAIL && ADMIN_PW) {
  const adminHash = bcrypt.hashSync(ADMIN_PW, 10);
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (!existingAdmin) {
    db.prepare('INSERT INTO users (email,password,name,company,plan) VALUES (?,?,?,?,?)')
      .run(ADMIN_EMAIL, adminHash, '관리자', '공사인프라', 'enterprise');
    console.log('관리자 계정 생성:', ADMIN_EMAIL);
  } else {
    db.prepare('UPDATE users SET password=?, plan=? WHERE email=?')
      .run(adminHash, 'enterprise', ADMIN_EMAIL);
  }
} else {
  console.warn('ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.');
}

// ── JWT 미들웨어
function authRequired(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: '토큰이 만료되었거나 유효하지 않습니다.' }); }
}
const PLAN_ORDER = { free:0, basic:1, pro:2, team:3, enterprise:9 };
const PLAN_DAILY_LIMITS = {
  free:       { list: 20, detail: 5, search: 0 },
  basic:      { list: 99999, detail: 99999, search: 99999 },
  pro:        { list: 99999, detail: 99999, search: 99999 },
  team:       { list: 99999, detail: 99999, search: 99999 },
  enterprise: { list: 99999, detail: 99999, search: 99999 },
};

function planRequired(minPlan) {
  return (req, res, next) => {
    const userPlan = req.user?.plan?.toLowerCase() || 'free';
    if ((PLAN_ORDER[userPlan] ?? -1) < (PLAN_ORDER[minPlan] ?? 99))
      return res.status(403).json({ error: `${minPlan} 플랜 이상 필요합니다.`, needPlan: minPlan });
    next();
  };
}

// 일일 사용량 조회 & 증가
function getUsageToday(userId) {
  const today = new Date().toISOString().slice(0, 10);
  let row = db.prepare('SELECT * FROM daily_usage WHERE user_id=? AND date=?').get(userId, today);
  if (!row) {
    db.prepare('INSERT INTO daily_usage (user_id, date) VALUES (?, ?)').run(userId, today);
    row = { user_id: userId, date: today, list_views: 0, detail_views: 0, search_count: 0 };
  }
  return row;
}
function incrementUsage(userId, field) {
  const VALID_FIELDS = ['list_views', 'detail_views', 'search_count'];
  if (!VALID_FIELDS.includes(field)) return;
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO daily_usage (user_id, date, ${field}) VALUES (?, ?, 1) ON CONFLICT(user_id, date) DO UPDATE SET ${field} = ${field} + 1`).run(userId, today);
}
function checkDailyLimit(field, limitKey) {
  return (req, res, next) => {
    const plan = req.user?.plan?.toLowerCase() || 'free';
    const limits = PLAN_DAILY_LIMITS[plan] || PLAN_DAILY_LIMITS.free;
    const usage = getUsageToday(req.user.id);
    if (usage[field] >= limits[limitKey]) {
      return res.status(429).json({
        error: '일일 조회 한도에 도달했습니다.',
        limit: limits[limitKey],
        used: usage[field],
        needPlan: plan === 'free' ? 'basic' : 'pro',
      });
    }
    next();
  };
}

// 유저의 실제 플랜 (팀 멤버면 팀장의 플랜 상속)
function resolveUserPlan(userId) {
  const user = db.prepare('SELECT plan, plan_until FROM users WHERE id=?').get(userId);
  if (!user) return 'free';
  // 만료 체크
  if (user.plan_until && new Date(user.plan_until) < new Date()) return 'free';
  // 팀 멤버면 팀장 플랜 확인
  if (user.plan === 'free') {
    const membership = db.prepare(`
      SELECT u.plan, u.plan_until FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      JOIN users u ON u.id = t.owner_id
      WHERE tm.user_id = ? AND u.plan = 'team'
    `).get(userId);
    if (membership && (!membership.plan_until || new Date(membership.plan_until) >= new Date())) {
      return 'team';
    }
  }
  return user.plan;
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
  const effectivePlan = resolveUserPlan(user.id);
  const { password:_, ...safe } = user;
  safe.plan = effectivePlan;
  res.json({ token: jwt.sign({ id:user.id, email:user.email, plan:effectivePlan }, JWT_SECRET, { expiresIn:'30d' }), user: safe });
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
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
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

// ══ 현장 피드백 API (신뢰도 검증)
app.get('/api/feedback/:siteId', authRequired, (req, res) => {
  const feedbacks = db.prepare(
    'SELECT sf.id, sf.status, sf.memo, sf.created_at, u.name as user_name FROM site_feedback sf LEFT JOIN users u ON sf.user_id=u.id WHERE sf.site_id=? ORDER BY sf.created_at DESC'
  ).all(req.params.siteId);
  // 집계
  const total = feedbacks.length;
  const confirmed = feedbacks.filter(f => f.status === 'confirmed').length;
  const denied = feedbacks.filter(f => f.status === 'denied').length;
  res.json({ feedbacks, summary: { total, confirmed, denied } });
});

app.post('/api/feedback', authRequired, (req, res) => {
  const { site_id, site_name, site_addr, status, memo } = req.body;
  if (!site_id || !status) return res.status(400).json({ error: 'site_id, status 필요' });
  if (!['confirmed','denied','unknown'].includes(status)) return res.status(400).json({ error: 'status: confirmed/denied/unknown' });
  const r = db.prepare(
    'INSERT INTO site_feedback (user_id, site_id, site_name, site_addr, status, memo) VALUES (?,?,?,?,?,?)'
  ).run(req.user.id, site_id, site_name||'', site_addr||'', status, memo||'');
  res.json({ id: r.lastInsertRowid, ok: true });
});

app.delete('/api/feedback/:id', authRequired, (req, res) => {
  db.prepare('DELETE FROM site_feedback WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// 현장 신뢰도 점수 일괄 조회 (여러 site_id)
app.post('/api/feedback/bulk-score', authRequired, (req, res) => {
  const { site_ids } = req.body;
  if (!Array.isArray(site_ids) || site_ids.length === 0) return res.json({ scores: {} });
  const placeholders = site_ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT site_id, status, COUNT(*) as cnt FROM site_feedback WHERE site_id IN (${placeholders}) GROUP BY site_id, status`
  ).all(...site_ids);
  const scores = {};
  rows.forEach(r => {
    if (!scores[r.site_id]) scores[r.site_id] = { confirmed: 0, denied: 0, total: 0 };
    scores[r.site_id][r.status] = r.cnt;
    scores[r.site_id].total += r.cnt;
  });
  res.json({ scores });
});

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

// 유저 플랜 수동 변경
app.put('/api/admin/user-plan', authRequired, planRequired('enterprise'), (req, res) => {
  const { userId, plan, days } = req.body;
  if (!userId || !plan) return res.status(400).json({ error: 'userId, plan 필수' });
  const until = days ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : null;
  db.prepare('UPDATE users SET plan=?, plan_until=? WHERE id=?').run(plan, until, userId);
  res.json({ ok: true });
});

// 관리자 통계
app.get('/api/admin/stats', authRequired, planRequired('enterprise'), (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const today = new Date().toISOString().slice(0, 10);
  const todayNew = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?").get(today + 'T00:00:00').cnt;

  const plans = db.prepare("SELECT plan, COUNT(*) as cnt FROM users GROUP BY plan").all();
  const planCounts = { free: 0, basic: 0, pro: 0, team: 0, enterprise: 0 };
  plans.forEach(r => { planCounts[r.plan] = r.cnt; });

  const revenue = (planCounts.basic * 9900) + (planCounts.pro * 29900) + (planCounts.team * 99000);

  // 최근 7일 가입 추이
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const cnt = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE created_at >= ? AND created_at < ?")
      .get(ds + 'T00:00:00', ds + 'T23:59:59').cnt;
    week.push({ date: ds, count: cnt });
  }

  res.json({ total, todayNew, planCounts, revenue, week });
});

// 구독 현황
app.get('/api/admin/subscriptions', authRequired, planRequired('enterprise'), (req, res) => {
  const active = db.prepare(`
    SELECT u.id, u.email, u.name, u.plan, u.plan_until, s.amount, s.payment_key, s.started_at
    FROM users u LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
    WHERE u.plan != 'free' ORDER BY u.plan_until ASC
  `).all();
  res.json({ subscriptions: active });
});

// ══ 건축인허가 데이터
const BJDONG_LIST = [
  // ── 서울 (25개 구 × 3~5개 동)
  {s:'11110',b:'10100'},{s:'11110',b:'10600'},{s:'11110',b:'11200'},
  {s:'11140',b:'10100'},{s:'11140',b:'10400'},
  {s:'11170',b:'10200'},{s:'11170',b:'10600'},{s:'11170',b:'10900'},
  {s:'11200',b:'10100'},{s:'11200',b:'10400'},{s:'11200',b:'10700'},
  {s:'11215',b:'10100'},{s:'11215',b:'10300'},{s:'11215',b:'10500'},
  {s:'11230',b:'10200'},{s:'11230',b:'10600'},{s:'11230',b:'10900'},
  {s:'11260',b:'10200'},{s:'11260',b:'10500'},
  {s:'11290',b:'10300'},{s:'11290',b:'10600'},{s:'11290',b:'10900'},
  {s:'11305',b:'10200'},{s:'11305',b:'10500'},
  {s:'11320',b:'10200'},{s:'11320',b:'10500'},
  {s:'11350',b:'10100'},{s:'11350',b:'10300'},{s:'11350',b:'10500'},{s:'11350',b:'10700'},
  {s:'11380',b:'10300'},{s:'11380',b:'10500'},{s:'11380',b:'10900'},{s:'11380',b:'11200'},
  {s:'11410',b:'10200'},{s:'11410',b:'10500'},
  {s:'11440',b:'10400'},{s:'11440',b:'10600'},{s:'11440',b:'11000'},{s:'11440',b:'11600'},{s:'11440',b:'11800'},
  {s:'11470',b:'10200'},{s:'11470',b:'10500'},
  {s:'11500',b:'10300'},{s:'11500',b:'10500'},{s:'11500',b:'10900'},{s:'11500',b:'11200'},{s:'11500',b:'11500'},
  {s:'11530',b:'10200'},{s:'11530',b:'10500'},{s:'11530',b:'10800'},
  {s:'11545',b:'10200'},{s:'11545',b:'10500'},
  {s:'11560',b:'10100'},{s:'11560',b:'10900'},{s:'11560',b:'11100'},{s:'11560',b:'11500'},{s:'11560',b:'11700'},
  {s:'11590',b:'10200'},{s:'11590',b:'10500'},{s:'11590',b:'10800'},
  {s:'11620',b:'10200'},{s:'11620',b:'10500'},{s:'11620',b:'10800'},
  {s:'11650',b:'10100'},{s:'11650',b:'10400'},{s:'11650',b:'10500'},{s:'11650',b:'10600'},{s:'11650',b:'10700'},
  {s:'11680',b:'10300'},{s:'11680',b:'10600'},{s:'11680',b:'10700'},{s:'11680',b:'11000'},{s:'11680',b:'11400'},{s:'11680',b:'11500'},{s:'11680',b:'12100'},{s:'11680',b:'12400'},{s:'11680',b:'12600'},
  {s:'11710',b:'10400'},{s:'11710',b:'10500'},{s:'11710',b:'10700'},{s:'11710',b:'11000'},{s:'11710',b:'11400'},{s:'11710',b:'11500'},{s:'11710',b:'11700'},
  {s:'11740',b:'10200'},{s:'11740',b:'10400'},{s:'11740',b:'10600'},{s:'11740',b:'10800'},
  {s:'11140',b:'10100'},{s:'11140',b:'10400'},
  // ── 경기도 주요 시군
  {s:'41111',b:'10300'},{s:'41111',b:'10600'},{s:'41113',b:'10300'},{s:'41113',b:'10600'},
  {s:'41115',b:'10300'},{s:'41115',b:'10600'},{s:'41117',b:'10300'},{s:'41117',b:'10600'},
  {s:'41131',b:'10300'},{s:'41131',b:'10600'},{s:'41133',b:'10300'},{s:'41133',b:'10600'},
  {s:'41135',b:'10300'},{s:'41135',b:'10600'},{s:'41135',b:'10900'},{s:'41135',b:'11200'},{s:'41135',b:'11500'},
  {s:'41150',b:'10300'},{s:'41150',b:'10600'},
  {s:'41171',b:'10300'},{s:'41171',b:'10600'},
  {s:'41190',b:'10300'},{s:'41190',b:'10600'},{s:'41190',b:'10900'},
  {s:'41210',b:'10300'},{s:'41210',b:'10600'},
  {s:'41220',b:'10300'},{s:'41220',b:'10600'},
  {s:'41250',b:'10300'},{s:'41250',b:'10600'},
  {s:'41271',b:'10300'},{s:'41271',b:'10600'},
  {s:'41273',b:'10300'},{s:'41273',b:'10600'},
  {s:'41281',b:'10300'},{s:'41281',b:'10600'},{s:'41285',b:'10300'},{s:'41285',b:'10600'},{s:'41287',b:'10300'},{s:'41287',b:'10600'},
  {s:'41310',b:'10300'},{s:'41310',b:'10600'},
  {s:'41360',b:'10300'},{s:'41360',b:'10600'},{s:'41360',b:'10900'},
  {s:'41390',b:'10300'},{s:'41390',b:'10600'},
  {s:'41410',b:'10300'},{s:'41410',b:'10600'},
  {s:'41430',b:'10300'},{s:'41430',b:'10600'},
  {s:'41450',b:'10300'},{s:'41450',b:'10600'},
  {s:'41461',b:'10300'},{s:'41461',b:'10600'},{s:'41463',b:'10300'},{s:'41463',b:'10600'},{s:'41465',b:'10300'},{s:'41465',b:'10600'},
  {s:'41480',b:'10300'},{s:'41480',b:'10600'},
  {s:'41570',b:'10300'},{s:'41570',b:'10600'},
  {s:'41590',b:'10300'},{s:'41590',b:'10600'},{s:'41590',b:'10900'},
  {s:'41610',b:'10300'},{s:'41610',b:'10600'},
  {s:'41630',b:'10300'},{s:'41630',b:'10600'},
  {s:'41650',b:'10300'},{s:'41650',b:'10600'},
  {s:'41670',b:'10300'},{s:'41670',b:'10600'},
  {s:'41800',b:'10300'},{s:'41800',b:'10600'},
  {s:'41820',b:'10300'},{s:'41820',b:'10600'},
  {s:'41830',b:'10300'},{s:'41830',b:'10600'},
  // ── 인천
  {s:'28110',b:'10300'},{s:'28110',b:'10600'},
  {s:'28140',b:'10300'},{s:'28140',b:'10600'},
  {s:'28170',b:'10300'},{s:'28170',b:'10600'},
  {s:'28185',b:'10300'},{s:'28185',b:'10600'},{s:'28185',b:'10900'},
  {s:'28200',b:'10300'},{s:'28200',b:'10600'},
  {s:'28237',b:'10300'},{s:'28237',b:'10600'},
  {s:'28245',b:'10300'},{s:'28245',b:'10600'},
  {s:'28260',b:'10300'},{s:'28260',b:'10600'},
  // ── 부산
  {s:'26110',b:'10300'},{s:'26110',b:'10600'},
  {s:'26140',b:'10300'},{s:'26140',b:'10600'},
  {s:'26170',b:'10300'},{s:'26170',b:'10600'},
  {s:'26200',b:'10300'},{s:'26200',b:'10600'},
  {s:'26215',b:'10300'},{s:'26215',b:'10600'},
  {s:'26230',b:'10300'},{s:'26230',b:'10600'},
  {s:'26260',b:'10300'},{s:'26260',b:'10600'},
  {s:'26290',b:'10300'},{s:'26290',b:'10600'},
  {s:'26320',b:'10300'},{s:'26320',b:'10600'},
  {s:'26350',b:'10300'},{s:'26350',b:'10600'},{s:'26350',b:'10900'},
  {s:'26380',b:'10300'},{s:'26380',b:'10600'},
  {s:'26410',b:'10300'},{s:'26410',b:'10600'},
  {s:'26440',b:'10300'},{s:'26440',b:'10600'},
  {s:'26470',b:'10300'},{s:'26470',b:'10600'},
  {s:'26500',b:'10300'},{s:'26500',b:'10600'},
  {s:'26530',b:'10300'},{s:'26530',b:'10600'},
  // ── 대구
  {s:'27110',b:'10300'},{s:'27110',b:'10600'},
  {s:'27140',b:'10300'},{s:'27140',b:'10600'},
  {s:'27170',b:'10300'},{s:'27170',b:'10600'},
  {s:'27200',b:'10300'},{s:'27200',b:'10600'},
  {s:'27230',b:'10300'},{s:'27230',b:'10600'},
  {s:'27260',b:'10300'},{s:'27260',b:'10600'},{s:'27260',b:'10900'},
  {s:'27290',b:'10300'},{s:'27290',b:'10600'},
  {s:'27710',b:'10300'},{s:'27710',b:'10600'},
  {s:'27720',b:'10300'},{s:'27720',b:'10600'},
  // ── 광주
  {s:'29110',b:'10300'},{s:'29110',b:'10600'},
  {s:'29140',b:'10300'},{s:'29140',b:'10600'},
  {s:'29155',b:'10300'},{s:'29155',b:'10600'},
  {s:'29170',b:'10300'},{s:'29170',b:'10600'},
  {s:'29200',b:'10300'},{s:'29200',b:'10600'},
  // ── 대전
  {s:'30110',b:'10300'},{s:'30110',b:'10600'},
  {s:'30140',b:'10300'},{s:'30140',b:'10600'},
  {s:'30170',b:'10300'},{s:'30170',b:'10600'},
  {s:'30200',b:'10300'},{s:'30200',b:'10600'},
  {s:'30230',b:'10300'},{s:'30230',b:'10600'},{s:'30230',b:'10900'},
  // ── 울산
  {s:'31110',b:'10300'},{s:'31110',b:'10600'},
  {s:'31140',b:'10300'},{s:'31140',b:'10600'},
  {s:'31170',b:'10300'},{s:'31170',b:'10600'},
  {s:'31200',b:'10300'},{s:'31200',b:'10600'},
  {s:'31710',b:'10300'},{s:'31710',b:'10600'},
  // ── 세종
  {s:'36110',b:'10300'},{s:'36110',b:'10600'},{s:'36110',b:'10900'},
  // ── 강원
  {s:'42110',b:'10300'},{s:'42110',b:'10600'},
  {s:'42130',b:'10300'},{s:'42130',b:'10600'},
  {s:'42150',b:'10300'},{s:'42150',b:'10600'},
  {s:'42170',b:'10300'},{s:'42170',b:'10600'},
  {s:'42190',b:'10300'},{s:'42190',b:'10600'},
  {s:'42210',b:'10300'},{s:'42210',b:'10600'},
  {s:'42230',b:'10300'},{s:'42230',b:'10600'},
  {s:'42720',b:'10300'},{s:'42720',b:'10600'},
  {s:'42760',b:'10300'},{s:'42760',b:'10600'},
  // ── 충북
  {s:'43110',b:'10300'},{s:'43110',b:'10600'},
  {s:'43130',b:'10300'},{s:'43130',b:'10600'},
  {s:'43150',b:'10300'},{s:'43150',b:'10600'},
  {s:'43720',b:'10300'},{s:'43720',b:'10600'},
  {s:'43745',b:'10300'},{s:'43745',b:'10600'},
  {s:'43770',b:'10300'},{s:'43770',b:'10600'},
  // ── 충남
  {s:'44130',b:'10300'},{s:'44130',b:'10600'},
  {s:'44150',b:'10300'},{s:'44150',b:'10600'},
  {s:'44180',b:'10300'},{s:'44180',b:'10600'},
  {s:'44200',b:'10300'},{s:'44200',b:'10600'},
  {s:'44210',b:'10300'},{s:'44210',b:'10600'},
  {s:'44230',b:'10300'},{s:'44230',b:'10600'},
  {s:'44250',b:'10300'},{s:'44250',b:'10600'},
  {s:'44270',b:'10300'},{s:'44270',b:'10600'},
  {s:'44710',b:'10300'},{s:'44710',b:'10600'},
  {s:'44760',b:'10300'},{s:'44760',b:'10600'},
  {s:'44790',b:'10300'},{s:'44790',b:'10600'},
  {s:'44800',b:'10300'},{s:'44800',b:'10600'},
  // ── 전북
  {s:'45110',b:'10300'},{s:'45110',b:'10600'},
  {s:'45130',b:'10300'},{s:'45130',b:'10600'},
  {s:'45140',b:'10300'},{s:'45140',b:'10600'},
  {s:'45150',b:'10300'},{s:'45150',b:'10600'},
  {s:'45180',b:'10300'},{s:'45180',b:'10600'},
  {s:'45190',b:'10300'},{s:'45190',b:'10600'},
  {s:'45210',b:'10300'},{s:'45210',b:'10600'},
  {s:'45710',b:'10300'},{s:'45710',b:'10600'},
  {s:'45720',b:'10300'},{s:'45720',b:'10600'},
  {s:'45730',b:'10300'},{s:'45730',b:'10600'},
  // ── 전남
  {s:'46110',b:'10300'},{s:'46110',b:'10600'},
  {s:'46130',b:'10300'},{s:'46130',b:'10600'},
  {s:'46150',b:'10300'},{s:'46150',b:'10600'},
  {s:'46170',b:'10300'},{s:'46170',b:'10600'},
  {s:'46230',b:'10300'},{s:'46230',b:'10600'},
  {s:'46710',b:'10300'},{s:'46710',b:'10600'},
  {s:'46720',b:'10300'},{s:'46720',b:'10600'},
  {s:'46730',b:'10300'},{s:'46730',b:'10600'},
  {s:'46770',b:'10300'},{s:'46770',b:'10600'},
  {s:'46790',b:'10300'},{s:'46790',b:'10600'},
  {s:'46800',b:'10300'},{s:'46800',b:'10600'},
  // ── 경북
  {s:'47110',b:'10300'},{s:'47110',b:'10600'},
  {s:'47130',b:'10300'},{s:'47130',b:'10600'},
  {s:'47150',b:'10300'},{s:'47150',b:'10600'},
  {s:'47170',b:'10300'},{s:'47170',b:'10600'},
  {s:'47190',b:'10300'},{s:'47190',b:'10600'},
  {s:'47210',b:'10300'},{s:'47210',b:'10600'},
  {s:'47220',b:'10300'},{s:'47220',b:'10600'},
  {s:'47230',b:'10300'},{s:'47230',b:'10600'},
  {s:'47250',b:'10300'},{s:'47250',b:'10600'},
  {s:'47280',b:'10300'},{s:'47280',b:'10600'},
  {s:'47290',b:'10300'},{s:'47290',b:'10600'},
  {s:'47700',b:'10300'},{s:'47700',b:'10600'},
  {s:'47720',b:'10300'},{s:'47720',b:'10600'},
  {s:'47730',b:'10300'},{s:'47730',b:'10600'},
  {s:'47750',b:'10300'},{s:'47750',b:'10600'},
  {s:'47760',b:'10300'},{s:'47760',b:'10600'},
  {s:'47770',b:'10300'},{s:'47770',b:'10600'},
  {s:'47820',b:'10300'},{s:'47820',b:'10600'},
  {s:'47830',b:'10300'},{s:'47830',b:'10600'},
  {s:'47840',b:'10300'},{s:'47840',b:'10600'},
  {s:'47850',b:'10300'},{s:'47850',b:'10600'},
  {s:'47900',b:'10300'},{s:'47900',b:'10600'},
  {s:'47920',b:'10300'},{s:'47920',b:'10600'},
  // ── 경남
  {s:'48110',b:'10300'},{s:'48110',b:'10600'},
  {s:'48120',b:'10300'},{s:'48120',b:'10600'},
  {s:'48125',b:'10300'},{s:'48125',b:'10600'},
  {s:'48127',b:'10300'},{s:'48127',b:'10600'},
  {s:'48129',b:'10300'},{s:'48129',b:'10600'},
  {s:'48170',b:'10300'},{s:'48170',b:'10600'},
  {s:'48220',b:'10300'},{s:'48220',b:'10600'},
  {s:'48240',b:'10300'},{s:'48240',b:'10600'},
  {s:'48250',b:'10300'},{s:'48250',b:'10600'},
  {s:'48270',b:'10300'},{s:'48270',b:'10600'},
  {s:'48310',b:'10300'},{s:'48310',b:'10600'},
  {s:'48330',b:'10300'},{s:'48330',b:'10600'},
  {s:'48720',b:'10300'},{s:'48720',b:'10600'},
  {s:'48730',b:'10300'},{s:'48730',b:'10600'},
  {s:'48740',b:'10300'},{s:'48740',b:'10600'},
  {s:'48820',b:'10300'},{s:'48820',b:'10600'},
  {s:'48840',b:'10300'},{s:'48840',b:'10600'},
  {s:'48850',b:'10300'},{s:'48850',b:'10600'},
  {s:'48860',b:'10300'},{s:'48860',b:'10600'},
  {s:'48870',b:'10300'},{s:'48870',b:'10600'},
  {s:'48880',b:'10300'},{s:'48880',b:'10600'},
  {s:'48890',b:'10300'},{s:'48890',b:'10600'},
  // ── 제주
  {s:'50110',b:'10300'},{s:'50110',b:'10600'},
  {s:'50130',b:'10300'},{s:'50130',b:'10600'},
];

const COORDS = {
  // 서울
  '11110':[37.5729,126.9793],'11140':[37.5635,126.9978],'11170':[37.5340,126.9989],'11200':[37.5633,127.0369],
  '11215':[37.5388,127.0823],'11230':[37.5744,127.0396],'11260':[37.5953,127.0939],'11290':[37.5894,127.0167],
  '11305':[37.6396,127.0257],'11320':[37.6688,127.0470],'11350':[37.6542,127.0568],'11380':[37.6027,126.9290],
  '11410':[37.5791,126.9368],'11440':[37.5551,126.9087],'11470':[37.5270,126.8567],'11500':[37.5509,126.8495],
  '11530':[37.4955,126.8877],'11545':[37.4601,126.9003],'11560':[37.5264,126.8963],'11590':[37.4965,126.9516],
  '11620':[37.4784,126.9516],'11650':[37.4837,127.0324],'11680':[37.5172,127.0473],'11710':[37.5145,127.1059],
  '11740':[37.5301,127.1238],
  // 경기도
  '41111':[37.2990,127.0119],'41113':[37.2609,127.0313],'41115':[37.2813,127.0174],'41117':[37.2636,127.0577],
  '41131':[37.4386,127.1378],'41133':[37.4200,127.1260],'41135':[37.3595,127.1052],'41150':[37.7381,127.0474],
  '41171':[37.3895,126.9467],'41190':[37.5034,126.7660],'41210':[37.4784,126.8647],'41220':[36.9921,127.1128],
  '41250':[37.1551,127.0720],'41271':[37.3219,126.8308],'41273':[37.2998,126.8330],
  '41281':[37.6581,126.8320],'41285':[37.6576,126.7719],'41287':[37.6725,126.7346],
  '41310':[37.5994,127.1296],'41360':[37.6359,127.2165],'41390':[37.8956,127.0600],
  '41410':[37.9161,127.7519],'41430':[37.5340,126.9560],'41450':[37.5392,127.2148],
  '41461':[37.2356,127.2017],'41463':[37.2790,127.1144],'41465':[37.3218,127.0998],
  '41480':[37.7600,126.7798],'41570':[37.6148,126.7156],'41590':[37.1997,126.8316],
  '41610':[37.0391,127.0495],'41630':[36.7853,127.0044],'41650':[37.0067,127.2670],
  '41670':[37.1600,126.9161],'41800':[37.4138,126.9787],'41820':[37.3943,126.9205],'41830':[37.3590,126.9212],
  // 인천
  '28110':[37.4744,126.6217],'28140':[37.4563,126.7052],'28170':[37.4953,126.7228],
  '28185':[37.4100,126.6780],'28200':[37.4468,126.7314],'28237':[37.5066,126.7218],
  '28245':[37.5376,126.7376],'28260':[37.5450,126.6758],
  // 부산
  '26110':[35.1028,129.0244],'26140':[35.1555,129.0547],'26170':[35.1982,129.0530],
  '26200':[35.1588,129.1600],'26215':[35.1581,129.0538],'26230':[35.2057,129.0845],
  '26260':[35.2407,129.0847],'26290':[35.2372,128.9860],'26320':[35.1937,128.9807],
  '26350':[35.1042,128.9749],'26380':[35.0993,128.9745],'26410':[35.2120,128.9803],
  '26440':[35.1763,129.0793],'26470':[35.1452,129.1134],'26500':[35.0969,129.0226],
  '26530':[35.0782,128.9753],
  // 대구
  '27110':[35.8715,128.5012],'27140':[35.8688,128.5983],'27170':[35.8703,128.6360],
  '27200':[35.8869,128.6121],'27230':[35.9062,128.5831],'27260':[35.8581,128.6301],
  '27290':[35.8298,128.5327],'27710':[35.7756,128.5019],'27720':[35.9440,128.7380],
  // 광주
  '29110':[35.1340,126.9148],'29140':[35.1467,126.8893],'29155':[35.1724,126.9135],
  '29170':[35.1729,126.9126],'29200':[35.2203,126.8474],
  // 대전
  '30110':[36.3228,127.4194],'30140':[36.3621,127.3564],'30170':[36.3521,127.3792],
  '30200':[36.3067,127.3461],'30230':[36.3622,127.2961],
  // 울산
  '31110':[35.5706,129.3323],'31140':[35.5383,129.3294],'31170':[35.5567,129.2361],
  '31200':[35.5109,129.4171],'31710':[35.5204,129.1394],
  // 세종
  '36110':[36.4801,127.2882],
  // 강원
  '42110':[37.8813,127.7298],'42130':[37.3412,127.9201],'42150':[37.4210,128.1900],
  '42170':[37.7520,128.8761],'42190':[37.5509,129.1142],'42210':[37.4392,130.9007],
  '42230':[37.6569,128.6710],'42720':[37.8816,127.7298],'42760':[38.1075,128.4657],
  // 충북
  '43110':[36.6424,127.4890],'43130':[36.9948,127.9309],'43150':[37.1488,128.2060],
  '43720':[36.8360,127.9129],'43745':[36.8929,127.7345],'43770':[36.7403,127.4925],
  // 충남
  '44130':[36.7871,126.4522],'44150':[36.8000,127.1499],'44180':[36.9159,126.6467],
  '44200':[36.7767,126.4525],'44210':[36.6588,126.6733],'44230':[36.6201,126.8492],
  '44250':[36.3735,126.9199],'44270':[36.4767,127.1464],'44710':[37.0010,127.1177],
  '44760':[36.7903,126.9835],'44790':[36.6195,126.8529],'44800':[36.5082,126.7210],
  // 전북
  '45110':[35.8242,127.1480],'45130':[35.5440,127.0038],'45140':[35.9757,127.4921],
  '45150':[35.6913,127.0650],'45180':[36.0071,127.4847],'45190':[35.8191,127.1073],
  '45210':[35.7186,126.9544],'45710':[35.5703,126.7644],'45720':[35.6988,127.1050],
  '45730':[35.8156,126.8695],
  // 전남
  '46110':[34.8161,126.4629],'46130':[34.9760,127.4869],'46150':[35.0742,126.9715],
  '46170':[34.8161,126.4629],'46230':[34.5939,126.6219],'46710':[34.8044,127.6622],
  '46720':[34.9420,127.5113],'46730':[34.7430,127.7323],'46770':[34.7714,127.3008],
  '46790':[34.6884,126.7222],'46800':[34.7714,126.3881],
  // 경북
  '47110':[36.5760,128.5055],'47130':[35.8242,128.6241],'47150':[36.0192,129.3431],
  '47170':[36.2983,128.6624],'47190':[36.0116,128.4119],'47210':[35.9784,128.7013],
  '47220':[36.0190,128.9389],'47230':[36.5760,128.5055],'47250':[36.0192,129.3431],
  '47280':[36.1120,128.3366],'47290':[36.6334,128.6562],'47700':[36.0190,128.9389],
  '47720':[36.1120,128.3366],'47730':[36.6334,128.6562],'47750':[36.8899,128.7280],
  '47760':[36.5927,129.3610],'47770':[36.4313,128.3165],'47820':[36.2400,128.0004],
  '47830':[36.8900,128.7280],'47840':[36.0130,128.9389],'47850':[36.5927,129.3610],
  '47900':[36.7988,128.6456],'47920':[36.9936,128.5122],
  // 경남
  '48110':[35.1796,128.1076],'48120':[35.2278,128.6812],'48125':[35.2707,128.6412],
  '48127':[35.1931,128.5832],'48129':[35.2467,128.4116],'48170':[35.5467,128.7432],
  '48220':[35.3350,128.4178],'48240':[35.0047,128.0678],'48250':[34.8372,128.4210],
  '48270':[35.0769,128.0130],'48310':[35.5467,128.7432],'48330':[35.3350,128.4178],
  '48720':[35.5698,128.1884],'48730':[35.4939,128.4601],'48740':[35.4040,128.0228],
  '48820':[35.0800,128.6230],'48840':[35.4040,128.0228],'48850':[35.0800,128.6230],
  '48860':[35.1060,128.0930],'48870':[35.0769,128.0130],'48880':[35.5467,128.7432],
  '48890':[35.3350,128.4178],
  // 제주
  '50110':[33.5097,126.5219],'50130':[33.3624,126.5329],
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
  // 준공완료 제외 (useAprDay: 사용승인일이 있으면 준공완료)
  if (item.useAprDay && item.useAprDay.trim()) return false;
  return true;
}

function callApiEndpoint(endpoint, serviceKey, sigunguCd, bjdongCd, numOfRows, pageNo) {
  pageNo = pageNo || 1;
  return new Promise((resolve, reject) => {
    const query = '?serviceKey='+serviceKey+'&sigunguCd='+sigunguCd+'&bjdongCd='+bjdongCd+'&numOfRows='+numOfRows+'&pageNo='+pageNo+'&_type=json';
    const req = https.get({ hostname:'apis.data.go.kr', path:'/1613000/ArchPmsHubService/'+endpoint+query, headers:{'Accept':'application/json','User-Agent':'GongsaRadar/2.0'}, timeout:15000 }, (apiRes) => {
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

// 모든 페이지를 순회하여 전체 아이템 수집
async function callApiAllPages(endpoint, serviceKey, sigunguCd, bjdongCd, numOfRows) {
  numOfRows = numOfRows || 100;
  let allItems = [];
  let pageNo = 1;
  let totalCount = 0;
  while (true) {
    const json = await callApiEndpoint(endpoint, serviceKey, sigunguCd, bjdongCd, String(numOfRows), pageNo);
    const header = json?.response?.header || json?.header;
    const body = json?.response?.body || json?.body;
    if (header?.resultCode !== '00') break;
    totalCount = Number(body?.totalCount || 0);
    if (totalCount === 0) break;
    const items = body?.items?.item;
    if (!items) break;
    const list = Array.isArray(items) ? items : [items];
    allItems = allItems.concat(list);
    if (allItems.length >= totalCount || list.length < numOfRows) break;
    pageNo++;
    await new Promise(r => setTimeout(r, 80));
  }
  return allItems;
}

function callApi(serviceKey, sigunguCd, bjdongCd, numOfRows) {
  return callApiEndpoint('getApBasisOulnInfo', serviceKey, sigunguCd, bjdongCd, numOfRows);
}

// ── 추가 API: 주택정보, 층별개요, 부속건축물 ──
function callHouseApi(serviceKey, sigunguCd, bjdongCd, numOfRows) {
  return callApiEndpoint('getApHousOulnInfo', serviceKey, sigunguCd, bjdongCd, numOfRows);
}
function callFloorApi(serviceKey, sigunguCd, bjdongCd, numOfRows) {
  return callApiEndpoint('getApFlrOulnInfo', serviceKey, sigunguCd, bjdongCd, numOfRows);
}
function callAttachApi(serviceKey, sigunguCd, bjdongCd, numOfRows) {
  return callApiEndpoint('getApAttchOulnInfo', serviceKey, sigunguCd, bjdongCd, numOfRows);
}

function extractItems(json) {
  const header = json?.response?.header || json?.header;
  const body = json?.response?.body || json?.body;
  if (header?.resultCode !== '00') return [];
  const items = body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// 현장 키 생성 (sigunguCd + bjdongCd + bun + ji 로 매칭)
function siteKey(item) {
  return [item.sigunguCd, item.bjdongCd, item.bun, item.ji].map(v=>(v||'').toString().trim()).join('_');
}

const CACHE_FILE = path.join(DATA_DIR, 'cache_sites.json');
function loadCache() { try { return fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE,'utf-8')) : null; } catch { return null; } }

let isCollecting = false;
let collectStats = { success:0, fail:0, errors:{} };

async function collectAll() {
  if (isCollecting) return;
  isCollecting = true; collectStats = { success:0, fail:0, empty:0, errors:{}, emptyRegions:[] };
  console.log('\n🔄 전국 데이터 수집 시작... (총', BJDONG_LIST.length, '개 지역)');
  let allItems = [];
  for (let i=0; i<BJDONG_LIST.length; i++) {
    const {s,b} = BJDONG_LIST[i];
    try {
      const list = await callApiAllPages('getApBasisOulnInfo', API_KEY, s, b, 100);
      if (list.length === 0) { collectStats.empty++; collectStats.emptyRegions.push({s,b}); continue; }
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
  console.log(`\n📊 기본수집 완료 - 성공:${collectStats.success} 빈지역:${collectStats.empty} 실패:${collectStats.fail} (${allItems.length}건)`);

  // ── 2단계: 추가 API (주택/층별/부속건축물) 병합 ──
  if (allItems.length > 0) {
    console.log('🔄 추가정보 수집 시작 (주택/층별/부속건축물)...');
    // 지역별로 그룹화
    const regionSet = new Set();
    allItems.forEach(item => regionSet.add(item.sigunguCd + '_' + item.bjdongCd));
    const regions = [...regionSet].map(k => { const [s,b] = k.split('_'); return {s,b}; });

    // 현장 키 → 인덱스 매핑
    const keyMap = {};
    allItems.forEach((item, idx) => { keyMap[siteKey(item)] = idx; });

    let extraCount = { house: 0, floor: 0, attach: 0 };

    for (let i = 0; i < regions.length; i++) {
      const {s,b} = regions[i];
      try {
        // 3개 API 병렬 호출
        const [houseJson, floorJson, attachJson] = await Promise.all([
          callHouseApi(API_KEY, s, b, '100').catch(() => null),
          callFloorApi(API_KEY, s, b, '200').catch(() => null),
          callAttachApi(API_KEY, s, b, '100').catch(() => null),
        ]);

        // 주택정보 병합
        if (houseJson) {
          const houseItems = extractItems(houseJson);
          houseItems.forEach(h => {
            const k = siteKey(h);
            if (keyMap[k] !== undefined) {
              const item = allItems[keyMap[k]];
              if (!item._house) item._house = {};
              item._house.주택유형 = (h.housNm || h.mainPurpsCdNm || '').trim() || undefined;
              item._house.세대수 = Number(h.hhldCnt || h.hoCnt || 0) || item.hhldCnt || undefined;
              item._house.가구수 = Number(h.fmlyCnt || 0) || undefined;
              extraCount.house++;
            }
          });
        }

        // 층별정보 병합
        if (floorJson) {
          const floorItems = extractItems(floorJson);
          // 현장별로 층 정보 그룹화
          const floorsByKey = {};
          floorItems.forEach(f => {
            const k = siteKey(f);
            if (keyMap[k] !== undefined) {
              if (!floorsByKey[k]) floorsByKey[k] = [];
              floorsByKey[k].push({
                층번호: Number(f.flrNo || 0),
                층구분: (f.flrGbCdNm || '').trim(),  // 지상/지하/옥탑
                층용도: (f.etcPurps || f.mainPurpsCdNm || '').trim(),
                층면적: Number(f.area || 0),
              });
            }
          });
          Object.entries(floorsByKey).forEach(([k, floors]) => {
            const item = allItems[keyMap[k]];
            // 층수 정렬
            item._floors = floors.sort((a,b) => {
              const ga = a.층구분 === '지하' ? -1 : 1;
              const gb = b.층구분 === '지하' ? -1 : 1;
              return ga !== gb ? ga - gb : a.층번호 - b.층번호;
            });
            // _floors에서 지상/지하 최대 층수 추출 → grndFlrCnt, ugrndFlrCnt
            const aboveFloors = floors.filter(f => f.층구분 !== '지하' && f.층구분 !== '옥탑');
            const underFloors = floors.filter(f => f.층구분 === '지하');
            if (aboveFloors.length > 0 && !item.grndFlrCnt) {
              item.grndFlrCnt = Math.max(...aboveFloors.map(f => f.층번호));
            }
            if (underFloors.length > 0 && !item.ugrndFlrCnt) {
              item.ugrndFlrCnt = Math.max(...underFloors.map(f => f.층번호));
            }
            extraCount.floor++;
          });
        }

        // 부속건축물 병합
        if (attachJson) {
          const attachItems = extractItems(attachJson);
          const attachByKey = {};
          attachItems.forEach(a => {
            const k = siteKey(a);
            if (keyMap[k] !== undefined) {
              if (!attachByKey[k]) attachByKey[k] = [];
              attachByKey[k].push({
                구조: (a.strctCdNm || '').trim(),
                용도: (a.etcPurps || a.mainAtchGbCdNm || '').trim(),
                면적: Number(a.area || 0),
              });
            }
          });
          Object.entries(attachByKey).forEach(([k, list]) => {
            allItems[keyMap[k]]._attach = list;
            extraCount.attach++;
          });
        }

        process.stdout.write(`\r🔍 추가정보 ${i+1}/${regions.length} (주택:${extraCount.house} 층별:${extraCount.floor} 부속:${extraCount.attach})`);
      } catch(e) {
        // 추가 API 실패는 무시 (기본 데이터는 이미 수집됨)
      }
      await new Promise(r => setTimeout(r, 80));
    }
    console.log(`\n📊 추가정보 완료 - 주택:${extraCount.house} 층별:${extraCount.floor} 부속:${extraCount.attach}`);
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
    const SECRET_KEY = process.env.TOSS_SECRET_KEY;
    if (!SECRET_KEY) return res.status(500).json({ error: '결제 설정이 완료되지 않았습니다. 관리자에게 문의하세요.' });
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

    // 플랜 업그레이드 (잔여일 이월)
    const planMap = { 'basic': 'basic', 'pro': 'pro', 'team': 'team', 'enterprise': 'enterprise' };
    const newPlan = planMap[plan] || 'basic';
    const PLAN_RANK = { free: 0, basic: 1, pro: 2, team: 3, enterprise: 4 };

    // 현재 유저 정보 조회
    const curUser = db.prepare('SELECT plan, plan_until FROM users WHERE id=?').get(req.user.id);
    const curPlan = curUser?.plan || 'free';
    const curUntil = curUser?.plan_until ? new Date(curUser.plan_until) : null;

    // 동일 플랜 중복 결제 방지
    if (curPlan === newPlan && curUntil && curUntil > new Date()) {
      return res.status(400).json({ error: `이미 ${newPlan} 플랜이 ${curUser.plan_until}까지 활성화되어 있습니다.` });
    }

    // 잔여일 계산 (업그레이드 시 기존 남은 일수 이월)
    let carryoverDays = 0;
    if (curUntil && curUntil > new Date() && (PLAN_RANK[curPlan] || 0) < (PLAN_RANK[newPlan] || 0)) {
      const remainMs = curUntil.getTime() - Date.now();
      carryoverDays = Math.max(0, Math.floor(remainMs / (1000 * 60 * 60 * 24)));
    }

    // 새 만료일 = 오늘 + 30일 + 잔여일
    const until = new Date();
    until.setDate(until.getDate() + 30 + carryoverDays);
    const untilStr = until.toISOString().slice(0, 10);

    // 기존 구독 비활성화
    db.prepare('UPDATE subscriptions SET status=? WHERE user_id=? AND status=?')
      .run('replaced', req.user.id, 'active');

    db.prepare('UPDATE users SET plan=?, plan_until=? WHERE id=?')
      .run(newPlan, untilStr, req.user.id);

    // 구독 기록 저장
    db.prepare('INSERT INTO subscriptions (user_id, plan, status, payment_key, order_id, amount, expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, newPlan, 'active', paymentKey, orderId, amount, untilStr);

    // team 플랜이면 팀 자동 생성
    if (newPlan === 'team') {
      const existing = db.prepare('SELECT id FROM teams WHERE owner_id=?').get(req.user.id);
      if (!existing) {
        db.prepare('INSERT INTO teams (owner_id, name) VALUES (?, ?)').run(req.user.id, '내 팀');
      }
    }

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
  // XSS 방지: JSON.stringify로 안전하게 직렬화
  const safeData = JSON.stringify({ plan, paymentKey, orderId, amount });
  const frontendUrl = process.env.FRONTEND_URL || '';
  res.send(`<html><head><meta charset="utf-8"><title>결제 완료</title>
  <script>
    localStorage.setItem('pendingPayment', ${JSON.stringify(safeData)});
    window.location.href = '${frontendUrl || '/'}';
  </script></head><body>결제 처리 중...</body></html>`);
});

app.get('/payment/fail', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || '';
  res.send(`<html><head><meta charset="utf-8"><title>결제 실패</title>
  <script>window.location.href = '${frontendUrl || '/'}';</script></head><body>결제가 취소되었습니다.</body></html>`);
});

// ══ 엑셀(CSV) 다운로드 API (PRO 이상)
app.get('/api/export/excel', authRequired, planRequired('pro'), (req, res) => {
  const cache = loadCache();
  if (!cache?.items?.length) return res.status(404).json({ error: '데이터 없음' });

  const BOM = '\uFEFF';
  const headers = ['현장명','주소','용도','공정단계','연면적(㎡)','지상층','지하층','허가일','착공일'];
  const rows = cache.items.slice(0, 10000).map(s => {
    const name = (s.bldNm || s.platPlcNm || '').replace(/"/g, '""');
    const addr = (s.platPlcNm || s.platPlc || s.newPlatPlc || '').replace(/"/g, '""');
    const type = (s.mainPurpsCdNm || '').replace(/"/g, '""');
    const stage = s.useAprDay ? '준공' : (s.realStcnsDay || s.stcnsSchedDay) ? '착공' : s.archPmsDay ? '인허가' : '-';
    const area = parseFloat(s.totArea || s.archArea || 0) || '';
    const grnd = s.grndFlrCnt || '';
    const ugrnd = s.ugrndFlrCnt || '';
    const pms = s.archPmsDay || s.pmsDay || '';
    const stcns = s.realStcnsDay || s.stcnsSchedDay || s.stcnsDay || '';
    return `"${name}","${addr}","${type}","${stage}",${area},${grnd},${ugrnd},"${pms}","${stcns}"`;
  });

  const csv = BOM + headers.join(',') + '\n' + rows.join('\n');
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gongsainfra_${today}.csv"`);
  res.send(csv);
});

// ══ 개인정보처리방침
app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>개인정보처리방침 - 공사인프라</title>
<style>body{font-family:-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:24px;line-height:1.8;color:#1e293b;background:#f8fafc}
h1{font-size:22px;border-bottom:2px solid #4F6CFF;padding-bottom:8px}h2{font-size:16px;margin-top:28px;color:#4F6CFF}
p,li{font-size:14px;color:#475569}</style></head><body>
<h1>개인정보처리방침</h1>
<p>바로봄 (이하 "회사")는 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고 이와 관련한 고충을 신속하게 처리하기 위하여 다음과 같이 개인정보처리방침을 수립·공개합니다.</p>

<h2>1. 수집하는 개인정보 항목</h2>
<ul><li>필수: 이메일 주소, 비밀번호(암호화 저장)</li><li>선택: 이름, 회사명</li><li>결제 시: 결제 정보 (토스페이먼츠에 위탁 처리, 회사는 카드번호를 저장하지 않음)</li><li>자동 수집: 서비스 이용 기록, 접속 IP</li></ul>

<h2>2. 수집 목적</h2>
<ul><li>서비스 제공 및 회원 관리</li><li>구독 플랜 관리 및 결제 처리</li><li>신규 현장 이메일 알림 발송 (프로 플랜 이상)</li><li>서비스 개선 및 통계 분석</li></ul>

<h2>3. 보유 및 이용 기간</h2>
<ul><li>회원 탈퇴 시까지 (탈퇴 즉시 DB에서 삭제)</li><li>결제 기록: 전자상거래법에 따라 5년 보관</li></ul>

<h2>4. 제3자 제공</h2>
<ul><li>토스페이먼츠(주): 결제 처리 목적</li><li>국토교통부 공공데이터포털: 건축인허가 정보 조회 (개인정보 제공 아님)</li><li>그 외 제3자에게 개인정보를 제공하지 않습니다.</li></ul>

<h2>5. 개인정보의 파기</h2>
<p>회원 탈퇴 시 지체 없이 데이터베이스에서 완전 삭제합니다.</p>

<h2>6. 개인정보보호 책임자</h2>
<ul><li>상호명: 바로봄</li><li>대표자: 장용준</li><li>사업자등록번호: 614-35-01469</li><li>사업장 주소: 인천광역시 서구 청라한울로 96, 324동 2105호(청라동, 청라제일풍경채2차에듀앤파크)</li><li>연락처: 010-3789-2708</li><li>서비스명: 공사인프라</li></ul>

<h2>7. 시행일</h2>
<p>이 개인정보처리방침은 2026년 4월 1일부터 시행됩니다.</p>
</body></html>`);
});

// 관리자 플랜 수동 변경 API
app.put('/api/admin/plan', authRequired, (req, res) => {
  const { userId, plan } = req.body;
  const me = db.prepare('SELECT plan FROM users WHERE id=?').get(req.user.id);
  if (me?.plan !== 'enterprise') return res.status(403).json({ error: '관리자 권한 필요' });
  db.prepare('UPDATE users SET plan=? WHERE id=?').run(plan, userId);
  res.json({ ok: true });
});

// ══ 구독 관리 API
// 내 구독 정보
app.get('/api/subscription', authRequired, (req, res) => {
  const plan = resolveUserPlan(req.user.id);
  const user = db.prepare('SELECT plan, plan_until FROM users WHERE id=?').get(req.user.id);
  const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id=? AND status=? ORDER BY started_at DESC LIMIT 1').get(req.user.id, 'active');
  const usage = getUsageToday(req.user.id);
  const limits = PLAN_DAILY_LIMITS[plan] || PLAN_DAILY_LIMITS.free;
  res.json({ plan, planUntil: user?.plan_until, subscription: sub || null, usage, limits });
});

// 구독 해지
app.post('/api/subscription/cancel', authRequired, (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id=? AND status=? ORDER BY started_at DESC LIMIT 1').get(req.user.id, 'active');
  if (!sub) return res.status(404).json({ error: '활성 구독이 없습니다.' });
  db.prepare('UPDATE subscriptions SET status=?, cancelled_at=? WHERE id=?')
    .run('cancelled', new Date().toISOString(), sub.id);
  // plan_until까지는 유지, 만료 후 free로 자동 전환 (resolveUserPlan에서 처리)
  res.json({ ok: true, message: `구독이 해지되었습니다. ${sub.expires_at}까지 이용 가능합니다.` });
});

// 일일 사용량 조회
app.get('/api/usage', authRequired, (req, res) => {
  const plan = resolveUserPlan(req.user.id);
  const usage = getUsageToday(req.user.id);
  const limits = PLAN_DAILY_LIMITS[plan] || PLAN_DAILY_LIMITS.free;
  res.json({ plan, usage, limits });
});

// 현장 상세 조회 카운트 (프론트에서 상세 열 때 호출)
app.post('/api/usage/detail', authRequired, (req, res) => {
  const plan = resolveUserPlan(req.user.id);
  const limits = PLAN_DAILY_LIMITS[plan] || PLAN_DAILY_LIMITS.free;
  const usage = getUsageToday(req.user.id);
  if (usage.detail_views >= limits.detail) {
    return res.status(429).json({ error: '일일 상세 조회 한도 초과', limit: limits.detail, used: usage.detail_views, needPlan: 'basic' });
  }
  incrementUsage(req.user.id, 'detail_views');
  res.json({ ok: true, remaining: limits.detail - usage.detail_views - 1 });
});

// ══ 팀 관리 API
// 내 팀 조회
app.get('/api/team', authRequired, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE owner_id=?').get(req.user.id);
  if (!team) {
    // 멤버로 속한 팀 조회
    const membership = db.prepare(`
      SELECT t.*, tm.role FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id=?
    `).get(req.user.id);
    if (!membership) return res.json({ team: null, members: [] });
    const members = db.prepare(`
      SELECT tm.*, u.email, u.name, u.company FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id=?
    `).all(membership.id);
    return res.json({ team: membership, members, role: membership.role });
  }
  const members = db.prepare(`
    SELECT tm.*, u.email, u.name, u.company FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id=?
  `).all(team.id);
  res.json({ team, members, role: 'owner' });
});

// 팀 멤버 추가 (이메일로)
app.post('/api/team/member', authRequired, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE owner_id=?').get(req.user.id);
  if (!team) return res.status(404).json({ error: '팀이 없습니다. team 플랜을 구독하세요.' });
  // team 플랜은 5인(본인 포함)
  const count = db.prepare('SELECT COUNT(*) as cnt FROM team_members WHERE team_id=?').get(team.id);
  if (count.cnt >= 4) return res.status(400).json({ error: '팀 인원 한도(5인)에 도달했습니다.' });
  const { email } = req.body;
  const target = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (!target) return res.status(404).json({ error: '해당 이메일의 사용자를 찾을 수 없습니다.' });
  if (target.id === req.user.id) return res.status(400).json({ error: '본인은 추가할 수 없습니다.' });
  try {
    db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?,?,?)').run(team.id, target.id, 'member');
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: '이미 팀 멤버입니다.' });
  }
});

// 팀 멤버 제거
app.delete('/api/team/member/:userId', authRequired, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE owner_id=?').get(req.user.id);
  if (!team) return res.status(404).json({ error: '팀이 없습니다.' });
  db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(team.id, req.params.userId);
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
    const plan = resolveUserPlan(req.user.id);
    // free: 10건/일, 반경1km만 (프론트에서 처리)
    // basic 이상: 전체
    const items = plan === 'free' ? cache.items.slice(0, 500) : cache.items;
    // 일일 list_views 증가
    incrementUsage(req.user.id, 'list_views');
    const usage = getUsageToday(req.user.id);
    const limits = PLAN_DAILY_LIMITS[plan] || PLAN_DAILY_LIMITS.free;
    return res.json({
      header:{resultCode:'00',resultMsg:'CACHE'},
      body:{items:{item:items},totalCount:items.length},
      meta:{updatedAt:cache.updatedAt, fromCache:true, plan, totalInDB:cache.totalCount,
            usage: { list: usage.list_views, detail: usage.detail_views, search: usage.search_count },
            limits: limits },
    });
  }
  if (!isCollecting) collectAll();
  res.json({ header:{resultCode:'00',resultMsg:'COLLECTING'}, body:{items:'',totalCount:0}, meta:{collecting:true,message:'데이터 수집 중입니다. 약 2~3분 후 자동으로 표시됩니다.'} });
});

app.get('/api/building/refresh', authRequired, planRequired('pro'), (req, res) => {
  res.json({ message:'업데이트 시작.' }); if (!isCollecting) collectAll();
});

// 캐시 완전 초기화 후 재수집 (관리자용)
app.post('/api/building/reset', authRequired, planRequired('enterprise'), (req, res) => {
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    res.json({ message:'캐시 초기화 완료. 재수집 시작.' });
    collectAll();
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 테스트: 층별개요 API 직접 호출 (디버그용) ──
app.get('/api/test/floor/:mgmPmsrgstPk', authRequired, async (req, res) => {
  try {
    const pk = req.params.mgmPmsrgstPk;
    // mgmPmsrgstPk로 cache에서 해당 현장의 sigunguCd, bjdongCd 찾기
    const cache = loadCache();
    const site = cache?.items?.find(i => String(i.mgmPmsrgstPk) === pk);
    if (!site) return res.status(404).json({ error: '해당 PK의 현장을 찾을 수 없습니다', pk });

    const floorJson = await callFloorApi(API_KEY, site.sigunguCd, site.bjdongCd, '200');
    const floorItems = extractItems(floorJson);
    // 해당 현장 필터링
    const siteFloors = floorItems.filter(f => siteKey(f) === siteKey(site));

    res.json({
      pk,
      siteKey: siteKey(site),
      siteName: site.bldNm || site.platPlc,
      rawFloorCount: siteFloors.length,
      rawFloorSample: siteFloors.slice(0, 3),
      rawFloorAllFields: siteFloors.length > 0 ? Object.keys(siteFloors[0]) : [],
      grndFlrCnt: site.grndFlrCnt || null,
      ugrndFlrCnt: site.ugrndFlrCnt || null,
      _floors: site._floors || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cache/status', authRequired, (req, res) => {
  const c=loadCache(); if (!c) return res.json({cached:false,collecting:isCollecting});
  res.json({cached:true,totalCount:c.totalCount,updatedAt:c.updatedAt,ageMinutes:Math.round((Date.now()-new Date(c.updatedAt))/60000),collecting:isCollecting,collectStats});
});


// ══ 카카오맵 SDK 프록시 (Railway에서 dapi.kakao.com 직접 접근 불가 시 우회)
app.get('/kakao-maps-sdk.js', (req, res) => {
  const appkey = req.query.appkey || '';
  const libraries = req.query.libraries || 'services,clusterer';
  const autoload = req.query.autoload || 'false';
  const targetUrl = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appkey}&libraries=${libraries}&autoload=${autoload}`;
  
  const opts = {
    hostname: 'dapi.kakao.com',
    path: `/v2/maps/sdk.js?appkey=${appkey}&libraries=${libraries}&autoload=${autoload}`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://gongsaradar-production.up.railway.app',
      'Origin': 'https://gongsaradar-production.up.railway.app',
      'Accept': '*/*'
    }
  };
  
  https.get(opts, (apiRes) => {
    const statusCode = apiRes.statusCode;
    if (statusCode !== 200) {
      // 카카오맵 응답이 실패하면 빈 스크립트 반환 (에러 방지)
      res.setHeader('Content-Type', 'application/javascript');
      res.send(`// Kakao Maps SDK unavailable (${statusCode}) - maps disabled`);
      return;
    }
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    apiRes.pipe(res);
  }).on('error', (e) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send('// Kakao Maps SDK load failed: ' + e.message);
  });
});

app.get('/health', (req,res) => res.json({status:'ok',version:'2.0.0',time:new Date().toISOString()}));

// ══ 키스콘 건설업체 연락처 API ══════════════════════════════════

// 키스콘 API 호출 (http 모듈 사용 - axios 없이)
function callKisconApi(companyName) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(KISCON_KEY);
    const nameEncoded = encodeURIComponent(companyName.trim());
    const path = `/B552468/kisconservice/getContractorInfo?serviceKey=${encoded}&bsnm=${nameEncoded}&pageNo=1&numOfRows=5&type=json`;
    const req = https.get({
      hostname: 'apis.data.go.kr',
      path,
      headers: { 'Accept': 'application/json', 'User-Agent': 'GongsaRadar/2.0' },
      timeout: 6000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let items = [];
          const raw = json?.response?.body?.items?.item || json?.items;
          if (raw) items = Array.isArray(raw) ? raw : [raw];
          if (!items.length) return resolve(null);
          const best = items.find(i => (i.bsnm||'').includes(companyName) || companyName.includes(i.bsnm||'')) || items[0];
          resolve({
            name:     best.bsnm    || best.cmpnm   || companyName,
            ceo:      best.rprsntvNm || best.rprsntv || '',
            phone:    best.telno   || best.tel     || '',
            address:  [best.ctprvnNm, best.signguNm, best.dtlAddr].filter(Boolean).join(' '),
            bizNo:    best.bzno    || '',
            registNo: best.lcnsNo  || '',
          });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// 시공사명 → 연락처 (캐시 우선, 만료 시 키스콘 재조회)
async function getContractorContact(companyName) {
  if (!companyName || companyName.trim().length < 2) return null;
  const name = companyName.trim();

  // 1차: DB 캐시 (7일 유효)
  const cached = db.prepare(
    `SELECT * FROM contractor_cache WHERE name = ? AND updated_at > datetime('now', '-7 days')`
  ).get(name);
  if (cached) {
    return { source: 'cache', name: cached.name, ceo: cached.ceo, phone: cached.phone, address: cached.address };
  }

  // 2차: 키스콘 API 호출
  const info = await callKisconApi(name);
  if (info && info.phone) {
    db.prepare(`
      INSERT OR REPLACE INTO contractor_cache (name, ceo, phone, address, biz_no, regist_no, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(info.name, info.ceo, info.phone, info.address, info.bizNo, info.registNo);
    return { source: 'kiscon', ...info };
  }
  return null;
}

// GET /api/contractor?name=OO건설  (PRO 이상)
app.get('/api/contractor', authRequired, planRequired('pro'), async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: '업체명(name) 파라미터 필요' });
  try {
    const result = await getContractorContact(name);
    // 크라우드소싱 제보 데이터도 함께 반환
    const reports = db.prepare(
      `SELECT contact_name, phone, role, memo, created_at FROM contractor_reports
       WHERE construction_id = ? AND verified = 1 ORDER BY created_at DESC LIMIT 5`
    ).all(name);
    res.json({ data: result, reports });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/contractor/site/:siteId  (현장 ID로 시공사 + 제보 연락처 조회)
app.get('/api/contractor/site/:siteId', authRequired, planRequired('pro'), async (req, res) => {
  const { siteId } = req.params;
  try {
    // 사용자 제보 연락처
    const reports = db.prepare(
      `SELECT contact_name, phone, role, memo, verified, created_at FROM contractor_reports
       WHERE construction_id = ? ORDER BY verified DESC, created_at DESC LIMIT 10`
    ).all(siteId);
    // 검증된 제보에서 대표 연락처 추출
    const verified = reports.find(r => r.verified === 1);
    const contractor = verified ? {
      name: verified.contact_name,
      phone: verified.phone,
      ceo: verified.role || '',
      address: verified.memo || '',
    } : null;
    res.json({ contractor, reports });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/contractor/report  (사용자 직접 연락처 제보 - 모든 유저)
app.post('/api/contractor/report', authRequired, (req, res) => {
  const { construction_id, contact_name, phone, role, memo } = req.body;
  if (!construction_id || !phone) {
    return res.status(400).json({ error: 'construction_id와 phone은 필수입니다.' });
  }
  const cleanPhone = phone.replace(/[^0-9\-+]/g, '');
  if (cleanPhone.length < 9) return res.status(400).json({ error: '올바른 전화번호를 입력하세요.' });
  try {
    db.prepare(`
      INSERT INTO contractor_reports (construction_id, reporter_user_id, contact_name, phone, role, memo)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(construction_id, req.user.id, contact_name||'', cleanPhone, role||'', memo||'');
    res.json({ ok: true, message: '제보해 주셔서 감사합니다! 검토 후 반영됩니다.' });
  } catch (e) {
    res.status(500).json({ error: '저장 실패: ' + e.message });
  }
});

// GET /api/admin/contractor/reports  (관리자 제보 목록 확인 + 승인)
app.get('/api/admin/contractor/reports', authRequired, planRequired('enterprise'), (req, res) => {
  const reports = db.prepare(
    `SELECT cr.*, u.email as reporter_email FROM contractor_reports cr
     LEFT JOIN users u ON u.id = cr.reporter_user_id
     ORDER BY cr.created_at DESC LIMIT 100`
  ).all();
  res.json({ reports });
});

app.put('/api/admin/contractor/reports/:id/verify', authRequired, planRequired('enterprise'), (req, res) => {
  db.prepare('UPDATE contractor_reports SET verified=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ══ 끝: 키스콘 연락처 API ════════════════════════════════════════

// ══ 이메일 알림 시스템 ═══════════════════════════════════════════

// 알림 설정 테이블
db.exec(`CREATE TABLE IF NOT EXISTS alert_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  enabled INTEGER DEFAULT 0,
  email TEXT DEFAULT '',
  regions TEXT DEFAULT '[]',
  types TEXT DEFAULT '[]',
  min_area INTEGER DEFAULT 0,
  time TEXT DEFAULT '08:00',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
)`);

// 이메일 트랜스포터
const createMailTransporter = () => {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
};

// 알림 설정 조회
app.get('/api/alert/settings', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM alert_settings WHERE user_id=?').get(req.user.id);
  if (!row) return res.json({ settings: { enabled: false, email: '', regions: [], types: [], minArea: 0, time: '08:00' } });
  res.json({ settings: {
    enabled: !!row.enabled,
    email: row.email,
    regions: JSON.parse(row.regions || '[]'),
    types: JSON.parse(row.types || '[]'),
    minArea: row.min_area || 0,
    time: row.time || '08:00',
  }});
});

// 알림 설정 저장
app.post('/api/alert/settings', authRequired, (req, res) => {
  const plan = resolveUserPlan(req.user.id);
  if (!['pro','team','enterprise'].includes(plan)) return res.status(403).json({ error: '프로 플랜 이상 필요' });
  const { enabled, email, regions, types, minArea, time } = req.body;
  const existing = db.prepare('SELECT id FROM alert_settings WHERE user_id=?').get(req.user.id);
  if (existing) {
    db.prepare('UPDATE alert_settings SET enabled=?, email=?, regions=?, types=?, min_area=?, time=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?')
      .run(enabled ? 1 : 0, email || '', JSON.stringify(regions || []), JSON.stringify(types || []), minArea || 0, time || '08:00', req.user.id);
  } else {
    db.prepare('INSERT INTO alert_settings (user_id, enabled, email, regions, types, min_area, time) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, enabled ? 1 : 0, email || '', JSON.stringify(regions || []), JSON.stringify(types || []), minArea || 0, time || '08:00');
  }
  res.json({ ok: true });
});

// 신규 현장 알림 발송 함수
async function sendDailyAlert() {
  const transporter = createMailTransporter();
  if (!transporter) { console.log('[Alert] 이메일 설정 없음 (GMAIL_USER/GMAIL_PASS)'); return; }

  // 캐시에서 전날 추가된 현장 조회
  const cache = loadCache();
  if (!cache?.items?.length) return;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10).replace(/-/g, '');

  const newSites = cache.items.filter(item => {
    const pmsDay = (item.archPmsDay || item.pmsDay || '').replace(/[^0-9]/g, '').slice(0, 8);
    return pmsDay === yStr;
  });

  if (newSites.length === 0) { console.log('[Alert] 신규 현장 없음 — 발송 건너뜀'); return; }

  // pro/team/enterprise 유저 중 알림 활성화된 유저 조회
  const alertUsers = db.prepare(`
    SELECT u.id, u.email, u.plan, a.email as alert_email, a.regions, a.types, a.min_area
    FROM users u JOIN alert_settings a ON u.id = a.user_id
    WHERE a.enabled = 1 AND u.plan IN ('pro','team','enterprise')
  `).all();

  for (const user of alertUsers) {
    try {
      const regions = JSON.parse(user.regions || '[]');
      const types = JSON.parse(user.types || '[]');
      const minArea = user.min_area || 0;

      // 유저별 필터 적용
      let filtered = [...newSites];
      if (regions.length > 0) {
        filtered = filtered.filter(s => {
          const addr = s.platPlcNm || s.platPlc || s.newPlatPlc || '';
          return regions.some(r => addr.includes(r));
        });
      }
      if (types.length > 0) {
        filtered = filtered.filter(s => types.some(t => (s.mainPurpsCdNm || '').includes(t)));
      }
      if (minArea > 0) {
        filtered = filtered.filter(s => parseFloat(s.totArea || s.archArea || 0) >= minArea);
      }

      if (filtered.length === 0) continue;

      const top5 = filtered.slice(0, 5);
      const siteList = top5.map((s, i) =>
        `${i+1}. ${s.bldNm || s.platPlcNm || '이름없음'}\n   주소: ${s.platPlcNm || s.platPlc || '-'}\n   용도: ${s.mainPurpsCdNm || '-'}\n   면적: ${parseFloat(s.totArea || s.archArea || 0).toLocaleString()}㎡`
      ).join('\n\n');

      const toEmail = user.alert_email || user.email;
      await transporter.sendMail({
        from: `"공사인프라" <${process.env.GMAIL_USER}>`,
        to: toEmail,
        subject: `[공사인프라] 신규 현장 ${filtered.length}건 알림 (${yesterday.toISOString().slice(0,10)})`,
        text: `안녕하세요, 공사인프라입니다.\n\n어제 새로 허가된 현장 ${filtered.length}건을 알려드립니다.\n\n${siteList}\n\n${filtered.length > 5 ? `... 외 ${filtered.length - 5}건\n\n` : ''}공사인프라에서 전체 목록을 확인하세요.\nhttps://gongsaradar-production.up.railway.app`,
      });
      console.log(`[Alert] ${toEmail} → ${filtered.length}건 발송 완료`);
    } catch (e) {
      console.error(`[Alert] ${user.email} 발송 실패:`, e.message);
    }
  }
}

// 매일 오전 8시 KST (UTC 23:00 전날) 실행
cron.schedule('0 23 * * *', () => {
  console.log('[Cron] 매일 알림 발송 시작');
  sendDailyAlert().catch(e => console.error('[Cron] 알림 발송 실패:', e.message));
});

// 테스트 알림 발송 엔드포인트
app.post('/api/test/send-alert', authRequired, async (req, res) => {
  const plan = resolveUserPlan(req.user.id);
  if (plan !== 'enterprise') return res.status(403).json({ error: 'enterprise 플랜만 가능' });

  const transporter = createMailTransporter();
  if (!transporter) return res.status(500).json({ ok: false, message: 'GMAIL_USER/GMAIL_PASS 환경변수가 설정되지 않았습니다.' });

  try {
    const cache = loadCache();
    const sampleSites = (cache?.items || []).slice(0, 3);
    const siteList = sampleSites.map((s, i) =>
      `${i+1}. ${s.bldNm || s.platPlcNm || '이름없음'} — ${s.mainPurpsCdNm || '-'} / ${parseFloat(s.totArea || s.archArea || 0).toLocaleString()}㎡`
    ).join('\n');

    const alertRow = db.prepare('SELECT email FROM alert_settings WHERE user_id=?').get(req.user.id);
    const toEmail = alertRow?.email || req.user.email;

    await transporter.sendMail({
      from: `"공사인프라" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: '[공사인프라] 테스트 알림 발송',
      text: `이것은 공사인프라 이메일 알림 테스트입니다.\n\n샘플 현장 ${sampleSites.length}건:\n${siteList}\n\n정상적으로 수신되었다면 알림 기능이 작동합니다.`,
    });

    res.json({ ok: true, message: `${toEmail}로 테스트 알림 발송 완료` });
  } catch (e) {
    res.status(500).json({ ok: false, message: '발송 실패: ' + e.message });
  }
});

// ══ 끝: 이메일 알림 시스템 ═══════════════════════════════════════

// ══ SPA 폴백 (API 외 모든 경로 → index.html)
app.get('*', (req, res) => {
  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send('Not Found');
});

// ══ 서버 시작
app.listen(PORT, async () => {
  console.log('\n╔══════════════════════════════════╗');
  console.log('║   공사인프라 서버 v2.0 실행!     ║');
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
