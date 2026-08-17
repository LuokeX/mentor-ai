/**
 * 生成单文件 HTML 演示文稿：内嵌全部截图（base64），可打印/转 Word
 * 用法：node scripts/build-demo-html.mjs
 * 输出：docs/系统演示文稿.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(root, 'docs', 'demo-assets')
const OUT_FILE = join(root, 'docs', '系统演示文稿.html')

const img = (name) => {
  const buf = readFileSync(join(OUT_DIR, name))
  return `data:image/png;base64,${buf.toString('base64')}`
}

// 环节定义：title / kicker / steps(操作) / points(讲解) / shots([{file, caption}])
const sections = [
  {
    kicker: '环节 1 · 开场定位（约 2 分钟）',
    title: '一套系统，四个角色，五个模块',
    steps: [
      '一句话定位：这不是通用聊天工具，而是“确定性规则 + AI 辅助”的教师赋能闭环。',
      '四个角色：教师（使用者）、心理专员（转介处置）、学校管理员（校内治理）、平台管理员（内容运营）。',
      '五个模块：自我成长、班级系统、家校共育、学生个案、学习问题。',
      '核心逻辑：AI 只负责理解、澄清与推荐；评估分级、危机判定由规则引擎完成，方案结论不被 AI 改写。'
    ],
    points: [
      '强调“AI 不诊断、不替代人工”：系统给的是可行动的参考，结论由教师确认。',
      '演示全程按“一个教师的完整工作闭环”讲故事，管理侧是闭环的支撑。'
    ],
    shots: []
  },
  {
    kicker: '环节 2 · 登录（约 1 分钟）',
    title: '统一入口与安全登录',
    steps: [
      '打开系统地址（本地演示为 http://localhost:3300），进入登录页。',
      '演示账号：13900001001 / Mentor@2026（李老师）。',
      '登录页同时展示：隐私告知说明（管理员只能在事由授权下查看敏感信息）。'
    ],
    points: [
      '账号由学校管理员邀请开通（72 小时一次性激活链接），密码使用 Argon2id 存储。',
      '心理专员额外绑定动态验证码（TOTP），管理员可重置 MFA。'
    ],
    shots: [{ file: '01-login.png', caption: '登录页：统一入口 + 隐私告知' }]
  },
  {
    kicker: '环节 3 · 教师首页（约 2 分钟）',
    title: '首页三段式：欢迎 → AI 分诊 → 今日待办',
    steps: [
      '首页上半部分：AI 分诊助手与“安全规则正在运行”提示。',
      '下半部分：今日待办（未读通知、今日动作、待复盘）与五个模块快捷入口。',
      '模块卡片显示状态：继续未完成评估 / 最近评估时间 / 待执行动作数。'
    ],
    points: [
      '“持续使用闭环”是本系统区别于普通助手的核心：评估产生方案，方案产生待办，待办驱动执行。',
      '今日待办里的“逾期”红标是执行追踪的直接体现。'
    ],
    shots: [{ file: '02-teacher-home.png', caption: '教师首页：AI 分诊助手 + 今日待办 + 五模块入口' }]
  },
  {
    kicker: '环节 4 · AI 澄清分诊（约 5 分钟，重点）',
    title: '像对同事一样说出问题，AI 多轮澄清后推荐模块',
    steps: [
      '点击快捷提问示例：“小明上课经常走神，作业拖拉到半夜，数学计算经常看错符号，考前紧张到手抖……”',
      '助手不直接给结论，而是先追问澄清（第 1 轮、第 2 轮），教师选择或补充描述。',
      '澄清结束进入总结：展示模块倾向评分、推荐理由与建议动作。',
      '点击“进入XX模块评估”按钮，带上下文进入模块页。'
    ],
    points: [
      '多轮澄清状态机：最多 3 轮，超限自动总结；全程可自由描述。',
      '数据治理亮点：支持选择“咨询学生/班级/家长”上下文、开启“不带档案咨询”、发送前预览脱敏内容。',
      'AI 不可用时自动降级为本地规则（页面显示“本地降级模式”徽标），功能不中断。'
    ],
    shots: [
      { file: '03-ai-clarification.png', caption: 'AI 多轮澄清：追问第 1 轮 + 选项' },
      { file: '04-ai-summary.png', caption: '分析结果：模块倾向 + 建议动作' }
    ]
  },
  {
    kicker: '环节 5 · 量表评估（约 4 分钟）',
    title: '动态问卷 → 确定性计分分级',
    steps: [
      '进入模块页：评估前说明、模块资源版本（校本/平台）、多量表选择器（AI 推荐 + 教师可改选）。',
      '开始完整评估：逐题作答，进度条实时显示，答案自动保存草稿（浏览器 + 服务端双备份，可跨会话恢复）。',
      '提交后由规则引擎计分分级、归因分析、匹配工具。'
    ],
    points: [
      '量表库、归因规则库、工具库由平台统一运营（Excel 模板导入发布），教师端只是消费方。',
      '“不构成医学或心理诊断”是明确的合规边界。'
    ],
    shots: [{ file: '05-module-assessment.png', caption: '评估作答：确定性问卷 + 进度 + 草稿自动保存' }]
  },
  {
    kicker: '环节 6 · 方案生成与确认（约 3 分钟）',
    title: '评估完成 → 3 天行动方案 + 7 天复盘节点',
    steps: [
      '提交后生成“评估完成 · 行动方案已创建”，展示第一个最小行动及截止时间。',
      '进入方案页：归因结论、行动项列表、7 天复盘节点。',
      '教师点击“接受执行”，方案正式进入执行闭环。'
    ],
    points: [
      '方案结论由确定性规则生成，AI 只做语义辅助，不允许 AI 自动改写结论。',
      '行动项进入首页“今日待办”，到期动作自动标红提醒。'
    ],
    shots: [
      { file: '06-plan-created.png', caption: '评估完成：行动方案已创建 + 第一个最小行动' },
      { file: '07-plan-confirm.png', caption: '方案确认：接受执行后进入执行闭环' }
    ]
  },
  {
    kicker: '环节 7 · 执行与复盘（约 3 分钟）',
    title: '执行闭环：动作完成 → 7 天复盘 → 质量反馈',
    steps: [
      '在方案执行区点击行动项，填写执行结果，标记完成。',
      '到达复盘节点后填写进展说明、自评效果，保存复盘记录。',
      '全程支持提交质量反馈（AI 回答帮助度）。'
    ],
    points: [
      '稳定 UUID 方案动作：执行记录与方案绑定，跨会话不丢失。',
      '复盘数据回流到信息中心档案，形成教师自己的成长轨迹。'
    ],
    shots: [{ file: '08-plan-execution.png', caption: '方案执行：标记完成 + 复盘记录' }]
  },
  {
    kicker: '环节 8 · 信息中心（约 3 分钟）',
    title: '学生 / 家长 / 沟通记录 / 评估方案，一处可查',
    steps: [
      '“我负责的学生”列表：搜索、查看学生档案。',
      '学生详情：个人档案（字段级加密）、沟通记录、评估与方案历史。',
      '教师可导出自己的完整 JSON 数据（管理员无此权限）。'
    ],
    points: [
      '姓名、电话等敏感字段 AES-256-GCM 应用层加密，数据库不可直接读明文。',
      '学生案例演示用真实种子数据：王浩然（转班适应）、陈一诺（作业拖延）等。'
    ],
    shots: [
      { file: '09-information-students.png', caption: '信息中心：我负责的学生列表' },
      { file: '10-student-detail.png', caption: '学生详情：档案 + 沟通 + 评估历史' }
    ]
  },
  {
    kicker: '环节 9 · 危机熔断（约 4 分钟，安全亮点）',
    title: '红线信号触发：常规建议立即暂停，转介单事务生成',
    steps: [
      '新对话输入：“班上有个女生最近经常哭，成绩突然大幅下滑，被同学孤立，说自己什么都做不好，不想活了。”',
      '页面弹出红色熔断卡片：“常规建议已暂停”+ 事件编号 + 处置引导。',
      '同一事务内生成：风险事件、心理转介、短信通知（Outbox）、审计记录。'
    ],
    points: [
      '危机判定由本地确定性规则先行，不依赖 AI 是否在线。',
      '危机短信只含事件号和登录提示，不泄露任何细节。',
      '后续 SLA：5 分钟确认、15 分钟升级，时间线不可篡改。'
    ],
    shots: [{ file: '11-crisis-fuse.png', caption: '危机熔断：常规建议暂停 + 转介引导' }]
  },
  {
    kicker: '环节 10 · 心理专员工作台（约 3 分钟）',
    title: '最小必要转介空间 + SLA 倒计时',
    steps: [
      '心理专员登录（本环境演示账号 13900001003）。',
      '工作台只显示分配给本人的转介工单：状态、优先级、SLA 倒计时。',
      '处置记录与关闭原因，时间线不可修改。'
    ],
    points: [
      '刚才教师端触发的危机已实时出现在专员工作台，演示“事件闭环”。',
      '强制 TOTP（演示环境登录页展示验证码交互）。'
    ],
    shots: [{ file: '12-specialist-workbench.png', caption: '心理专员工作台：SLA 倒计时与处置' }]
  },
  {
    kicker: '环节 11 · 学校管理员（约 5 分钟）',
    title: '校内治理：聚合指标 + 账号 + 敏感访问授权',
    steps: [
      '学校管理后台首页：学校聚合指标（周活跃、AI 有帮助率等，无教师正文）。',
      '统一管理框架：班级管理（搜索、归档/恢复、跨教师流转、并发冲突保护）。',
      '敏感档案访问：管理员申请查看 → 填写事由 → 15 分钟目标级授权 → 带水印查看 → 打印留痕。'
    ],
    points: [
      '管理员看的是聚合指标而不是教师隐私；敏感访问必须事由授权并全程审计。',
      '演示“无批量导出、列表 50 条上限、水印与打印控制”等防扩散设计。'
    ],
    shots: [
      { file: '13-school-admin-home.png', caption: '学校管理后台：聚合指标面板' },
      { file: '14-school-admin-classes.png', caption: '班级管理：统一管理框架' }
    ]
  },
  {
    kicker: '环节 12 · 平台管理员三库运营（约 5 分钟）',
    title: '量表 / 归因 / 工具三库：模板导入 → 预检 → 发布',
    steps: [
      '平台管理后台：学校管理（创建、启停、内容包发布）、三库运营台。',
      '三库运营台：评估库 / 归因库 / 工具库 × 五模块，标准 Excel 模板导入。',
      '导入向导：上传 → 预检报告 → 校验 → 发布/停用/回滚，全局与校级双范围。'
    ],
    points: [
      '内容运营保证全校评估口径一致；发布/回滚有版本与审计。',
      '知识库文档支持向量检索（嵌入模型可用时）。'
    ],
    shots: [
      { file: '15-platform-admin-home.png', caption: '平台管理后台总览' },
      { file: '16-platform-resources.png', caption: '三库运营台：导入、校验与发布' },
      { file: '17-platform-schools.png', caption: '学校管理：创建与启停' }
    ]
  },
  {
    kicker: '环节 13 · 收尾（约 3 分钟）',
    title: '安全基线、试点节奏与边界',
    steps: [
      '安全基线一句话：字段级加密、Argon2id 密码、TOTP、敏感接口 no-store、水印、无批量导出、权限矩阵。',
      '试点节奏：种子 5 人 → 小批 20 人 → 全量 30–100 人，每批有量化验收门槛。',
      '明确边界：当前为校内封闭试用 RC 基线，不含医疗/心理诊断结论；深度量表和真实题库需业务方提供。'
    ],
    points: [
      '把边界主动讲清楚，比被提问时被动解释更有说服力。',
      '建议演示最后留 10 分钟答疑，重点准备“数据安全”“试点节奏”“后续计划”三个问题。'
    ],
    shots: []
  }
]

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const renderSection = (s, idx) => `
<section class="step">
  <div class="step-head">
    <span class="step-no">${String(idx + 1).padStart(2, '0')}</span>
    <div>
      <p class="kicker">${esc(s.kicker)}</p>
      <h2>${esc(s.title)}</h2>
    </div>
  </div>
  <div class="step-body">
    <div class="col">
      <h3>操作步骤</h3>
      <ol>${s.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      <h3 class="mt">讲解要点</h3>
      <ul class="points">${s.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>
    ${s.shots.length ? `<div class="col shots">${s.shots.map(sh => `
      <figure><img src="${img(sh.file)}" alt="${esc(sh.caption)}"><figcaption>${esc(sh.caption)}</figcaption></figure>`).join('')}
    </div>` : ''}
  </div>
</section>`

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>教师赋能智能平台 · 业务演示文稿</title>
<style>
  :root { --green: #047857; --ink: #1e293b; --muted: #64748b; --line: #e2e8f0; --bg: #f8fafc; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; color: var(--ink); background: #fff; line-height: 1.7; }
  .cover { background: linear-gradient(135deg, #0f3d33 0%, #14532d 55%, #166534 100%); color: #fff; padding: 90px 48px 70px; }
  .cover .tag { display: inline-block; border: 1px solid rgba(255,255,255,.35); border-radius: 999px; padding: 4px 14px; font-size: 13px; letter-spacing: .2em; }
  .cover h1 { font-size: 42px; margin: 26px 0 10px; line-height: 1.3; }
  .cover p.sub { font-size: 17px; opacity: .85; margin: 0 0 34px; }
  .cover .meta { display: flex; flex-wrap: wrap; gap: 12px 34px; font-size: 14px; opacity: .9; }
  .toc { max-width: 1080px; margin: 40px auto 10px; padding: 0 24px; }
  .toc h2 { font-size: 20px; }
  .toc ol { columns: 2; gap: 40px; font-size: 14px; color: var(--muted); }
  .toc li { margin: 4px 0; break-inside: avoid; }
  .container { max-width: 1080px; margin: 0 auto; padding: 0 24px 80px; }
  .step { border: 1px solid var(--line); border-radius: 14px; margin-top: 34px; overflow: hidden; page-break-inside: avoid; }
  .step-head { display: flex; gap: 16px; align-items: flex-start; background: #f1f5f9; padding: 20px 26px; border-bottom: 1px solid var(--line); }
  .step-no { font-size: 30px; font-weight: 800; color: var(--green); line-height: 1; }
  .kicker { margin: 0; font-size: 13px; color: var(--green); font-weight: 600; letter-spacing: .05em; }
  .step-head h2 { margin: 4px 0 0; font-size: 22px; }
  .step-body { display: grid; grid-template-columns: 1fr; gap: 0; }
  .col { padding: 22px 26px; }
  .col h3 { font-size: 14px; letter-spacing: .1em; color: var(--muted); text-transform: uppercase; margin: 0 0 10px; }
  .col h3.mt { margin-top: 22px; }
  .col ol, .col ul { margin: 0; padding-left: 20px; font-size: 15px; }
  .col li { margin: 6px 0; }
  .points li::marker { color: var(--green); }
  .shots { background: var(--bg); border-top: 1px dashed var(--line); }
  .shots figure { margin: 0 0 20px; }
  .shots figure:last-child { margin-bottom: 0; }
  .shots img { width: 100%; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 2px 10px rgba(15,23,42,.08); }
  .shots figcaption { font-size: 13px; color: var(--muted); margin-top: 6px; text-align: center; }
  .closing { margin-top: 44px; padding: 26px; border-radius: 14px; background: #f0fdf4; border: 1px solid #bbf7d0; }
  .closing h2 { margin: 0 0 10px; font-size: 18px; color: #14532d; }
  .closing p { margin: 6px 0; font-size: 15px; }
  footer { text-align: center; color: #94a3b8; font-size: 13px; padding: 30px 0 50px; }
  @media (min-width: 900px) {
    .step-body { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); }
    .col { border-right: 1px solid var(--line); }
    .shots { border-top: none; border-left: 1px dashed var(--line); }
  }
  @media print {
    body { background: #fff; }
    .cover { page-break-after: always; }
    .step { page-break-inside: avoid; }
    .step-body { display: block; }
    .col { border: none; border-bottom: 1px solid var(--line); }
    .shots { border: none; border-top: 1px dashed var(--line); }
    .shots img { max-height: 420px; object-fit: contain; }
    .toc ol { columns: 1; }
  }
</style>
</head>
<body>

<div class="cover">
  <span class="tag">教师赋能智能平台 · 业务演示</span>
  <h1>理解教师的语言，<br>守住每一次安全边界。</h1>
  <p class="sub">四角色 × 五模块 × 完整业务闭环 —— 从 AI 澄清分诊，到方案执行复盘，再到危机熔断与三库运营</p>
  <div class="meta">
    <span>演示时长：约 50 分钟 + 10 分钟答疑</span>
    <span>演示对象：业务 / 校方</span>
    <span>环境：校内封闭试用 RC 基线</span>
    <span>日期：2026 年 8 月</span>
  </div>
</div>

<div class="toc">
  <h2>演示流程总览</h2>
  <ol>
    <li>开场定位：一套系统，四个角色，五个模块</li>
    <li>登录：统一入口与安全登录</li>
    <li>教师首页：欢迎 → AI 分诊 → 今日待办</li>
    <li>AI 澄清分诊：多轮澄清 + 模块推荐（重点）</li>
    <li>量表评估：动态问卷 → 确定性计分分级</li>
    <li>方案生成与确认：3 天行动 + 7 天复盘</li>
    <li>执行与复盘：执行闭环 + 质量反馈</li>
    <li>信息中心：学生 / 家长 / 沟通记录</li>
    <li>危机熔断：红线信号单事务转介（安全亮点）</li>
    <li>心理专员工作台：最小转介包 + SLA</li>
    <li>学校管理员：聚合指标 + 敏感访问授权</li>
    <li>平台管理员：三库模板导入与发布</li>
    <li>收尾：安全基线、试点节奏与边界</li>
  </ol>
</div>

<div class="container">
  ${sections.map(renderSection).join('')}

  <div class="closing">
    <h2>演示前检查清单</h2>
    <p>① 服务就绪：访问 http://localhost:3300 健康检查通过，数据库已 seed（六力学校、5 名学生及沟通记录）。</p>
    <p>② 演示账号：13900001001 / 13900001003 / 13900001004 / 13900001005，密码统一 Mentor@2026。</p>
    <p>③ 顺序铁律：先做“危机场景”再登心理专员，转介工单才能实时出现。</p>
    <p>④ 若未配置 DeepSeek Key，首页显示“本地降级模式”——正好讲解 AI 故障降级能力。</p>
    <p>⑤ 危机演示会产生真实转介工单（短信为 mock 仅写日志），演示库可随时 pnpm db:seed 重建。</p>
  </div>
</div>

<footer>教师赋能智能平台 · 业务演示文稿 · 截图均为真实系统运行画面</footer>

</body>
</html>`

writeFileSync(OUT_FILE, html)
console.log('written:', OUT_FILE, (html.length / 1024 / 1024).toFixed(1) + ' MB')