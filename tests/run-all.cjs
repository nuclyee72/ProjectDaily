// 테스트 전부 차례로 — 하나라도 실패하면 종료 코드 1
const { spawnSync } = require('child_process');
const path = require('path');

const TESTS = ['hub.test.cjs', 'stats.test.cjs', 'layout.test.cjs'];
let failed = 0;
for (const t of TESTS) {
  console.log(`\n━━━ ${t} ━━━`);
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed}개 테스트 파일 실패` : '\n전체 통과');
process.exitCode = failed ? 1 : 0;
