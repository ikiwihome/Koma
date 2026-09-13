#!/usr/bin/env node
/**
 * @koma/plugin-sdk 自动发布脚本
 * 用法: node scripts/publish.js [patch|minor|major]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const versionType = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(versionType)) {
  console.error('❌ 版本类型必须是: patch | minor | major');
  process.exit(1);
}

function run(cmd, options = {}) {
  console.log(`\n> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..'), ...options });
}

async function publish() {
  try {
    console.log(`\n📦 准备发布 ${pkg.name}...`);
    console.log(`当前版本: ${pkg.version}`);

    // 1. 检查 npm 登录状态
    try {
      execSync('npm whoami', { stdio: 'pipe' });
    } catch {
      console.error('❌ 请先登录 npm: npm login');
      process.exit(1);
    }

    // 2. 检查工作区是否干净
    try {
      const status = execSync('git status --porcelain', { encoding: 'utf-8', cwd: path.join(__dirname, '..', '..', '..') });
      if (status.trim()) {
        console.warn('⚠️  工作区有未提交的更改，继续发布...');
      }
    } catch {
      // 非 git 仓库，忽略
    }

    // 3. 清理并构建
    console.log('\n🔨 构建中...');
    run('npm run clean');
    run('npm run build');

    // 4. 版本升级
    console.log(`\n📝 升级版本 (${versionType})...`);
    run(`npm version ${versionType} --no-git-tag-version`);

    // 读取新版本
    const newPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    console.log(`新版本: ${newPkg.version}`);

    // 5. 发布到 npm
    console.log('\n🚀 发布到 npm...');
    run('npm publish --access public');

    console.log(`\n✅ ${pkg.name}@${newPkg.version} 发布成功!`);

    // 6. 提交版本变更
    try {
      run(`git add package.json`, { cwd: path.join(__dirname, '..') });
      run(`git commit -m "chore(plugin-sdk): release v${newPkg.version}"`, { cwd: path.join(__dirname, '..', '..', '..') });
      console.log('📌 版本变更已提交到 git');
    } catch {
      console.log('⚠️  Git 提交跳过');
    }

  } catch (error) {
    console.error('\n❌ 发布失败:', error.message);
    process.exit(1);
  }
}

publish();
