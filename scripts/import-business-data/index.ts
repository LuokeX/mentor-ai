#!/usr/bin/env node
// 导入脚本主入口
// 用法: node scripts/import-business-data/index.ts [--dry-run] [--publish] [--replace] [--strict-quality] [--require-complete] [--include-legacy-raw] [--module=xxx] [--type=xxx]
import { importAll } from './importers/index'

async function main() {
  const args = process.argv.slice(2)

  const dryRun = args.includes('--dry-run')
  const publish = args.includes('--publish')
  const replace = args.includes('--replace')
  const strictQuality = args.includes('--strict-quality')
  const requireComplete = args.includes('--require-complete')
  const includeLegacyRaw = args.includes('--include-legacy-raw')
  const moduleArg = args.find(a => a.startsWith('--module='))
  const typeArg = args.find(a => a.startsWith('--type='))
  const versionArg = args.find(a => a.startsWith('--version='))

  const module = moduleArg ? moduleArg.split('=')[1] : undefined
  const type = typeArg ? typeArg.split('=')[1] : undefined
  const version = versionArg ? versionArg.split('=')[1] : undefined

  if (module) {
    const validModules = ['self_growth', 'class_system', 'home_school', 'student_case', 'learning_problem']
    if (!validModules.includes(module)) {
      console.error(`Invalid module: ${module}. Valid: ${validModules.join(', ')}`)
      process.exit(1)
    }
  }
  if (type) {
    const validTypes = ['tool', 'assessment', 'attribution', 'keyword_route', 'output_template']
    if (!validTypes.includes(type)) {
      console.error(`Invalid type: ${type}. Valid: ${validTypes.join(', ')}`)
      process.exit(1)
    }
  }

  console.log('=== 业务数据导入工具 ===')
  console.log(`Options: dryRun=${dryRun}, publish=${publish}, replace=${replace}, strictQuality=${strictQuality}, requireComplete=${requireComplete}, includeLegacyRaw=${includeLegacyRaw}, module=${module || 'all'}, type=${type || 'all'}, version=${version || '(payload/1.0.0)'}`)
  console.log()

  const results = await importAll({ dryRun, publish, replace, strictQuality, requireComplete, includeLegacyRaw, module, type, version })
  if (results.some(result => !result.success)) process.exit(1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
