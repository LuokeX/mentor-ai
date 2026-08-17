// 从硬编码 shared/assessments.ts 导入题库数据到 content_packages 表
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 连接串不内置：优先环境变量，其次仓库根 .env；缺失时明确报错退出
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const envContent = readFileSync(resolve(__dirname, '../.env'), 'utf-8')
    const match = envContent.match(/^DATABASE_URL\s*=\s*(.+)$/m)
    if (match) return match[1].trim()
  } catch { /* .env 缺失时走下方报错 */ }
  throw new Error('DATABASE_URL 未配置：请复制 .env.example 为 .env 或在环境变量中设置 DATABASE_URL')
}

const pg = new Pool({ connectionString: loadDatabaseUrl() })

// 写入人不内置固定管理员 ID：优先 SEED_ADMIN_ID，否则取最早的 platform_admin
async function resolveActorId() {
  if (process.env.SEED_ADMIN_ID) return process.env.SEED_ADMIN_ID
  const { rows } = await pg.query(`SELECT id FROM users WHERE role = 'platform_admin' ORDER BY created_at ASC LIMIT 1`)
  const id = rows[0]?.id
  if (!id) throw new Error('未找到 platform_admin 账号，请先运行 pnpm db:seed 或创建平台管理员')
  return id
}

// ====== 题库数据（从 shared/assessments.ts 提取） ======
const fivePoint = [
  { label: '几乎没有', value: 1 }, { label: '很少', value: 2 }, { label: '有时', value: 3 },
  { label: '经常', value: 4 }, { label: '几乎每天', value: 5 }
]
const agree = [
  { label: '完全不符合', value: 1 }, { label: '比较不符合', value: 2 }, { label: '一般', value: 3 },
  { label: '比较符合', value: 4 }, { label: '非常符合', value: 5 }
]

