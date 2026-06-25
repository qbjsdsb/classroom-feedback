# 项目介绍：课堂反馈助手（class-feedback-v1.9）

## 一、项目概述

这是一个**纯前端**的课堂反馈生成工具，面向家教/培训老师。老师通过语音录音记录课堂内容，系统调用 DeepSeek AI 自动生成结构化的学生反馈报告。所有数据存储在浏览器 IndexedDB 中（含 localStorage 自动迁移与降级），无需后端服务器。

**核心流程**：添加学生 → 选择科目 → 语音录音/手动输入 → AI 生成反馈 → 查看/编辑/复制反馈

## 二、技术栈

- 纯 HTML/CSS/JS，无框架，无构建工具
- Web Speech API（`SpeechRecognition`）实现语音转文字（浏览器内置）
- 本地 Whisper-tiny（ONNX，Transformers.js）作为可选的离线语音识别方案（`vendor/whisper-tiny/`）
- DeepSeek API 生成反馈（默认 baseUrl `https://api.deepseek.com`，可在设置中自定义）
- IndexedDB 持久化（`db.js` 封装，localStorage 自动迁移；IndexedDB 不可用时降级到 localStorage）
- PWA（Service Worker 离线缓存 + manifest.json）
- 4 套主题：亮色（默认）/ 暗色 `dark` / 暖色 `warm` / 护眼绿 `green`
- 部署：Cloudflare Pages（`wrangler pages deploy`）或 GitHub Pages

## 三、文件结构

```
index.html          — 入口页面，所有 JS 通过 <script> 标签加载，带 ?v= 版本号
sw.js               — Service Worker，CACHE_NAME 格式 classroom-feedback-v1.9.XX
manifest.json       — PWA 清单
_headers            — Cloudflare Pages 安全头
tutorial.html       — 使用教程页面（独立入口，被 sw.js 缓存）
icon-192.png        — PWA 图标（192x192）
icon-512.png        — PWA 图标（512x512）
icon-maskable-192.png  — 可遮罩图标（192x192，自适应安装图标）
icon-maskable-512.png  — 可遮罩图标（512x512）
icon.svg            — 矢量图标源
css/style.css       — 全部样式，使用 CSS 变量支持 4 套主题（[data-theme="dark|warm|green"]）
js/db.js            — DB 类，IndexedDB 封装层（localStorage 自动迁移、降级、孤儿清理）
js/storage.js       — Storage 类，数据管理（IndexedDB + 内存缓存），配置/样式/主题读写
js/models.js        — DataStore 类，学生/科目/反馈/模板的 CRUD（含 softDelete + 回收站持久化）
js/recorder.js      — Recorder 类，语音识别核心（最复杂的文件，约2200行）
js/ai.js            — AI 反馈生成，调用 DeepSeek API（含超长文本智能压缩）
js/ui.js            — UI 工具（Toast、确认框、loading 遮罩、复制等）
js/app.js           — 主应用路由、页面切换、小组模式、公共模块统一
js/components/bottomSheet.js — 底部弹出面板组件
js/pages/           — 各页面：studentsPage、studentFormPage、subjectSelectPage、recordPage、historyPage、settingsPage
vendor/transformers.min.js  — Transformers.js 库（Whisper 推理）
vendor/whisper-tiny/        — Whisper-tiny ONNX 模型与 tokenizer
```

## 四、关键设计模式（必须了解）

1. **录音重启机制**：Chrome 的 `SpeechRecognition` 每次识别约20-30秒后自动结束，`recorder.js` 通过 `onend → _scheduleRestart → recognition.start()` 循环实现长时间连续录音。`shouldRestart` 标志控制是否自动重启。`maxRestarts = 720`（4小时课程上限），瞬时错误（no-speech/network）不消耗配额。

2. **陈旧实例守卫**：每次创建新 `recognition` 实例时，所有事件回调（onstart/onresult/onend/onerror）第一行都检查 `this.recognition !== recognition`，忽略已被替换的旧实例事件，防止级联重启。

3. **健康检查**：每10秒检查 `lastResultTime`，超时则 abort/重建实例。健康检查强制重建通过 `shouldRestart = false` 跳过 onend 重启分支，因此**不消耗 `restartCount` 配额**（旧文档中 `_isHealthCheckRestart` 标志已删除，那是误导性死代码）。

4. **onstart 超时检测**：`start()` 后5秒未触发 `onstart` 则主动重建（`_setStartTimeout`），防止静默失败。所有运行时重建路径（onstart/健康检查/可见性/`_scheduleRestart`）统一调用 `_setStartTimeout` 作为安全网。

5. **增量遍历**：`onresult` 使用 `event.resultIndex` 只遍历新增结果，避免长录音时 O(n) 全量扫描。

6. **自动commit**：`results.length > 50` 时一次性将 `finalTranscript` 合并到 `accumulatedText`，用 `_autoCommitted` 标志防止重复触发。

