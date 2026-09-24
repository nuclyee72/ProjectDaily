/**
 * 테스트 공용 — 사이트를 조립해 /ProjectDaily/ 경로로 로컬 서빙한다.
 * BASE 환경변수를 주면 조립·서빙 없이 그 주소를 테스트한다 (예: 실제 사이트).
 *   BASE=https://nuclyee72.github.io/ProjectDaily/ npm test
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');
const TEST_DIR = path.join(REPO, '.test-site');
const SITE_ROOT = path.join(TEST_DIR, 'site');
const SHOTS = path.join(TEST_DIR, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
};

/** @returns {Promise<{ base: string, close: () => void }>} */
async function startSite() {
  if (process.env.BASE) return { base: process.env.BASE, close() {} };
  execFileSync(process.execPath, [path.join(REPO, 'scripts', 'assemble-site.mjs'), path.join(SITE_ROOT, 'ProjectDaily')], { stdio: 'ignore' });
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE_ROOT, p);
    if (!f.startsWith(SITE_ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
    if (fs.statSync(f).isDirectory()) { res.writeHead(301, { Location: p + '/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  return { base: `http://localhost:${server.address().port}/ProjectDaily/`, close: () => server.close() };
}

let failures = 0;
function check(ok, msg) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
}
function finish() {
  console.log(failures ? `\n${failures}개 실패` : '\n모두 통과');
  process.exitCode = failures ? 1 : 0;
}

module.exports = { chromium, startSite, check, finish, SHOTS };
