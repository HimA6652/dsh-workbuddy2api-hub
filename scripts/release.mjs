#!/usr/bin/env node
/**
 * 一条命令发版：改版本号 → 自检 → 测试 → 发 npm → 提交 → 打标签 → 推送。
 * 推送标签后，.github/workflows/release.yml 会自动建 GitHub Release。
 *
 *   node scripts/release.mjs 1.0.7
 *   node scripts/release.mjs 1.0.7 --dry-run      # 只跑到测试为止，不发 npm、不提交
 *   node scripts/release.mjs 1.0.7 --no-publish   # 跳过 npm，只发 GitHub
 *   node scripts/release.mjs 1.0.7 --no-push      # 提交和打标签，但不推
 *
 * 前提：CHANGELOG.md 里已经写好 `## [1.0.7]` 那一节——正文就是 Release 说明，
 * 这段必须人写（脚本不会替你编）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const version = (args[0] ?? '').replace(/^v/, '')
const dryRun = args.includes('--dry-run')
const noPush = args.includes('--no-push')
const noPublish = args.includes('--no-publish')

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function run(command, commandArgs) {
  console.log(`$ ${command} ${commandArgs.join(' ')}`)
  execFileSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' })
}

function output(command, commandArgs) {
  return execFileSync(command, commandArgs, { cwd: ROOT, encoding: 'utf8' }).trim()
}

// Windows 上 npm 是 .cmd 批处理，Node 20+ 不允许直接 execFile 它（会 ENOENT/EINVAL），
// 得让 shell 去解析。只有 npm 走这条路，git / node 仍走 execFile。
function runShell(command) {
  console.log(`$ ${command}`)
  execFileSync(command, { cwd: ROOT, stdio: 'inherit', shell: true })
}

// 同上，但要拿 stdout；失败不抛，交给调用方判断
function outputShell(command) {
  try {
    return execFileSync(command, { cwd: ROOT, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    return String(error.stdout ?? '').trim()
  }
}

if (!/^\d+\.\d+\.\d+$/.test(version)) fail('用法：node scripts/release.mjs <major.minor.patch> [--dry-run] [--no-publish] [--no-push]')

const packageName = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).name

// 1. 版本说明必须先存在，否则发出去的 Release 是空的
const changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8')
if (!changelog.includes(`## [${version}]`)) {
  fail(`CHANGELOG.md 里没有 "## [${version}]" 这一节，先把这版改了什么写进去`)
}

// 2. 工作区要干净，免得分不清哪些改动进了这一版
const dirty = output('git', ['status', '--porcelain'])
if (dirty !== '') fail(`工作区还有未提交的改动：\n${dirty}\n先提交或 stash，再发版`)

const branch = output('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail(`当前分支是 ${branch}，发版要在 main 上`)

// 3. 标签不能重名
const tags = output('git', ['tag', '--list', `v${version}`])
if (tags !== '') fail(`标签 v${version} 已经存在——改完 CHANGELOG 用新版本号，或者先 git tag -d v${version}`)

// 4. 改版本号：package.json 与测试里的断言各一处
const pkgPath = resolve(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const previous = pkg.version
if (previous !== version) {
  writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`)

  const hostTestPath = resolve(ROOT, 'tests/host.test.mjs')
  const hostTest = readFileSync(hostTestPath, 'utf8')
  const patched = hostTest.replace(/PLUGIN_VERSION, '\d+\.\d+\.\d+'/, `PLUGIN_VERSION, '${version}'`)
  if (patched === hostTest) {
    // 测试里可能用的是「匹配语义化版本」的正则而不是字面量——那种写法天生适配任何版本，不用改。
    if (!/PLUGIN_VERSION,\s*\/\^\\d\+\\\.\\d\+\\\.\\d\+\$/.test(hostTest)) {
      fail('tests/host.test.mjs 里既没有字面量也没有正则断言，手动改一下再跑')
    }
    console.log(`✔ 版本 ${previous} → ${version}（host.test 用正则校验，不用改）`)
  } else {
    writeFileSync(hostTestPath, patched)
    console.log(`✔ 版本 ${previous} → ${version}`)
  }
} else {
  console.log(`✔ package.json 已经是 ${version}，只补标签`)
}

// 5. 自检 + 测试：坏版本不放行
run('node', ['scripts/check-secrets.mjs'])
run('node', ['scripts/release-notes.mjs', `v${version}`])
runShell('npm test')

if (dryRun) {
  console.log('\n--dry-run：测试通过，但没发 npm、没提交、没打标签。工作区里的版本号改动自己决定留还是撤。')
  process.exit(0)
}

// 6. 发 npm：先确认登录态与版本号没被占，再传（prepublishOnly 会再跑一遍自检 + 测试）
if (!noPublish) {
  const who = outputShell('npm whoami')
  if (who === '') fail('npm 没登录，发布不了。先跑 npm whoami 看看；只想发 GitHub 就加 --no-publish')
  console.log(`✔ npm 登录用户：${who}`)

  const already = outputShell(`npm view ${packageName}@${version} version`)
  if (already === version) {
    fail(`${packageName}@${version} 已经在 npm 上了，别再传；换版本号或者加 --no-publish 只发 GitHub`)
  }
  runShell(`npm publish`)
  console.log(`✔ ${packageName}@${version} 已发布到 npm`)
}

// 7. 提交 + 打标签 + 推送
run('git', ['add', '-A'])
// 版本号若早就 amend 进功能提交（或手动改过），这里就没什么可提交的。
// 空 commit 会让脚本当场退出，把后面的标签和推送一起带走——1.2.0 那次就是这么丢的。
if (outputShell('git diff --cached --name-only') !== '') {
  run('git', ['commit', '-m', `chore(release): v${version}`])
} else {
  console.log('✔ 工作区没有待提交的改动（版本号已在别处改过），跳过 commit')
}
run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`])

if (noPush) {
  console.log(`\n--no-push：提交与标签 v${version} 已建好，推送请手动执行`)
  console.log(`  git push && git push origin v${version}`)
  process.exit(0)
}

run('git', ['push'])
run('git', ['push', 'origin', `v${version}`])

const repo = (pkg.repository?.url ?? 'https://github.com/HimA6652/dsh-workbuddy2api-hub.git').replace(/^git\+/, '').replace(/\.git$/, '')
console.log(`\n✔ 已推送 v${version}。GitHub Release 由 Actions 自动创建，稍等半分钟：`)
console.log(`  ${repo}/releases`)
if (noPublish) console.log(`  npm 这次没发（--no-publish），需要时手动 npm publish`)
