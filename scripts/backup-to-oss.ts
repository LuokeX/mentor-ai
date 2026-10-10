/**
 * 教师赋能智能平台：数据库 + 代码备份到阿里云 OSS
 *
 * 用法（在仓库根目录执行）：
 *   pnpm backup:oss                # 完整备份：pg_dump + 源码包 + git bundle → 上传 OSS → 清理过期
 *   pnpm backup:oss --dry-run      # 只生成备份产物（不上传、不清理），用于本机自检
 *   pnpm backup:oss --check        # 只验证 OSS 配置与连通性，不产生任何备份
 *   pnpm backup:oss --list         # 列出 OSS 上已有的备份对象
 *
 * 配置：仓库根 `.env.backup`（模板见 `.env.backup.example`），缺项直接报错退出。
 * 阿里云 OSS 走 S3 兼容接口（虚拟主机风格 https://<bucket>.<region>.aliyuncs.com）。
 *
 * 数据库导出与 scripts/backup.sh 同源：docker compose exec 进 postgres 容器跑 pg_dump，
 * 结果流式写到宿主 backups/db（本项目 postgres 未挂载 backups 卷），因此容器未启动即失败。
 * 默认备份正式环境 compose（docker-compose.yml）；测试环境用 BACKUP_COMPOSE_FILE 覆盖。
 *
 * 产物（本地 backups/db、backups/code，默认保留 7 天）：
 *   - mentor-ai_<ts>.sql.gz          正式库 pg_dump（--clean --if-exists --no-owner）gzip
 *   - mentor-ai-code_<ts>.tar.gz     源码 + .env + infra/certs + 临时文件 + .git（排除大目录与 .env.backup）
 *   - mentor-ai_<ts>.git.bundle      git bundle --all（完整提交历史）
 *   - mentor-ai_<ts>.sha256          上面三个产物的校验和清单
 * 上传到 oss://<bucket>/<prefix>/（同一文件夹平铺），OSS 端默认保留 30 天。
 *
 * 注意：备份包含 .env（数据库口令、ENCRYPTION_KEY、DeepSeek/百炼 Key）与 infra/certs 私钥，
 *       OSS bucket 必须保持「私有」读写权限。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = path.join(ROOT, 'backups')
const DB_DIR = path.join(BACKUP_DIR, 'db')
const CODE_DIR = path.join(BACKUP_DIR, 'code')
const DAY_MS = 24 * 60 * 60 * 1000

/** tar 打包排除项：构建产物、依赖、本地备份与 OSS 凭据（凭据不进备份包，见文件头说明） */
const TAR_EXCLUDES = [
  './node_modules',
  './.nuxt',
  './.output',
  './.data',
  './.pnpm-store',
  './playwright-report',
  './test-results',
  './backups',
  './.git/index.lock',
  // OSS 凭据与历史 env 副本不进备份包：备份落到 OSS 后，读取备份的人不应同时拿到写入凭据。
  // 灾难恢复时到阿里云控制台重新生成 AccessKey 填入新机器即可。
  './.env.backup',
  './.env.bak*'
]

