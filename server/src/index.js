require('dotenv').config();
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');

if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters.');
}
if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required.');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Same-origin hosting is recommended. If cross-origin hosting is used, configure exact origin
// and cookie settings deliberately; do not use wildcard CORS with credentials.
if (process.env.FRONTEND_ORIGIN) {
  app.use((req,res,next)=>{
    const origin=req.headers.origin;
    if (origin === process.env.FRONTEND_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Credentials','true');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, X-EduCore-Request');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
    }
    if(req.method==='OPTIONS') return res.sendStatus(origin===process.env.FRONTEND_ORIGIN?204:403);
    next();
  });
}

app.use(session({
  name: 'educore.sid',
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true, pruneSessionInterval: 15 }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8, path: '/' }
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many login attempts. Please try again in 15 minutes.' } });
app.use('/api/auth/login', loginLimiter);

// Lightweight same-site request guard for state-changing API calls. The browser client sends
// this custom header; cross-origin HTML forms cannot set it. Keep the app same-origin when possible.
app.use('/api', (req,res,next)=>{
  if (['POST','PUT','PATCH','DELETE'].includes(req.method) && req.path !== '/auth/login') {
    const origin = req.get('origin');
    const expected = process.env.FRONTEND_ORIGIN;
    if (expected && origin !== expected) return res.status(403).json({error:'Request origin rejected.'});
    if (req.get('x-educore-request') !== '1') return res.status(403).json({error:'Missing request security header.'});
  }
  next();
});

app.get('/api/health', async (_req,res) => {
  try { await pool.query('SELECT 1'); res.json({status:'ok',database:'connected'}); }
  catch { res.status(503).json({status:'error',database:'unavailable'}); }
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/students', require('./routes/students'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/results', require('./routes/results'));
app.use('/api/fees', require('./routes/fees'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/school', require('./routes/school'));

const publicDir = path.join(__dirname, '../../public');
app.use(express.static(publicDir, { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('*', (req,res,next)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'API endpoint not found.'});
  res.sendFile(path.join(publicDir,'index.html'), err=>{if(err)next(err);});
});
app.use((err,req,res,_next)=>{
  console.error('Request error:', { method:req.method, path:req.path, message:err.message });
  if(res.headersSent) return;
  res.status(err.status || 500).json({error:err.status && err.status<500 ? err.message : 'An unexpected server error occurred.'});
});

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, ()=>console.log(`EduCore server running on port ${port}`));
async function shutdown(){ server.close(()=>{}); await pool.end(); process.exit(0); }
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
