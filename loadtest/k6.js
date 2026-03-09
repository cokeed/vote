import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  vus: 200,
  duration: '30s'
};

const BASE = __ENV.BASE || 'http://localhost:3000';
const POLL_ID = __ENV.POLL_ID || 1;

export default function () {
  const c = http.get(`${BASE}/api/captcha`);
  const cj = c.json();
  const answer = eval(cj.question.replace('= ?', ''));
  const payload = JSON.stringify({ captcha_id: cj.id, captcha_answer: String(answer), choices: [1] });
  const headers = { 'Content-Type': 'application/json' };
  const res = http.post(`${BASE}/api/polls/${POLL_ID}/vote`, payload, { headers });
  check(res, { 'status is 200 or conflict': r => r.status === 200 || r.status === 409 });
  sleep(0.2);
}
