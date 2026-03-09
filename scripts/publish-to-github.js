const fs = require('fs');
const path = require('path');
const https = require('https');

function walk(dir, predicate) {
  const res = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (!predicate(rel, it)) continue;
    if (it.isDirectory()) {
      res.push(...walk(full, predicate));
    } else if (it.isFile()) {
      res.push(full);
    }
  }
  return res;
}

function parseRepo(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)(?:\.git)?$/i);
  if (!m) throw new Error('Invalid GitHub repo url');
  return { owner: m[1], repo: m[2] };
}

function requestGitHub(method, pathUrl, token, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: 'api.github.com',
      path: pathUrl,
      headers: {
        'User-Agent': 'trae-uploader',
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        const status = res.statusCode || 0;
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (_) {}
        if (status >= 200 && status < 300) return resolve(json);
        resolve({ __error: true, status, data: json || data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

const ROOT = process.cwd();
const TOKEN = process.env.GITHUB_TOKEN;
const REPO_URL = process.env.REPO_URL || process.argv.find(a => a.startsWith('--repo='))?.slice(7) || '';
const BRANCH = process.env.BRANCH || process.argv.find(a => a.startsWith('--branch='))?.slice(9) || undefined;
if (!TOKEN) {
  console.error('Missing GITHUB_TOKEN in env.');
  process.exit(1);
}
if (!REPO_URL) {
  console.error('Missing repo url. Pass --repo=https://github.com/<owner>/<repo>');
  process.exit(1);
}
const { owner, repo } = parseRepo(REPO_URL);

const excludeDirs = new Set(['node_modules', 'data', '.git', '.vscode', '.idea', 'coverage', 'logs']);
const excludeFiles = new Set(['.DS_Store']);

const files = walk(ROOT, (rel, it) => {
  if (!rel) return true;
  const segs = rel.split('/');
  if (segs.some(s => excludeDirs.has(s))) return false;
  if (excludeFiles.has(path.basename(rel))) return false;
  return true;
});

(async () => {
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const content = fs.readFileSync(abs);
    const b64 = content.toString('base64');
    const qBranch = BRANCH ? `?ref=${encodeURIComponent(BRANCH)}` : '';
    const getResp = await requestGitHub('GET', `/repos/${owner}/${repo}/contents/${encodePath(rel)}${qBranch}`, TOKEN);
    let sha = null;
    if (getResp && !getResp.__error && getResp.sha) sha = getResp.sha;
    const body = { message: `chore: add ${rel}`, content: b64 };
    if (BRANCH) body.branch = BRANCH;
    if (sha) body.sha = sha;
    const putResp = await requestGitHub('PUT', `/repos/${owner}/${repo}/contents/${encodePath(rel)}`, TOKEN, body);
    if (putResp && putResp.__error) {
      console.error(`Failed: ${rel} -> ${putResp.status}`);
      process.exitCode = 1;
    } else {
      console.log(`Uploaded: ${rel}`);
    }
  }
})(); 