interface BackupConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  prefix: string
  localRetentionDays: number
  ossRetentionDays: number
  composeFile: string
  composeProject: string
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function warn(message: string): void {
  console.warn(`[${new Date().toISOString()}] ${message}`)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** requireOss=false（--dry-run 本地自检）时不强制 OSS 凭据，仅需数据库与打包配置 */
function loadBackupConfig(options: { requireOss: boolean }): BackupConfig {
  const envFile = path.join(ROOT, '.env.backup')
  if (existsSync(envFile)) loadEnvFile(envFile)

  const optional = (name: string, fallback = ''): string => process.env[name]?.trim() || fallback
  const required = (name: string): string => {
    const value = optional(name)
    if (!value) {
      if (options.requireOss) {
        throw new Error(`缺少配置 ${name}：请复制 .env.backup.example 为 .env.backup 并填写`)
      }
      return ''
    }
    return value
  }

  const endpoint = required('OSS_ENDPOINT').replace(/\/+$/, '')
  const bucket = required('OSS_BUCKET')
  if (endpoint && bucket && endpoint.includes(bucket)) {
    throw new Error('OSS_ENDPOINT 只写到 region 域名（如 https://oss-cn-hangzhou.aliyuncs.com），不要包含 bucket 名')
  }

  const intEnv = (name: string, fallback: number): number => {
    const raw = optional(name)
    if (!raw) return fallback
    const value = Number(raw)
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} 必须是正整数，当前值：${raw}`)
    }
    return value
  }

  return {
    endpoint,
    region: optional('OSS_REGION', 'oss-cn-hangzhou'),
    bucket,
    accessKeyId: required('OSS_ACCESS_KEY_ID'),
    accessKeySecret: required('OSS_ACCESS_KEY_SECRET'),
    prefix: optional('OSS_PREFIX', 'mentor-ai').replace(/^\/+|\/+$/g, ''),
    localRetentionDays: intEnv('BACKUP_LOCAL_RETENTION_DAYS', 7),
    ossRetentionDays: intEnv('BACKUP_OSS_RETENTION_DAYS', 30),
    composeFile: optional('BACKUP_COMPOSE_FILE', 'docker-compose.yml'),
    composeProject: optional('BACKUP_COMPOSE_PROJECT')
  }
}

function createOssClient(cfg: BackupConfig): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.accessKeySecret
    },
    // OSS 的 S3 兼容接口使用虚拟主机风格（https://<bucket>.<endpoint>/<key>）
    forcePathStyle: false,
    // OSS 不支持新版 SDK 默认开启的 CRC32 校验头，否则 PutObject 会被拒绝
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  })
}

/**
 * 正式库 pg_dump：docker compose exec 进 postgres 容器，stdout 流式落盘到备份文件。
 * 不采用 `pg_dump -f 容器内路径`：本项目 postgres 未挂载 backups 卷（与 scripts/backup.sh 一致）。
 */
function backupDatabase(cfg: BackupConfig, ts: string): string {
  const composeArgs = composeArgsOf(cfg)
  const rawFile = path.join(DB_DIR, `.mentor-ai-${ts}.sql.tmp`)
  const sqlFile = path.join(DB_DIR, `mentor-ai_${ts}.sql`)
  const gzFile = `${sqlFile}.gz`

  log(`[db] pg_dump：docker compose -f ${cfg.composeFile} exec postgres → backups/db/${path.basename(gzFile)}`)
  const fd = openSync(rawFile, 'w')
  try {
    execFileSync('docker', [
      'compose', ...composeArgs, 'exec', '-T', 'postgres',
      'sh', '-c', 'exec pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"'
    ], { cwd: ROOT, stdio: ['ignore', fd, 'inherit'] })
  } catch (error) {
    closeSync(fd)
    rmSync(rawFile, { force: true })
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`pg_dump 失败（确认 docker compose -f ${cfg.composeFile} 的 postgres 已启动）：${message}`)
  }
  closeSync(fd)

  if (!existsSync(rawFile) || statSync(rawFile).size === 0) {
    rmSync(rawFile, { force: true })
    throw new Error('pg_dump 未产出有效内容：请确认 postgres 容器正在运行且卷未损坏')
  }

  const gzFd = openSync(gzFile, 'w')
  try {
    execFileSync('gzip', ['-9', '-c', rawFile], { stdio: ['ignore', gzFd, 'inherit'] })
  } finally {
    closeSync(gzFd)
    rmSync(rawFile, { force: true })
  }

  if (statSync(gzFile).size === 0) {
    throw new Error(`gzip 未产出有效文件：${gzFile}`)
  }
  log(`[db] 完成：backups/db/${path.basename(gzFile)}（${formatBytes(statSync(gzFile).size)}）`)
  return gzFile
}

function composeArgsOf(cfg: BackupConfig): string[] {
  const args = ['-f', cfg.composeFile]
  if (cfg.composeProject) args.push('-p', cfg.composeProject)
  return args
}

/** 源码压缩包（含 .env、infra/certs 证书、临时文件与 .git 工作区），返回本地 .tar.gz 路径 */
function backupCodeTar(ts: string): string {
  const outFile = path.join(CODE_DIR, `mentor-ai-code_${ts}.tar.gz`)
  log('[code] 打包源码（含 .env、.git、infra/certs、临时文件；排除 node_modules/.nuxt/.output/.data/playwright-report/test-results/backups/.env.backup）')
  execFileSync('tar', [
    '--create', '--gzip',
    '--warning=no-file-changed',
    '--warning=no-file-removed',
    '--file', outFile,
    ...TAR_EXCLUDES.map((entry) => `--exclude=${entry}`),
    '--directory', ROOT,
    '.'
  ], { stdio: ['ignore', 'inherit', 'inherit'] })

  if (!existsSync(outFile) || statSync(outFile).size === 0) {
    throw new Error(`tar 未生成有效文件：${outFile}`)
  }
  log(`[code] 完成：backups/code/${path.basename(outFile)}（${formatBytes(statSync(outFile).size)}）`)
  return outFile
}

/** git bundle --all（完整提交历史，不含未提交改动），返回本地 .git.bundle 路径 */
function backupGitBundle(ts: string): string {
  const outFile = path.join(CODE_DIR, `mentor-ai_${ts}.git.bundle`)
  log('[code] git bundle --all（完整提交历史）')
  execFileSync('git', ['bundle', 'create', outFile, '--all'], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit']
  })

  if (!existsSync(outFile) || statSync(outFile).size === 0) {
    throw new Error(`git bundle 未生成有效文件：${outFile}`)
  }
  log(`[code] 完成：backups/code/${path.basename(outFile)}（${formatBytes(statSync(outFile).size)}）`)
  return outFile
}

/** 逐个文件计算 sha256，写出与产物同名的 .sha256 清单（恢复后可用 sha256sum -c 校验） */
async function writeChecksums(files: string[], outFile: string): Promise<string> {
  const lines: string[] = []
  for (const file of files) {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    for await (const chunk of stream) hash.update(chunk as Buffer)
    lines.push(`${hash.digest('hex')}  ${path.basename(file)}`)
  }
  writeFileSync(outFile, `${lines.join('\n')}\n`, { mode: 0o600 })
  log(`[sum] 校验和清单：backups/${path.basename(outFile)}`)
  return outFile
}

interface Artifact {
  file: string
  key: string
  contentType: string
}

async function uploadArtifacts(cfg: BackupConfig, s3: S3Client, artifacts: Artifact[]): Promise<void> {
  for (const item of artifacts) {
    const size = statSync(item.file).size
    log(`[oss] 上传 oss://${cfg.bucket}/${item.key}（${formatBytes(size)}）`)
    await s3.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: item.key,
      Body: createReadStream(item.file),
      ContentLength: size,
      ContentType: item.contentType
    }))
  }
}