7. **去重锚点统一管理**：6 条创建新 recognition 实例的路径（onstart / 健康检查 / 可见性重建 / onstart 超时 / `_scheduleRestart` 重建 / start·stop·resume 会话切换）统一通过两个方法重置去重锚点：
   - `_resetDedupAnchors()` — 会话级完全重置（start/stop/resume 调用）
   - `_resetDedupForRebuild()` — 运行时重建：保留 `_lastCommittedInterim` 并派生 `_dedupPending`，让新实例首个 final 能与上次提交的 interim 做跨实例去重（onstart / 健康检查 / 可见性 / `_scheduleRestart` 调用）
   - 三个锚点：`_lastProcessedResultIdx`（已处理 final 索引）、`_lastCommittedInterim`（已提交 interim 文本）、`_dedupPending`（新实例首个 final 是否需去重）

8. **用户意图标志 `_userIntendsToRecord`**：与 `isRecording` 区分——`isRecording` 在重启循环期间为 false，但 `_userIntendsToRecord` 保持 true。所有用户交互入口（`toggle`/`pause`/5 个长按事件 `_onTouchEnd`/`_onTouchMove`/`_onTouchCancel`/`_onMouseUp`/`_onMouseLeave`）统一用 `_userIntendsToRecord` 判断，确保重启循环期间用户仍能暂停/取消。

9. **小组模式姓名匹配**：统一使用"精确匹配优先 + 单向 `endsWith` 模糊匹配兜底"（`s.name.endsWith(aiName) && aiName.length >= 2`），**不再使用反向 `aiName.endsWith(s.name)` 分支**（已删除，会导致短名误匹配长名）。涉及 `recordPage.js`、`app.js`（`_showGroupStudent` + `_persistFeedbackEdit`）、`ai.js` 共5处。

10. **小组模式反馈ID映射**：`app._groupFeedbackIds` 记录每位学生当前反馈 ID，`_showGroupStudent` 优先查此映射，避免回退到 `history[0]` 拿到错误反馈。

11. **模板变量**：反馈模板支持 `{学生姓名}` `{科目}` `{日期}` 三个变量，`_replaceTemplateVars` 方法替换。

12. **软删除 + 回收站持久化**：删除学生/反馈/快捷回复时，先 `softDelete*` 保存快照，再显示5秒橙色 Toast 带"撤销"按钮。同时将快照写入 IndexedDB keyvalue（key=`trash_<type>_<id>`，60秒 TTL），防止用户在5秒内刷新页面丢失撤销机会。`store.init()` 时自动调用 `_restoreFromTrash()` 恢复未过期的回收站数据。删除科目时联动清理科目专属模板（`deleteSubjectTemplate`），避免孤儿模板。

13. **`start()` 入口资源清理**：`start()` 开头统一清理 4 个定时器（`_restartTimeout`/`_forcedRebuildTimeout`/`_startTimeout`/`_connectingHintTimeout`）并调用 `_stopHealthCheck()`，防止重入时旧定时器叠加触发。

14. **`importAudioFile` 资源兜底**：`audioContext`/`audioUrl`/`audioCtx2`/`audio` 提升到 try 外用 `let` 声明，`finally` 块关闭两个 AudioContext 并 `revokeObjectURL`，避免异常路径下资源泄漏。

15. **IndexedDB 迁移保护**：`db.js` 迁移失败时不写 `cf_migrated=true`，改用 `cf_migration_attempts` 计数器，3 次失败后停止重试并保留 localStorage 数据供用户导出；`_checkReMigration` 仅在 `cf_pending_import='true'` 标志下执行覆盖迁移，孤儿清理检查 `attempts >= 3` 避免误删保留的数据。

16. **正则 lookbehind 兼容性**：`_unifyCommonModules` 使用 lookbehind `(?<![\u4e00-\u9fff])` 避免误匹配，但旧 Safari <16.4 不支持。运行时检测 `supportsLookbehind`，所有 5 个正则用 `${lb}` 前缀动态拼接，per-pattern try-catch 降级。

## 五、硬性约束（绝对不能违反）

