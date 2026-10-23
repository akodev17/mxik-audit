// Memory of the API process (by port 4025's PID) around one check and five parallel checks.
import { execSync } from 'node:child_process';
import { verified, uniq } from './lib.mjs';
const pid = execSync('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 4025 -State Listen).OwningProcess"').toString().trim().split(/\s+/)[0];
const mem = () => Math.round(Number(execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64"`).toString().trim()) / 1048576);
const U = await verified(`a5-mem-${uniq()}@example.test`, 'Mem probe');
const key = (await U.call('POST', '/api/account/api-keys', { name: 'mem' })).data.token;
const check = () => U.call('POST', '/api/v1/check', { items: [{ name: 'Coca-Cola 0.5 l' }] }, { headers: { authorization: `Bearer ${key}` }, noCsrf: true });
console.log('pid', pid, 'idle MB', mem());
let t = Date.now(); const r1 = await check(); console.log('1 check', r1.status, Date.now() - t, 'ms; MB', mem());
t = Date.now(); const r2 = await check(); console.log('2nd check', r2.status, Date.now() - t, 'ms; MB', mem());
t = Date.now(); const r5 = await Promise.all([1, 2, 3, 4, 5].map(check)); console.log('5 parallel', r5.map((r) => r.status).join(','), Date.now() - t, 'ms; MB', mem());
