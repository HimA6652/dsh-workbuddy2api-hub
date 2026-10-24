#!/usr/bin/env node
// 发布前自查：扫描项目里有没有凭据泄漏迹象。
// 用法：node scripts/check-secrets.mjs
//
// 只扫源码/配置/文档（.mjs/.js/.json/.yml/.md），跳过 .git、node_modules、tmp、coverage。
// 命中任何一条就以退出码 1 结束，方便挂到 pre-commit 钩子或 CI 上。
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tmp', 'coverage', 'docs']);
const SCAN_EXT = /\.(mjs|js|cjs|json|ya?ml|md)$/;

// 任意一行出现这条标记就整行豁免（写清楚理由，别滥用）。
const ALLOW_MARK = 'secret-ok';

// 明显的占位/测试值：命中也不算泄漏。
const PLACEHOLDER = /^(?:admin|wrong|bad|mock|fake|dummy|test|sample|example|your|placeholder|changeme|secret|password)/i;

const RULES = [
  { name: '私钥', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'GitHub Token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'OpenAI 风格 Key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS Key', re: /\bAKIA[0-9A-Z]{12,}/ },
  { name: 'Slack Token', re: /\bxox[bpoa]r?-[A-Za-z0-9-]{10,}/ },
  { name: '本机绝对路径', re: /[A-Za-z]:\\\\(?:Users|ProgramData)\\\\/ },
  { name: 'Unix 家目录路径', re: /\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
  {
    name: '硬编码密码赋值',
    re: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"]{8,})['"]/i,
    // 值是中文界面文案（如 pwd: '面板密码（pwd）'）或以占位词开头 → 不算泄漏
    skip: (value) =>
      // 值是中文界面文案、含空格/括号（如 pwd: 'Panel password (pwd)'）、或以占位词开头 → 不算泄漏
      /[\u3400-\u9fff]/.test(value) || /[\s()]/.test(value) || PLACEHOLDER.test(value),
  },
];

/** 逐行扫描单个文件。 */
async function scanFile(file) {
  const text = await readFile(file, 'utf8');
  const hits = [];
  text.split('\n').forEach((line, index) => {
    if (line.includes(ALLOW_MARK)) return;
    for (const rule of RULES) {
      const match = line.match(rule.re);
      if (!match) continue;
      if (rule.skip && rule.skip(match[1] ?? '', match)) continue;
      hits.push({
        file: relative(ROOT, file).split('\\').join('/'),
        line: index + 1,
        rule: rule.name,
        text: line.trim().slice(0, 120),
      });
    }
  });
  return hits;
}

/** 递归收集需要扫描的文件。 */
async function collect(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collect(join(dir, entry.name), out);
      continue;
    }
    if (SCAN_EXT.test(entry.name)) out.push(join(dir, entry.name));
  }
  return out;
}

const files = await collect(ROOT);
const results = await Promise.all(files.map(scanFile));
const hits = results.flat();

if (hits.length === 0) {
  console.log(`OK：扫描 ${files.length} 个文件，未发现疑似凭据。`);
} else {
  console.log(`发现 ${hits.length} 处疑似凭据：\n`);
  for (const hit of hits) {
    console.log(`${hit.file}:${hit.line}  [${hit.rule}]`);
    console.log(`    ${hit.text}`);
  }
  console.log('\n确认是假数据就在本文件上方 RULES 里豁免，或改成占位符；确认是真凭据则先作废再改代码。');
  process.exitCode = 1;
}
