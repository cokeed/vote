const API = '';
let authToken = localStorage.getItem('authToken') || '';
let captchaState = { id: null };

function setMsg(id, text, isError=false) {
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.className = isError ? 'error' : (text ? 'success' : 'muted');
}

async function fetchJSON(url, opts={}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'Authorization': 'Bearer ' + authToken } : {}),
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    let msg = '请求失败';
    try { const j = await res.json(); msg = j.error || JSON.stringify(j); } catch(_) {}
    throw new Error(msg);
  }
  return res.json();
}

async function loadCaptcha() {
  const c = await fetchJSON('/api/captcha');
  captchaState = c;
  document.getElementById('reg-captcha-question').value = c.question;
  document.getElementById('reg-captcha-answer').value = '';
}

async function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const j = await fetchJSON('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    authToken = j.token;
    localStorage.setItem('authToken', authToken);
    setMsg('login-msg', '登录成功');
  } catch(e) {
    setMsg('login-msg', e.message, true);
  }
}

async function register() {
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const captcha_answer = document.getElementById('reg-captcha-answer').value.trim();
  try {
    const j = await fetchJSON('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, captcha_id: captchaState.id, captcha_answer })
    });
    setMsg('reg-msg', '注册成功，请登录');
    await loadCaptcha();
  } catch(e) {
    setMsg('reg-msg', e.message, true);
    await loadCaptcha();
  }
}

function onTypeChange() {
  const type = document.getElementById('poll-type').value;
  document.getElementById('option-box').style.display = (type === 'rating') ? 'none' : 'block';
  document.getElementById('rating-box').style.display = (type === 'rating') ? 'block' : 'none';
}

async function createPoll() {
  const title = document.getElementById('poll-title').value.trim();
  const description = document.getElementById('poll-desc').value.trim();
  const type = document.getElementById('poll-type').value;
  const deadline = document.getElementById('poll-deadline').value.trim() || null;
  const rating_scale = Number(document.getElementById('poll-scale').value) || 5;
  const optionsText = document.getElementById('poll-options').value;
  const options = optionsText.split('\n').map(s => s.trim()).filter(Boolean);
  try {
    const payload = { title, description, type, deadline };
    if (type === 'rating') payload.rating_scale = rating_scale;
    else payload.options = options;
    await fetchJSON('/api/polls', { method: 'POST', body: JSON.stringify(payload) });
    setMsg('create-msg', '提交成功，等待审核');
  } catch(e) {
    setMsg('create-msg', e.message, true);
  }
}

function renderPollList(items) {
  const box = document.getElementById('poll-list');
  box.innerHTML = '';
  items.forEach(p => {
    const div = document.createElement('div');
    div.className = 'poll card';
    const dl = p.deadline ? new Date(p.deadline).toLocaleString() : '无';
    div.innerHTML = `
      <div>
        <div><strong>${p.title}</strong> <span class="badge">${p.type}</span></div>
        <div class="muted">${p.description || ''}</div>
        <div class="muted">截止：${dl}</div>
      </div>
      <div>
        <button data-id="${p.id}" class="btn-open">进入</button>
      </div>
    `;
    box.appendChild(div);
  });
  box.querySelectorAll('.btn-open').forEach(btn => {
    btn.addEventListener('click', () => openPoll(Number(btn.dataset.id)));
  });
}

async function loadPolls() {
  const items = await fetchJSON('/api/polls?status=approved');
  renderPollList(items);
}

async function openPoll(id) {
  const p = await fetchJSON(`/api/polls/${id}`);
  const box = document.getElementById('poll-list');
  const dl = p.deadline ? new Date(p.deadline).toLocaleString() : '无';
  const opts = p.options || [];
  let optionsHtml = '';
  if (p.type === 'single' || p.type === 'multiple') {
    const type = p.type === 'single' ? 'radio' : 'checkbox';
    optionsHtml = `<div class="options">` + opts.map(o => `
      <label><input type="${type}" name="opt" value="${o.id}"/> ${o.text}</label>
    `).join('') + `</div>`;
  } else {
    optionsHtml = `<label>评分（1-${p.rating_scale}）</label><input id="rate-input" type="number" min="1" max="${p.rating_scale}" value="5"/>`;
  }
  box.innerHTML = `
    <div class="card">
      <h3>${p.title} <span class="badge">${p.type}</span></h3>
      <div class="muted">${p.description || ''}</div>
      <div class="muted">截止：${dl}</div>
      ${optionsHtml}
      <div class="row" style="align-items:flex-end">
        <div class="col">
          <label>验证码</label>
          <input id="vote-captcha-question" disabled/>
        </div>
        <div class="col">
          <label>答案</label>
          <input id="vote-captcha-answer"/>
        </div>
        <div><button id="btn-refresh-vcaptcha" class="secondary">刷新</button></div>
      </div>
      <div style="margin-top:8px"><button id="btn-vote">提交投票</button></div>
      <div id="vote-msg" class="muted"></div>
      <div style="margin-top:12px"><strong>实时结果</strong></div>
      <pre id="result-box" class="muted"></pre>
      <div><button id="btn-back" class="secondary">返回列表</button></div>
    </div>
  `;
  let voteCaptcha = await fetchJSON('/api/captcha');
  document.getElementById('vote-captcha-question').value = voteCaptcha.question;
  document.getElementById('btn-refresh-vcaptcha').onclick = async () => {
    voteCaptcha = await fetchJSON('/api/captcha');
    document.getElementById('vote-captcha-question').value = voteCaptcha.question;
    document.getElementById('vote-captcha-answer').value = '';
  };
  document.getElementById('btn-back').onclick = loadPolls;
  document.getElementById('btn-vote').onclick = async () => {
    try {
      let payload = { captcha_id: voteCaptcha.id, captcha_answer: document.getElementById('vote-captcha-answer').value.trim() };
      if (p.type === 'rating') {
        payload.score = Number(document.getElementById('rate-input').value);
      } else {
        const chosen = Array.from(document.querySelectorAll('input[name="opt"]:checked')).map(i => Number(i.value));
        payload.choices = chosen;
      }
      const j = await fetchJSON(`/api/polls/${id}/vote`, { method: 'POST', body: JSON.stringify(payload) });
      setMsg('vote-msg', '投票成功');
      renderResult(j.results);
    } catch(e) {
      setMsg('vote-msg', e.message, true);
    }
  };
  const es = new EventSource(`/api/polls/${id}/stream`);
  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      renderResult(data.results);
    } catch(_) {}
  };
}

function renderResult(data) {
  const box = document.getElementById('result-box');
  if (!data) { box.textContent = '暂无数据'; return; }
  if (data.type === 'rating') {
    box.textContent = `投票数：${data.count}\n平均分：${(data.average || 0).toFixed(2)} / ${data.scale}`;
  } else {
    const lines = data.options.map(o => `${o.text}：${o.count}`);
    box.textContent = lines.join('\n');
  }
}

document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('btn-register').addEventListener('click', register);
document.getElementById('btn-refresh-captcha').addEventListener('click', loadCaptcha);
document.getElementById('btn-create').addEventListener('click', createPoll);
document.getElementById('btn-refresh-list').addEventListener('click', loadPolls);
document.getElementById('poll-type').addEventListener('change', onTypeChange);

loadCaptcha();
onTypeChange();
loadPolls();

