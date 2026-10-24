#!/usr/bin/env node
/**
 * 把本仓库挂进本地 DSH profile（桌面端默认 profile：`~/.dsh/profiles/desktop`）。
 *
 * 做的事情只有三件，全部可逆（`--uninstall` 原样退回去）：
 *   1. 在 profile 的 `package.json` 里加一条 `file:` 依赖与一条 bundle 声明；
 *   2. 在 profile 的 `node_modules/` 下建一个指向本仓库的链接；
 *   3. 打印下一步（重启 DSH 才会加载）。
 *
 * 不动 `cordis.patch.yml`：插件的挂载点由本包的 `cordis.patch.yml` 自己 insert。
 *
 * 用法：
 *   node scripts/install-local.mjs                # 安装
 *   node scripts/install-local.mjs --dry-run      # 只看会改什么
 *   node scripts/install-local.mjs --uninstall    # 卸载
 *   node scripts/install-local.mjs --profile D:\path\to\profile
 */

import { existsSync } from 'node:fs'
import { readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')

/**
 * 解析命令行参数。
 * @param argv - `process.argv.slice(2)`。
 * @returns 选项对象。
 */
function parseArgs(argv) {
  const options = { uninstall: false, dryRun: false, profile: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--uninstall') options.uninstall = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--profile') {
      options.profile = argv[index + 1] ?? ''
      index += 1
    } else if (arg === '--help' || arg === '-h') options.help = true
  }
  return options
}

/**
 * 找到要装的 profile 目录。
 * @param explicit - `--profile` 传入的值。
 * @returns 绝对路径。
 */
function profileDirOf(explicit) {
  if (typeof explicit === 'string' && explicit !== '') return resolve(explicit)
  const name = process.env.DSH_PROFILE !== undefined && process.env.DSH_PROFILE !== '' ? process.env.DSH_PROFILE : 'desktop'
  return join(homedir(), '.dsh', 'profiles', name)
}

/**
 * 读 profile 的 package.json。
 * @param file - 路径。
 * @returns 解析后的对象。
 */
async function readProfile(file) {
  const text = await readFile(file, 'utf8')
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} 不是一个 JSON 对象，先手动看一眼`)
  }
  return parsed
}

/** 打印一行「会做什么」。 */
function plan(action, detail) {
  console.log(`  ${action.padEnd(8, ' ')} ${detail}`)
}

/** 主流程。 */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('用法：node scripts/install-local.mjs [--dry-run] [--uninstall] [--profile <dir>]')
    return 0
  }

  const manifest = JSON.parse(await readFile(join(PROJECT, 'package.json'), 'utf8'))
  const packageName = manifest.name
  const profileDir = profileDirOf(options.profile)
  const packageFile = join(profileDir, 'package.json')
  const linkPath = join(profileDir, 'node_modules', packageName)
  const stateFile = join(profileDir, 'workbuddy2api-hub.json')

  if (!existsSync(packageFile)) {
    console.error(`找不到 profile：${packageFile}`)
    console.error('DSH 桌面端默认在 ~/.dsh/profiles/desktop；用 --profile 指定其它 profile。')
    return 2
  }

  const profile = await readProfile(packageFile)
  profile.dependencies = profile.dependencies ?? {}
  profile.dsh = profile.dsh ?? {}
  profile.dsh.profile = profile.dsh.profile ?? {}
  const bundles = Array.isArray(profile.dsh.profile.bundles) ? profile.dsh.profile.bundles : []

  console.log(options.uninstall ? '卸载 dsh-workbuddy2api-hub' : '安装 dsh-workbuddy2api-hub')
  console.log(`  profile  ${profileDir}`)
  console.log(`  插件     ${PROJECT}`)

  const changes = []
  if (options.uninstall) {
    if (packageName in profile.dependencies) {
      delete profile.dependencies[packageName]
      changes.push(['删除依赖', packageName])
    }
    const nextBundles = bundles.filter((entry) => entry !== packageName)
    if (nextBundles.length !== bundles.length) {
      profile.dsh.profile.bundles = nextBundles
      changes.push(['移除 bundle', packageName])
    }
    if (existsSync(linkPath)) changes.push(['删除链接', linkPath])
    if (existsSync(stateFile)) changes.push(['保留状态', `${stateFile}（要一起删就手动 rm）`])
  } else {
    const spec = `file:${PROJECT.replaceAll('\\', '/')}`
    if (profile.dependencies[packageName] !== spec) {
      profile.dependencies[packageName] = spec
      changes.push(['写入依赖', `${packageName} → ${spec}`])
    }
    if (!bundles.includes(packageName)) {
      profile.dsh.profile.bundles = [...bundles, packageName]
      changes.push(['追加 bundle', packageName])
    }
    changes.push(['建立链接', `${linkPath} → ${PROJECT}`])
  }

  if (changes.length === 0) console.log('  已经是目标状态，无需改动。')
  for (const [action, detail] of changes) plan(action, detail)

  if (options.dryRun) {
    console.log('--dry-run：没有写入任何文件。')
    return 0
  }

  // 先备份，再改 package.json：profile 起不来是最坏结果，得像改生产配置那样小心。
  if (changes.length > 0) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
    const backup = `${packageFile}.bak-workbuddy2api-hub-${stamp}`
    await writeFile(backup, await readFile(packageFile))
    console.log(`  备份     ${backup}`)
    await writeFile(packageFile, `${JSON.stringify(profile, null, 2)}\n`)
  }

  if (options.uninstall) {
    await rm(linkPath, { recursive: true, force: true })
  } else {
    await mkdir(dirname(linkPath), { recursive: true })
    await rm(linkPath, { recursive: true, force: true })
    // Windows 上没有管理员权限建目录符号链接会失败，junction 不需要额外权限。
    await symlink(PROJECT, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  }

  console.log('')
  if (options.uninstall) {
    console.log('已卸载。重启 DSH 之后设置页里的这一块就没了。')
  } else {
    console.log('装好了。接下来：')
    console.log('  1. 重启 DSH 桌面端（插件只在启动时加载）')
    console.log('  2. 打开 设置 → workbuddy2api-hub，确认地址是 http://127.0.0.1:8788、密码是 admin')
    console.log('  3. 点「测试连接」，再点「立即同步」')
    console.log('  4. 模型会出现在 设置 → 模型 里，provider 名为 workbuddy2api-hub')
    console.log('')
    console.log('前置条件：本地 workbuddy2api-hub 服务已经跑起来（默认 http://127.0.0.1:8788）。')
  }
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(`安装脚本出错：${error?.message ?? error}`)
    process.exitCode = 1
  })