/**
 * 清理本地超过保留期的备份文件（仅限 backups/db、backups/code 两个由本脚本管理的目录，
 * 以及 backups 根下本脚本产出的 mentor-ai_*.sha256；scripts/backup.sh 的产物不受影响）。
 */
function cleanLocal(cfg: BackupConfig): string[] {
  const cutoff = Date.now() - cfg.localRetentionDays * DAY_MS
  const removed: string[] = []
  const targets: { dir: string, filter?: (name: string) => boolean }[] = [
    { dir: DB_DIR },
    { dir: CODE_DIR },
    { dir: BACKUP_DIR, filter: (name) => /^mentor-ai_.*\.sha256$/.test(name) }
  ]

  for (const target of targets) {
    if (!existsSync(target.dir)) continue
    for (const name of readdirSync(target.dir)) {
      if (target.filter && !target.filter(name)) continue
      const file = path.join(target.dir, name)
      let stat
      try {
        stat = statSync(file)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.mtimeMs >= cutoff) continue
      rmSync(file, { force: true })
      removed.push(path.relative(ROOT, file))
    }
  }
  return removed
}

/**
 * 清理 OSS 上超过保留期的对象（只遍历 <prefix>/ 下，prefix 需专用于本备份）。
 * 单个对象删除失败（如 RAM 策略未授予 oss:DeleteObject）只记录、不抛出——
 * 备份本身已经上传成功，清理失败不应让整个任务失败。
 */
async function cleanOss(cfg: BackupConfig, s3: S3Client): Promise<{ removed: string[], failed: string[] }> {
  const cutoff = Date.now() - cfg.ossRetentionDays * DAY_MS
  const removed: string[] = []
  const failed: string[] = []
  let token: string | undefined

  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: cfg.bucket,
      Prefix: `${cfg.prefix}/`,
      ContinuationToken: token
    }))
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue
      if (object.LastModified && object.LastModified.getTime() >= cutoff) continue
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: object.Key }))
        removed.push(object.Key)
      } catch (error) {
        const name = error instanceof Error ? error.name : 'Unknown'
        failed.push(`${object.Key}（${name}）`)
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  return { removed, failed }
}

/** 列出 OSS 上 <prefix>/ 下的所有备份对象 */
async function listOss(cfg: BackupConfig, s3: S3Client): Promise<void> {
  const rows: { key: string, size: number, lastModified?: Date }[] = []
  let token: string | undefined

  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: cfg.bucket,
      Prefix: `${cfg.prefix}/`,
      ContinuationToken: token
    }))
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue
      rows.push({ key: object.Key, size: object.Size ?? 0, lastModified: object.LastModified })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  if (rows.length === 0) {
    log(`[oss] oss://${cfg.bucket}/${cfg.prefix}/ 下暂无对象`)
    return
  }

  rows.sort((a, b) => (a.lastModified?.getTime() ?? 0) - (b.lastModified?.getTime() ?? 0))
  let total = 0
  for (const row of rows) {
    total += row.size
    log(`[oss] ${row.key}  ${formatBytes(row.size)}  ${row.lastModified?.toISOString() ?? ''}`)
  }
  log(`[oss] 共 ${rows.length} 个对象，合计 ${formatBytes(total)}`)
}

