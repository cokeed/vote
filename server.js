const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { users, polls, votes, captcha } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const IP_HASH_SECRET = process.env.IP_HASH_SECRET || 'ip-secret';

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120
});
app.use('/api', apiLimiter);

function hashIp(ip) {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', IP_HASH_SECRET).update(ip).digest('hex');
}

function authMiddleware(requiredRole = null) {
  return (req, res, next) => {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: '未授权' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ error: '权限不足' });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: '令牌无效' });
    }
  };
}

async function ensureAdminSeed() {
  const existing = await users.findOne({ username: 'admin' });
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', 10);
    await users.insert({ username: 'admin', email: 'admin@example.com', password_hash: hash, role: 'admin' });
    console.log('Seeded default admin user: admin / admin123');
  }
}
ensureAdminSeed();

// Captcha
app.get('/api/captcha', async (req, res) => {
  const a = Math.floor(1 + Math.random() * 9);
  const b = Math.floor(1 + Math.random() * 9);
  const id = uuidv4();
  const solution = String(a + b);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await captcha.insert({ id, solution, expires_at: expiresAt, used: false });
  res.json({ id, question: `${a} + ${b} = ?`, expiresAt });
});

async function verifyCaptcha(id, answer) {
  if (!id || !answer) return false;
  const row = await captcha.findOne({ id });
  if (!row) return false;
  if (row.used) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  const ok = row.solution === String(answer).trim();
  if (ok) {
    await captcha.update({ id }, { $set: { used: true } });
  }
  return ok;
}

// Auth
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, captcha_id, captcha_answer } = req.body || {};
  if (!await verifyCaptcha(captcha_id, captcha_answer)) {
    return res.status(400).json({ error: '验证码错误或过期' });
  }
  if (!username || !password) return res.status(400).json({ error: '用户名与密码必填' });
  const exists = await users.findOne({ username });
  if (exists) return res.status(409).json({ error: '用户名已存在' });
  const hash = bcrypt.hashSync(password, 10);
  await users.insert({ username, email: email || null, password_hash: hash, role: 'user' });
  res.json({ message: '注册成功' });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await users.findOne({ username });
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: user._id, username: user.username, role: user.role } });
});

// Poll creation and management
app.post('/api/polls', authMiddleware(), async (req, res) => {
  const { title, description, type, options: opts, rating_scale, deadline } = req.body || {};
  if (!title || !type) return res.status(400).json({ error: '标题与类型必填' });
  if (!['single','multiple','rating'].includes(type)) return res.status(400).json({ error: '不支持的投票类型' });
  try {
    const poll = {
      title,
      description: description || null,
      type,
      rating_scale: type === 'rating' ? (rating_scale || 5) : undefined,
      deadline: deadline || null,
      status: 'pending',
      created_by: req.user.id,
      options: type === 'rating' ? [] : (Array.isArray(opts) ? opts.map(t => ({ id: uuidv4(), text: String(t) })) : [])
    };
    if (type !== 'rating' && poll.options.length === 0) return res.status(400).json({ error: '选项不能为空' });
    const inserted = await polls.insert(poll);
    res.json({ id: inserted._id, status: inserted.status });
  } catch (e) {
    res.status(400).json({ error: e.message || '创建失败' });
  }
});

app.get('/api/polls', async (req, res) => {
  const status = req.query.status || 'approved';
  const rows = await polls.find({ status }).sort({ createdAt: -1 });
  res.json(rows);
});

app.get('/api/polls/:id', async (req, res) => {
  const id = req.params.id;
  const poll = await polls.findOne({ _id: id });
  if (!poll) return res.status(404).json({ error: '未找到该投票' });
  res.json(poll);
});

async function computeResults(pollId) {
  const poll = await polls.findOne({ _id: pollId });
  if (!poll) return null;
  if (poll.type === 'rating') {
    const items = await votes.find({ poll_id: pollId });
    const count = items.length;
    const avg = count ? items.reduce((a, b) => a + (b.score || 0), 0) / count : 0;
    return { type: 'rating', count, average: avg, scale: poll.rating_scale || 5 };
  } else {
    const counts = {};
    (poll.options || []).forEach(o => counts[o.id] = 0);
    const items = await votes.find({ poll_id: pollId });
    items.forEach(v => {
      (v.choices || []).forEach(id => { if (counts[id] !== undefined) counts[id]++; });
    });
    return { type: poll.type, options: (poll.options || []).map(o => ({ id: o.id, text: o.text, count: counts[o.id] || 0 })) };
  }
}

// SSE for real-time results
const sseClients = new Map(); // pollId -> Set(res)
async function broadcastResults(pollId) {
  const data = await computeResults(pollId);
  const set = sseClients.get(pollId);
  if (!set || !data) return;
  const payload = `data: ${JSON.stringify({ pollId, results: data })}\n\n`;
  for (const res of set) {
    res.write(payload);
  }
}

