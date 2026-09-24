#!/usr/bin/env node
/**
 * assemble-site.mjs — 허브 + 세 게임(서브모듈)을 GitHub Pages에 올릴 한 사이트로 조립한다.
 * 허브는 사이트 루트, 게임은 각자 폴더 (/ProjectDaily/DailySudoku/ 등).
 * 배포 워크플로(.github/workflows/pages.yml)와 로컬 테스트(tests/)가 같이 쓴다.
 *
 * 사용: node scripts/assemble-site.mjs <출력 폴더>   (기본: _site)
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? '_site');

const HUB_FILES = ['index.html', '.nojekyll', 'icon.svg', 'manifest.webmanifest'];
// 게임마다 사이트에 필요한 것만 (scripts · docs · node_modules 등은 제외)
const GAME_FILES = {
  DailySudoku:     ['index.html', 'style.css', 'icon.svg', 'manifest.webmanifest', 'src', 'daily'],
  DailyTrilateral: ['index.html', 'style.css', 'icon.svg', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'src', 'daily'],
  DailyWordship:   ['index.html', 'style.css', 'icon.svg', 'manifest.webmanifest', 'src', 'daily'],
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of HUB_FILES) cpSync(path.join(ROOT, f), path.join(OUT, f));
for (const [game, files] of Object.entries(GAME_FILES)) {
  for (const f of files) cpSync(path.join(ROOT, game, f), path.join(OUT, game, f), { recursive: true });
}
console.log(`사이트 조립 완료 → ${OUT}`);