function printUsage(): void {
  console.log(`教师赋能智能平台备份到阿里云 OSS

  pnpm backup:oss                完整备份（pg_dump + 源码包 + git bundle → OSS → 清理过期）
  pnpm backup:oss --list         列出 OSS 上已有的备份对象
  pnpm backup:oss --dry-run      只生成备份产物，不上传、不清理
  pnpm backup:oss --check        只验证 OSS 配置与连通性
`)
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  if (args.has('--help') || args.has('-h')) {
    printUsage()
    return
  }

  const dryRun = args.has('--dry-run')
  const checkOnly = args.has('--check')
  const listOnly = args.has('--list')
  const started = Date.now()

  const cfg = loadBackupConfig({ requireOss: !dryRun })
  log(`== 备份开始 ==（bucket=${cfg.bucket || '(dry-run 未配置)'} prefix=${cfg.prefix} 本地保留=${cfg.localRetentionDays}天 OSS保留=${cfg.ossRetentionDays}天）`)
  log(`[db] 备份目标：docker compose -f ${cfg.composeFile}${cfg.composeProject ? ` -p ${cfg.composeProject}` : ''} 的 postgres 服务`)
  const s3 = createOssClient(cfg)

  // 预检用 ListObjects：它是清理功能的必需权限，也能一并验证 bucket 名称与凭据是否匹配。
  // 不用 HeadBucket——最小权限策略常省略该权限，且 OSS 对 HEAD 请求的错误信息不友好。
  // （--dry-run 只做本地自检，不连 OSS）
  if (!dryRun) {
    try {
      await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: `${cfg.prefix}/`, MaxKeys: 1 }))
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'NotFound' || name === 'NoSuchBucket') {
        throw new Error(`OSS bucket 不存在：${cfg.bucket}（请先在阿里云控制台创建，并保持私有权限）`)
      }
      if (name === 'Forbidden' || name === 'AccessDenied' || name === 'SignatureDoesNotMatch' || name === 'Unknown' || name === 'UnknownError') {
        throw new Error(`OSS 鉴权失败（${name}）：检查 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET、RAM 策略是否包含 oss:ListObjects，以及 OSS_ENDPOINT 与 bucket 所在地域是否一致`)
      }
      throw error
    }
    log(`[oss] 连接正常：${cfg.endpoint} / ${cfg.bucket}`)
  }

  if (checkOnly) {
    log('== --check 通过：配置与连通性均正常 ==')
    return
  }

  if (listOnly) {
    await listOss(cfg, s3)
    return
  }

  mkdirSync(DB_DIR, { recursive: true })
  mkdirSync(CODE_DIR, { recursive: true })

  const ts = timestamp()
  const dbFile = backupDatabase(cfg, ts)
  const tarFile = backupCodeTar(ts)
  const bundleFile = backupGitBundle(ts)
  const sumFile = await writeChecksums(
    [dbFile, tarFile, bundleFile],
    path.join(BACKUP_DIR, `mentor-ai_${ts}.sha256`)
  )

  const artifacts: Artifact[] = [
    { file: dbFile, key: `${cfg.prefix}/mentor-ai_${ts}.sql.gz`, contentType: 'application/gzip' },
    { file: tarFile, key: `${cfg.prefix}/mentor-ai-code_${ts}.tar.gz`, contentType: 'application/gzip' },
    { file: bundleFile, key: `${cfg.prefix}/mentor-ai_${ts}.git.bundle`, contentType: 'application/octet-stream' },
    { file: sumFile, key: `${cfg.prefix}/mentor-ai_${ts}.sha256`, contentType: 'text/plain' }
  ]

  if (dryRun) {
    log('== --dry-run：已生成备份产物，跳过上传与清理 ==')
  } else {
    await uploadArtifacts(cfg, s3, artifacts)
    log(`[oss] 上传完成：${artifacts.length} 个对象`)

    const removedLocal = cleanLocal(cfg)
    log(`[clean] 本地清理 ${removedLocal.length} 个过期文件${removedLocal.length ? `：${removedLocal.join('、')}` : ''}`)

    try {
      const { removed, failed } = await cleanOss(cfg, s3)
      log(`[clean] OSS 清理 ${removed.length} 个过期对象${removed.length ? `：${removed.join('、')}` : ''}`)
      if (failed.length > 0) {
        warn(`[clean] ${failed.length} 个过期对象删除失败：${failed.join('、')}`)
        warn('[clean] RAM 策略可能缺少 oss:DeleteObject；备份不受影响，但旧备份会持续累积，可补权限或到阿里云控制台手动删除')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warn(`[clean] OSS 过期清理未完成（本次备份已上传成功，不影响恢复）：${message}`)
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  log(`== 备份结束 == 用时 ${seconds}s`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[${new Date().toISOString()}] [失败] ${message}`)
  process.exitCode = 1
})