const assessments = [
  {
    code: 'assessment-self_growth', name: '班主任状态五问', version: '2.0.0', type: 'assessment',
    payload: {
      module: 'self_growth', title: '班主任状态五问',
      description: '回顾最近一周的真实状态，系统将依据确定性规则给出六色提示。', estimatedMinutes: 3,
      questions: [
        { id: 'q1', dimension: '情绪状态', text: '这一周，我有多少时间感到身心疲惫、难以恢复？', options: fivePoint },
        { id: 'q2', dimension: '角色边界', text: '这一周，我有多少次感到"什么都是我的责任"？', options: fivePoint },
        { id: 'q3', dimension: '意义感知', text: '这一周，有多少次我觉得"当班主任是值得的"？', reverse: true, options: fivePoint },
        { id: 'q4', dimension: '效能信心', text: '遇到让我头疼的学生或家长问题时，我对自己能处理好多有信心？', reverse: true, options: fivePoint },
        { id: 'q5', dimension: '同伴支持', text: '这一周，我有多少时间感到工作中的困难没有人可以分担？', options: fivePoint }
      ]
    }
  },
  {
    code: 'assessment-class_system', name: '班级五系统速评', version: '2.0.0', type: 'assessment',
    payload: {
      module: 'class_system', title: '班级五系统速评',
      description: '每个系统三道题，定位当前最需要建设的班级子系统。', estimatedMinutes: 5,
      questions: [
        ['goal1', '目标', '学生清楚本班共同目标以及为什么要实现它。'],
        ['goal2', '目标', '班级目标已转化为本学期可观察的里程碑。'],
        ['goal3', '目标', '日常活动和评价与班级目标保持一致。'],
        ['org1', '组织', '班干部岗位职责清楚且能稳定运转。'],
        ['org2', '组织', '班级事务能够由学生参与分工，而非全部由教师承担。'],
        ['org3', '组织', '班级日常关键节点有明确的执行流程。'],
        ['activity1', '活动', '班级活动能够回应学生真实需要。'],
        ['activity2', '活动', '活动结束后会进行简短复盘并形成改进。'],
        ['activity3', '活动', '多数学生都有参与和承担责任的机会。'],
        ['environment1', '环境', '班级空间和信息布置能够支持秩序与学习。'],
        ['environment2', '环境', '班级规则由师生共同理解而非只贴在墙上。'],
        ['environment3', '环境', '出现混乱时能够快速恢复稳定节奏。'],
        ['relation1', '关系', '学生普遍感到被尊重、被听见。'],
        ['relation2', '关系', '学生冲突能够被及时处理并修复关系。'],
        ['relation3', '关系', '班级中存在稳定的互助和同伴支持。']
      ].map(([id, dimension, text]) => ({ id, dimension, text, options: agree }))
    }
  },
  {
    code: 'assessment-home_school', name: '家校沟通双维与容器速查', version: '2.0.0', type: 'assessment',
    payload: {
      module: 'home_school', title: '家校沟通双维与容器速查',
      description: '判断家长配合度、沟通态度和当前关系容器。', estimatedMinutes: 5,
      questions: [
        ['coop1', '配合度', '家长能够及时回应学校的重要沟通。'],
        ['coop2', '配合度', '家长愿意共同讨论并执行已经达成的行动。'],
        ['coop3', '配合度', '出现分歧后，家长仍愿意继续保持沟通。'],
        ['att1', '态度', '家长表达不满时仍能保持基本尊重。'],
        ['att2', '态度', '家长能够区分事实、推测和情绪。'],
        ['att3', '态度', '家长没有出现威胁、公开抹黑或恶意维权行为。'],
        ['container1', '容器', '目前的关系可以承受一次坦诚而具体的讨论。'],
        ['container2', '容器', '双方能够在情绪出现时暂停并回到问题解决。'],
        ['container3', '容器', '过去的积极沟通经验仍能成为当前关系资源。']
      ].map(([id, dimension, text]) => ({ id, dimension, text, options: agree }))
    }
  },
  {
    code: 'assessment-student_case', name: '学生个体问题快速筛查', version: '2.0.0', type: 'assessment',
    payload: {
      module: 'student_case', title: '学生个体问题快速筛查',
      description: '从学业、行为、情绪、社交和适应五类表现进行教育场景筛查，不构成医学诊断。', estimatedMinutes: 6,
      questions: [
        ['academic1', '学业', '学习表现近期出现持续且明显的下降。'],
        ['academic2', '学业', '完成作业、听课或考试受到明显影响。'],
        ['academic3', '学业', '已有常规支持措施没有带来改善。'],
        ['behavior1', '行为', '冲动、对抗或规则破坏行为频繁出现。'],
        ['behavior2', '行为', '行为已经明显影响本人或同伴的学习。'],
        ['behavior3', '行为', '行为发生的场景和诱因较难预测。'],
        ['emotion1', '情绪', '持续出现低落、焦虑、易怒或明显退缩。'],
        ['emotion2', '情绪', '情绪变化已经影响日常功能。'],
        ['emotion3', '情绪', '学生很难表达或调节当前感受。'],
        ['social1', '社交', '与同伴的冲突、排斥或孤立反复发生。'],
        ['social2', '社交', '学生缺少稳定的同伴支持。'],
        ['social3', '社交', '常规关系修复方式效果有限。'],
        ['adapt1', '适应', '在转班、家庭变化或重要事件后持续难以适应。'],
        ['adapt2', '适应', '出现明显躯体不适、拒学或回避。'],
        ['adapt3', '适应', '问题持续四周以上且没有改善趋势。']
      ].map(([id, dimension, text]) => ({ id, dimension, text, options: agree }))
    }
  }
]

async function seed() {
  const actorId = await resolveActorId()
  // 先查已有 code，避免重复插入
  const existing = await pg.query(`SELECT code FROM content_packages WHERE type = 'assessment'`)
  const existingCodes = new Set(existing.rows.map(r => r.code))

  let inserted = 0
  for (const a of assessments) {
    if (existingCodes.has(a.code)) {
      console.log(`SKIP (exists): ${a.code}`)
      continue
    }
    await pg.query(
      `INSERT INTO content_packages (code, name, version, type, status, payload, created_by, published_at)
       VALUES ($1, $2, $3, $4, 'published', $5, $6, NOW())`,
      [a.code, a.name, a.version, a.type, JSON.stringify(a.payload), actorId]
    )
    console.log(`INSERTED: ${a.code} — ${a.name}`)
    inserted++
  }
  console.log(`\nDone. Inserted ${inserted} assessment packages.`)
  await pg.end()
}

seed().catch(e => { console.error(e); process.exit(1) })