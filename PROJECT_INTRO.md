# 项目介绍：课堂反馈助手（class-feedback-v1.7）

## 一、项目概述

这是一个**纯前端**的课堂反馈生成工具，面向家教/培训老师。老师通过语音录音记录课堂内容，系统调用 DeepSeek AI 自动生成结构化的学生反馈报告。所有数据存储在浏览器 localStorage 中，无需后端服务器。

**核心流程**：添加学生 → 选择科目 → 语音录音/手动输入 → AI 生成反馈 → 查看/编辑/复制反馈

## 二、技术栈

- 纯 HTML/CSS/JS，无框架，无构建工具
- Web Speech API（`SpeechRecognition`）实现语音转文字
- DeepSeek API 生成反馈
- localStorage 持久化
- PWA（Service Worker 离线缓存）
- 部署：Cloudflare Pages（`wrangler pages deploy`）或 GitHub Pages

## 三、文件结构

```
index.html          — 入口页面，所有 JS 通过 <script> 标签加载，带 ?v= 版本号
sw.js               — Service Worker，CACHE_NAME 格式 classroom-feedback-v1.7.XX
manifest.json       — PWA 清单
_headers            — Cloudflare Pages 安全头
css/style.css       — 全部样式，使用 CSS 变量支持亮/暗/暖三套主题
js/storage.js       — localStorage 封装层
js/models.js        — DataStore 类，学生/科目/反馈的 CRUD
js/recorder.js      — Recorder 类，语音识别核心（最复杂的文件，约1800行）
js/ai.js            — AI 反馈生成，调用 DeepSeek API
js/ui.js            — UI 工具（Toast、确认框、复制等）
js/app.js           — 主应用路由和页面切换
js/components/bottomSheet.js — 底部弹出面板组件
js/pages/           — 各页面：studentsPage、studentFormPage、subjectSelectPage、recordPage、historyPage、settingsPage
```

## 四、关键设计模式（必须了解）

1. **录音重启机制**：Chrome 的 `SpeechRecognition` 每次识别约20-30秒后自动结束，`recorder.js` 通过 `onend → _scheduleRestart → recognition.start()` 循环实现长时间连续录音。`shouldRestart` 标志控制是否自动重启。

2. **陈旧实例守卫**：每次创建新 `recognition` 实例时，所有事件回调（onstart/onresult/onend/onerror）第一行都检查 `this.recognition !== recognition`，忽略已被替换的旧实例事件，防止级联重启。

3. **健康检查**：每10秒检查 `lastResultTime`，超时则 abort/重建实例。健康检查重启不计入 `restartCount` 配额（`_isHealthCheckRestart` 标志）。

4. **onstart 超时检测**：`start()` 后5秒未触发 `onstart` 则主动重建（`_setStartTimeout`），防止静默失败。

5. **增量遍历**：`onresult` 使用 `event.resultIndex` 只遍历新增结果，避免长录音时 O(n) 全量扫描。

6. **自动commit**：`results.length > 50` 时一次性将 `finalTranscript` 合并到 `accumulatedText`，用 `_autoCommitted` 标志防止重复触发。

7. **小组模式姓名匹配**：统一使用"精确匹配优先 + `endsWith` 模糊匹配兜底"，因为 AI 生成反馈时可能省略姓氏（如"张小明"→"小明"）。涉及 `recordPage.js`、`app.js`（3处）、`ai.js` 共5处。

8. **模板变量**：反馈模板支持 `{学生姓名}` `{科目}` `{日期}` 三个变量，`_replaceTemplateVars` 方法替换。

9. **删除撤销**：删除学生/反馈/模板时，先 `softDelete` 保存快照，再显示5秒橙色 Toast 带"撤销"按钮，通过 `restoreStudent`/`restoreQuickReply` 恢复。

## 五、硬性约束（绝对不能违反）

- **部署 ZIP 必须用正斜杠 `/` 作为路径分隔符**，反斜杠 `\` 会导致 Cloudflare Pages 上 CSS/JS 文件 404
- **暗色主题禁止硬编码白色/浅色**，所有颜色必须用 CSS 变量（`var(--bg)`、`var(--surface)` 等）
- **Toast 必须按类型着色**：成功绿、错误红、警告橙、信息灰
- **删除操作必须有5秒撤销 Toast**
- **学生头像用姓名生成唯一渐变色**
- **PWA 缓存策略**：导航请求网络优先，静态资源缓存优先+后台更新，API 请求不缓存
- **ID 生成统一格式**：`前缀_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`，防冲突

## 六、已知坑点

1. **`index.html` 版本号**：每次修改 JS/CSS 文件后，必须在 `index.html` 的 `<script src="xxx?v=XX">` 和 `<link href="xxx?v=XX">` 中更新版本号，否则浏览器加载旧缓存。同时更新 `sw.js` 的 `CACHE_NAME`。

2. **`event.resultIndex` 兼容性**：Safari/Chrome/Edge 均支持，但 fallback 到 0 安全（最差全量遍历）。

3. **`commitTranscript()` 时机**：只在 `onend`（非手动停止时）和 `pause()/stop()` 中调用。`onresult` 中不调用（会导致文本重复）。

4. **`_manualStop` 标志**：`pause()/stop()` 设置 `_manualStop = true`，`onresult` 检查到后直接 return，避免浏览器在 stop 后仍触发的 onresult 导致文本重复。

5. **`parseFeedback`/`parseSummary`**：只匹配已知模块名（`课堂内容`、`课堂表现` 等），并 `trim()` 去除首尾空白。不匹配未知模块名。

6. **`_unifyCommonModules`**：用正则转义 + negative lookbehind `(?<![\\u4e00-\\u9fff])` 避免误匹配（如"课堂表现"不应匹配"课堂表现力"中的"课堂表现"）。

7. **`showConfirmInput`**：删除确认需输入指定文字，`trim()` 后比较，防止前后空格导致验证失败。

8. **导入导出**：`settingsPage.js` 的导入导出直接序列化/反序列化 localStorage 数据，新增字段（如学生 `grade`）自动兼容，旧数据缺失字段返回 `undefined`，所有逻辑用 `?.` 和 `filter(Boolean)` 保护。

9. **deploy.js**：部署脚本自动将 node 目录加入 PATH，并创建 node-gyp stub 文件绕过 npm 检查。部署命令：`node deploy.js prod`。

10. **小组模式复制反馈标题**：只包含当前学生姓名，不含空格。

## 七、年级功能（最新添加）

- 学生对象新增可选 `grade` 属性（一年级~高三）
- `addStudent(name, isTrial, grade)` — grade 默认空串
- `searchStudents(query, grade)` — grade 为空时不过滤
- `studentFormPage.js` — 年级下拉选择框
- `studentsPage.js` — 年级标签显示 + 年级筛选下拉
- 旧数据兼容：无 `grade` 字段时 `student.grade` 返回 `undefined`，不影响任何逻辑

## 八、当前版本号

```
style.css v36, storage.js v34, models.js v36, recorder.js v44,
ai.js v35, ui.js v36, bottomSheet.js v32, studentsPage.js v33,
studentFormPage.js v33, subjectSelectPage.js v32, recordPage.js v37,
historyPage.js v36, settingsPage.js v35, app.js v36
sw.js CACHE_NAME = classroom-feedback-v1.7.35
```