- **部署 ZIP 必须用正斜杠 `/` 作为路径分隔符**，反斜杠 `\` 会导致 Cloudflare Pages 上 CSS/JS 文件 404
- **暗色主题禁止硬编码白色/浅色**，所有颜色必须用 CSS 变量（`var(--bg)`、`var(--surface)` 等）
- **Toast 必须按类型着色**：成功绿、错误红、警告橙、信息灰
- **删除操作必须有5秒撤销 Toast**（且回收站持久化 60 秒，刷新可恢复）
- **学生头像用姓名生成唯一渐变色**
- **PWA 缓存策略**：导航请求网络优先（`ignoreSearch:true`），静态资源缓存优先+后台更新（`?v=` 参与 `caches.match` 匹配，确保版本切换），API 请求不缓存
- **版本号同步**：每次修改 JS/CSS 后，同步更新 `index.html` 的 `?v=` 和 `sw.js` 的 `CACHE_NAME`，否则浏览器加载旧缓存
- **ID 生成统一格式**：`前缀_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`，防冲突

## 六、已知坑点

1. **`index.html` 版本号 + sw.js CACHE_NAME 必须同步**：每次修改 JS/CSS 文件后，必须在 `index.html` 的 `<script src="xxx?v=XX">` 和 `<link href="xxx?v=XX">` 中更新版本号，并同步更新 `sw.js` 的 `CACHE_NAME`（格式 `classroom-feedback-v1.9.XX`）。静态资源 `caches.match` 不再使用 `ignoreSearch`，让 `?v=` 参与匹配，确保版本切换时旧缓存失效。

2. **`event.resultIndex` 兼容性**：Safari/Chrome/Edge 均支持，但 fallback 到 0 安全（最差全量遍历）。

3. **`commitTranscript()` 时机**：只在 `onend`（非手动停止时）和 `pause()/stop()` 中调用。`onresult` 中不调用（会导致文本重复）。`commitTranscript` 会更新 `_lastCommittedInterim`，作为跨实例去重的锚点。

4. **`_manualStop` 标志**：`pause()/stop()` 设置 `_manualStop = true`，`onresult` 检查到后直接 return，避免浏览器在 stop 后仍触发的 onresult 导致文本重复。

5. **`parseFeedback`/`parseSummary`**：只匹配已知模块名（`课堂内容`、`课堂表现` 等），并 `trim()` 去除首尾空白。不匹配未知模块名。

6. **`_unifyCommonModules` lookbehind 兼容**：用正则转义 + negative lookbehind `(?<![\\u4e00-\\u9fff])` 避免误匹配（如"课堂表现"不应匹配"课堂表现力"中的"课堂表现"）。旧 Safari <16.4 不支持 lookbehind，运行时检测后降级（见设计模式 16）。

7. **`showConfirmInput`**：删除确认需输入指定文字，`trim()` 后比较，防止前后空格导致验证失败。

8. **导入导出**：`settingsPage.js` 的导入会设置 `cf_pending_import='true'` 标志再 reload，触发 `db.js` 执行覆盖迁移；导出直接序列化 IndexedDB/localStorage 数据。新增字段（如学生 `grade`）自动兼容，旧数据缺失字段返回 `undefined`，所有逻辑用 `?.` 和 `filter(Boolean)` 保护。

9. **清空数据**：`Storage.reset()` 为 `async`，使用 `Promise.allSettled` 等待所有 IndexedDB store 清空完成后再 reload，避免事务未提交导致数据残留。

10. **`deploy.js`**：部署脚本自动将 node 目录加入 PATH，并创建 node-gyp stub 文件绕过 npm 检查。部署命令：`node deploy.js prod`。

11. **小组模式复制反馈标题**：只包含当前学生姓名，不含空格。

12. **`showLoading` 复用遮罩**：`showLoading` 复用已存在的 overlay 而非新建，重置 opacity/transition 并取消 pending `_hideTimer`，避免 300ms 淡出窗口期内遮罩不可见。

13. **`bottomSheet.show()` 事件监听**：绑定新 `_keyHandler` 前先移除旧的，避免重复绑定导致 ESC/Enter 触发多次。

14. **`getStyle` 容错**：`getStyle` 用 try-catch 包裹，解析失败时返回深拷贝的 `DEFAULT_STYLE`，避免脏数据导致整站样式崩溃。

15. **空 `.catch` 禁止**：所有 `.catch(e => {})` 已改为 `.catch(e => console.warn(...))`，避免静默吞错导致问题难定位。

## 七、年级功能

- 学生对象新增可选 `grade` 属性（一年级~高三）
- `addStudent(name, isTrial, grade)` — grade 默认空串
- `searchStudents(query, grade)` — grade 为空时不过滤
- `studentFormPage.js` — 年级下拉选择框
- `studentsPage.js` — 年级标签显示 + 年级筛选下拉
- 旧数据兼容：无 `grade` 字段时 `student.grade` 返回 `undefined`，不影响任何逻辑

## 八、当前版本号（v1.9.54）

```
css/style.css v39
js/db.js v4
js/storage.js v39
js/models.js v39
js/recorder.js v52
js/ai.js v38
js/ui.js v41
js/components/bottomSheet.js v34
js/pages/studentsPage.js v35
js/pages/studentFormPage.js v35
js/pages/subjectSelectPage.js v33
js/pages/recordPage.js v42
js/pages/historyPage.js v37
js/pages/settingsPage.js v40
js/app.js v42
sw.js CACHE_NAME = classroom-feedback-v1.9.54
```

## 九、修复批次历史（截至 v1.9.54）

- **v1.9.50（批次1 P0 数据安全）**：db.js 迁移失败保护、回收站持久化、空 catch 修复、科目删除联动清理模板、姓名匹配去反向分支、小组反馈ID映射、loading 复用、bottomSheet 事件去重。
- **v1.9.52（批次2 P1 发布阻塞）**：sw.js 静态资源 `?v=` 参与匹配、补齐 4 个 PNG 图标缓存、`_unifyCommonModules` lookbehind 兼容旧 Safari、`getStyle` 容错。
- **v1.9.54（批次3 P1 recorder 稳定性）**：删除 `_isHealthCheckRestart` 死代码、`start()` 入口资源清理、长按事件统一用 `_userIntendsToRecord`、去重锚点统一管理（`_resetDedupAnchors`/`_resetDedupForRebuild`）、`importAudioFile` 资源 finally 兜底。
