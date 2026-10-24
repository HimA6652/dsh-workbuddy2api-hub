#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 抽出某个版本的正文，作为 GitHub Release 的说明。
 *
 *   node scripts/release-notes.mjs v1.0.6 > notes.md
 *
 * 找不到对应小节时不报错、也不编内容：打印一句「见 CHANGELOG.md」交差，
 * 免得一个漏写的标题把整个发布流程卡死。
 */
import { readFileSync } from 'node:fs'

const tag = process.argv[2] ?? ''
const version = tag.replace(/^v/, '')

if (version === '') {
  console.error('用法：node scripts/release-notes.mjs <tag>')
  process.exit(2)
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = changelog.split(/\r?\n/)
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))

if (start === -1) {
  console.error(`CHANGELOG.md 里没有 ${version} 的小节，Release 说明将只有安装提示。`)
  console.log(`详见 [CHANGELOG.md](https://github.com/HimA6652/dsh-workbuddy2api-hub/blob/main/CHANGELOG.md)`)
  process.exit(0)
}

let end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
if (end === -1) end = lines.length

const body = lines.slice(start + 1, end).join('\n').trim()

console.log(
  [
    body,
    '',
    '---',
    '',
    '**安装 / 升级**',
    '',
    '```bash',
    'git clone https://github.com/HimA6652/dsh-workbuddy2api-hub.git',
    'cd dsh-workbuddy2api-hub',
    'node scripts/install-local.mjs   # 已装过就再跑一次，覆盖旧链接',
    '```',
    '',
    '然后重启 DSH 桌面端。不需要 `npm install`，本包没有运行时依赖。',
    '',
    '升级前建议先 `npm run check`（确认仓库里没有混进凭据或本机路径）。',
  ].join('\n'),
)
