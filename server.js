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

