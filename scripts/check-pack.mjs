// 发布制品的白名单闸：pack 出来的文件必须与 package.json 的 files 逐项对得上，
// 并且不允许出现备份/临时/编辑器残留。
// 起因：1.3.2 的包里混进了一个 lib/hub.js.bak-*（files 写的是目录，目录里多出的东西被整包收走）。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const SELF = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md'])
const FORBIDDEN = /\.(bak|orig|rej|swp|tmp|log|tsbuildinfo)$|~$|\.bak-|\.DS_Store$|(^|\/)node_modules\//i

function fail(lines) {
  console.log(lines.join('\n'))
  process.exitCode = 1
}

const declared = Array.isArray(pkg.files) ? pkg.files : []
if (declared.length === 0) {
  fail(['✗ package.json 没有 files 白名单——打包会把整个工作目录收进去。'])
  process.exit(1)
}

const dirEntries = declared.filter((item) => {
  const full = join(ROOT, item)
  if (!existsSync(full)) return false
  try {
    return statSync(full).isDirectory()
  } catch {
    return false
  }
})
if (dirEntries.length > 0) {
  fail([
    `✗ files 里出现目录条目：${dirEntries.join(', ')}`,
    '  目录会连带收走其中任何新增文件（备份、编辑器残留、临时脚本）。请把条目改成具体文件。',
  ])
  process.exit(1)
}

// Windows 上 npm 是 .cmd，必须经 shell；命令写成一整串（不带 args 数组）可避开 DEP0190 警告。
const run = spawnSync('npm pack --dry-run --json', {
  cwd: ROOT,
  encoding: 'utf8',
  shell: true,
})
if (run.status !== 0) {
  fail([
    `✗ npm pack --dry-run 失败：${[run.error?.message, (run.stderr || '').trim().split('\n').slice(-3).join(' | ')]
      .filter(Boolean)
      .join(' ')}`,
  ])
  process.exit(1)
}

const raw = run.stdout ?? ''
const start = raw.indexOf('[')
const end = raw.lastIndexOf(']')
if (start < 0 || end < start) {
  fail([`✗ 解析不了 pack 输出：${raw.slice(0, 160)}`])
  process.exit(1)
}

let parsed
try {
  parsed = JSON.parse(raw.slice(start, end + 1))
} catch (error) {
  fail([`✗ pack 输出不是合法 JSON：${error.message}`])
  process.exit(1)
}

const entry = parsed[0] ?? {}
const shipped = (entry.files ?? []).map((file) => file.path)
const size = entry.size ?? 0
const unpacked = entry.unpackedSize ?? 0

const problems = []

for (const path of shipped) {
  if (FORBIDDEN.test(path)) problems.push(`✗ 制品里有不该出现的文件：${path}`)
}

const expected = new Set([...declared, ...SELF].filter((name) => name !== ''))
const missing = [...expected].filter((name) => !shipped.includes(name))
if (missing.length > 0) problems.push(`✗ files 白名单里有 ${missing.length} 项没打进制品：${missing.join(', ')}`)

const extra = shipped.filter((path) => !expected.has(path))
if (extra.length > 0) problems.push(`✗ 制品里多出 ${extra.length} 个未声明的文件：${extra.join(', ')}`)

if (problems.length > 0) {
  fail([...problems, '\n白名单与制品必须逐项一致：要么把多余文件删掉，要么把它加进 files 并说明用途。'])
  process.exit(1)
}

console.log(
  `OK：制品 ${shipped.length} 个文件（${(size / 1024).toFixed(1)} kB / 解包 ${(unpacked / 1024).toFixed(1)} kB），与 files 白名单逐项一致。`,
)