app.get('/api/polls/:id/stream', async (req, res) => {
  const pollId = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const set = sseClients.get(pollId) || new Set();
  set.add(res);
  sseClients.set(pollId, set);
  const init = await computeResults(pollId);
  if (init) {
    res.write(`data: ${JSON.stringify({ pollId, results: init })}\n\n`);
  }
  req.on('close', () => {
    set.delete(res);
  });
});

// Vote
const voteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    return hashIp(ip);
  }
});

app.post('/api/polls/:id/vote', voteLimiter, async (req, res) => {
  const pollId = req.params.id;
  const { choices, score, captcha_id, captcha_answer } = req.body || {};
  if (!await verifyCaptcha(captcha_id, captcha_answer)) {
    return res.status(400).json({ error: '验证码错误或过期' });
  }
  const poll = await polls.findOne({ _id: pollId });
  if (!poll || poll.status !== 'approved') return res.status(404).json({ error: '投票不存在或未通过审核' });
  if (poll.deadline && new Date(poll.deadline).getTime() < Date.now()) {
    return res.status(400).json({ error: '投票已截止' });
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const ipHash = hashIp(ip);

  const bearer = req.headers['authorization'] || '';
  let userId = null;
  if (bearer.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(bearer.slice(7), JWT_SECRET);
      userId = payload.id;
    } catch (_) {}
  }
  const existingByUser = userId ? await votes.findOne({ poll_id: pollId, user_id: userId }) : null;
  const existingByIp = await votes.findOne({ poll_id: pollId, ip_hash: ipHash });
  if (existingByUser || (!userId && existingByIp)) {
    return res.status(409).json({ error: '您已投过票' });
  }

  if (poll.type === 'rating') {
    const s = Number(score);
    const scale = poll.rating_scale || 5;
    if (!Number.isFinite(s) || s < 1 || s > scale) return res.status(400).json({ error: '评分不合法' });
    await votes.insert({ poll_id: pollId, user_id: userId || null, ip_hash: ipHash, score: s });
  } else if (poll.type === 'single') {
    if (!Array.isArray(choices) || choices.length !== 1) return res.status(400).json({ error: '单选需选择一个选项' });
    const valid = (poll.options || []).some(o => o.id === choices[0]);
    if (!valid) return res.status(400).json({ error: '选项无效' });
    await votes.insert({ poll_id: pollId, user_id: userId || null, ip_hash: ipHash, choices });
  } else {
    if (!Array.isArray(choices) || choices.length === 0) return res.status(400).json({ error: '多选至少选择一个选项' });
    const ids = new Set((poll.options || []).map(o => o.id));
    for (const c of choices) {
      if (!ids.has(c)) return res.status(400).json({ error: '包含无效选项' });
    }
    await votes.insert({ poll_id: pollId, user_id: userId || null, ip_hash: ipHash, choices });
  }
  await broadcastResults(pollId);
  res.json({ message: '投票成功', results: await computeResults(pollId) });
});

// Admin endpoints
app.get('/api/admin/polls/pending', authMiddleware('admin'), async (req, res) => {
  const rows = await polls.find({ status: 'pending' }).sort({ createdAt: -1 });
  res.json(rows);
});

app.post('/api/admin/polls/:id/approve', authMiddleware('admin'), async (req, res) => {
  const id = req.params.id;
  await polls.update({ _id: id }, { $set: { status: 'approved' } });
  res.json({ id, status: 'approved' });
});

app.post('/api/admin/polls/:id/reject', authMiddleware('admin'), async (req, res) => {
  const id = req.params.id;
  await polls.update({ _id: id }, { $set: { status: 'rejected' } });
  res.json({ id, status: 'rejected' });
});

app.get('/api/admin/stats', authMiddleware('admin'), async (req, res) => {
  const usersCount = await users.count({});
  const pollsCount = await polls.count({});
  const votesCount = await votes.count({});
  res.json({ users: usersCount, polls: pollsCount, votes: votesCount });
});

// Results
app.get('/api/polls/:id/results', async (req, res) => {
  const pollId = req.params.id;
  const data = await computeResults(pollId);
  if (!data) return res.status(404).json({ error: '未找到该投票' });
  res.json(data);
});

// Serve static frontend
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
app.use('/', express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Swagger UI
const swaggerUi = require('swagger-ui-express');
const swaggerPath = path.join(__dirname, 'docs', 'swagger.json');
if (fs.existsSync(swaggerPath)) {
  const swaggerDoc = require(swaggerPath);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (fs.existsSync(swaggerPath)) {
    console.log(`API docs: http://localhost:${PORT}/api-docs`);
  }
});
