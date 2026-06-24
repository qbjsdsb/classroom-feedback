// ai.js - AI 反馈生成（DeepSeek API）
// 支持超长文本（4万字+）课堂内容

class AI {
    // DeepSeek API 上下文限制
    // V4-Flash 支持 1M 上下文，取保守值 256K 确保四万字课程无压缩
    static MAX_CONTEXT_TOKENS = 256000;
    static MAX_OUTPUT_TOKENS = 16384;   // 最大输出长度（V4-Flash 支持 16K 输出）
    static TOKENS_PER_CHAR = 1.5;       // 中文字符估算
    static SYSTEM_PROMPT_TOKENS = 100;  // 系统提示词估算
    static FRAMEWORK_TOKENS = 1200;     // prompt框架（含模块说明）估算

    /**
     * 带重试的 fetch 请求（仅对网络错误自动重试1次）
     * 不对 API Key 错误、4xx 等业务错误重试
     */
    static async _fetchWithRetry(url, options, retries = 1) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, options);
                return response;
            } catch (err) {
                // 网络错误（断网、DNS失败、CORS等），且还有重试次数
                if (attempt < retries && (err instanceof TypeError)) {
                    continue;
                }
                throw err;
            }
        }
    }

    static async generateFeedback(transcript, modules, studentName, subjectName, style, subjectId) {
        const apiKey = Storage.getApiKey();
        if (!apiKey) {
            throw new Error('请先设置 API Key');
        }

        const toneDesc = this.getToneInstructions(style);
        const emojiReq = this.getEmojiInstructions(style);
        const formatReq = this.getFormatInstructions(style, modules);
        const strictReq = style.strictInput !== false
            ? '严格基于我提供的课堂内容生成反馈，不要编造任何未提及的内容。如果某个模块没有足够的内容，如实简要说明即可。'
            : '';
        const conciseReq = '反馈要简洁精炼，适当总结，避免冗长和重复。每个模块控制在要求的字数范围内，不要过度展开。';
        const parentReq = style.includeParentHelp
            ? '在课后作业模块中，可以适当建议家长协助监督。'
            : '不要在反馈中提及"请家长协助"、"请家长监督"、"请家长提醒"等类似内容。';
        const customReq = style.customPrompt ? `\n\n## 用户自定义要求\n${style.customPrompt}` : '';

        // 获取科目专属模板
        let subjectTemplateReq = '';
        if (subjectId) {
            const template = store.getSubjectTemplate(subjectId);
            if (template && template.prompt) {
                subjectTemplateReq = `\n\n## 科目专属要求（${subjectName}）\n${template.prompt}`;
            }
        }

        // 按模块生成字数限制说明
        const moduleLengthInstructions = modules.map(m => {
            const len = Storage.getModuleLength(m, style);
            return `- ${m}：${len.min}到${len.max}字`;
        }).join('\n');

        const moduleInstructions = modules.map(m => {
            const desc = this.getModuleDescription(m);
            return `- ${m}：${desc}`;
        }).join('\n');

        // === 超长文本处理 ===
        // 计算可用内容token预算
        const availableTokens = this.MAX_CONTEXT_TOKENS
            - this.SYSTEM_PROMPT_TOKENS
            - this.FRAMEWORK_TOKENS
            - this.MAX_OUTPUT_TOKENS;
        const maxContentChars = Math.floor(availableTokens / this.TOKENS_PER_CHAR);

        // 如果文本超长，进行智能压缩
        let processedTranscript = transcript;
        let compressionNote = '';
        if (transcript.length > maxContentChars) {
            const result = await this._compressTranscript(transcript, maxContentChars, apiKey);
            processedTranscript = result.compressed;
            compressionNote = result.note;
        }

        // 构建姓名处理指令
        const nameInstruction = style.nameShorten !== false
            ? `学生姓名处理规则（必须严格遵守）：
- 如果学生姓名是三个字（如"王小明"），在反馈中只使用最后两个字（"小明"）
- 如果学生姓名是两个字（如"梓含"），直接使用全名（"梓含"）
- 绝对禁止将名字拆分成单个字重复（如"梓含"不能叫"含含"、"梓梓"）
- 绝对禁止创造不存在的昵称（如"王小明"不能叫"明明"）
- 在反馈中称呼学生时，使用处理后的名字，不要使用"该生"、"这位同学"等代称`
            : `学生姓名处理规则：直接使用学生全名"${studentName}"，不要截取、不要创造昵称。`;

        const prompt = `你是一位专业的教育培训老师，需要根据课堂内容生成结构化的课堂反馈。

## 学生信息
- 学生姓名：${studentName}
- 科目：${subjectName}
${compressionNote}

## 课堂内容
${processedTranscript}

## 生成要求
1. ${toneDesc}
2. ${emojiReq}
3. 各模块字数要求：\n${moduleLengthInstructions}
4. ${strictReq}
5. ${conciseReq}
6. ${parentReq}
7. ${nameInstruction}
8. ${formatReq}
9. ${this.getLengthGuidance(transcript)}
${subjectTemplateReq}
${customReq}

## 需要包含的模块
${moduleInstructions}

## 输出格式
请按以下格式输出，每个模块用【模块名】作为标题：

【课堂内容】
（内容）

【课堂表现】
（内容）

...以此类推`;

        const baseUrl = Storage.getApiBaseUrl() || 'https://api.deepseek.com';
        try {
            const response = await this._fetchWithRetry(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-v4-flash',
                    messages: [
                        { role: 'system', content: '你是一位经验丰富的教育培训老师，擅长撰写专业、有针对性的课堂反馈。你严格遵守姓名处理规则，不会创造不存在的昵称。' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: this.MAX_OUTPUT_TOKENS
                })
            });

            if (!response.ok) {
                let errorMsg = `API 请求失败: ${response.status}`;
                try {
                    const error = await response.json();
                    if (error.error?.message) errorMsg = error.error.message;
                } catch {
                    // 响应非JSON格式，使用默认错误信息
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            return this.parseFeedback(content, modules);
        } catch (err) {
            if (err.message.includes('API Key')) throw err;
            throw new Error('生成反馈失败：' + err.message);
        }
    }

    /**
     * 获取 emoji 使用指令
     */
    static getEmojiInstructions(style) {
        if (!style.useEmoji) return '不要使用任何 emoji 表情符号。';
        
        const pos = style.emojiPosition || 'content';
        const map = {
            content: '适当使用 emoji 增加亲和力，将 emoji 自然地融入内容中。',
            title: '在每个模块标题后添加一个相关的 emoji（如【课堂内容】📚）。',
            end: '在每个模块内容的末尾添加一个鼓励性 emoji（如👍、💪、✨）。',
            none: '不要使用任何 emoji 表情符号。'
        };
        return map[pos] || map.content;
    }

    /**
     * 获取输出格式指令
     */
    static getFormatInstructions(style, modules) {
        const useBullet = style.useBulletPoints;
        if (useBullet) {
            return '输出格式：对于内容较多的模块（如课堂内容、薄弱环节），可以使用 bullet point（·）或数字分点（1. 2. 3.）来组织内容，使结构更清晰。对于内容较少的模块，用段落即可。';
        }
        return '输出格式：为每个模块生成一段完整的文字，不要分点列举。';
    }

    /**
     * 智能压缩超长课堂转录文本
     * 策略：将文本分段，每段提取关键信息，再合并
     */
    static async _compressTranscript(transcript, maxChars, apiKey) {
        // 先尝试简单分段压缩（不调用API，节省费用）
        const simpleCompressed = this._simpleCompress(transcript, maxChars);
        if (simpleCompressed.length <= maxChars) {
            return {
                compressed: simpleCompressed,
                note: '\n（注：课堂内容较长，已进行智能压缩处理，确保关键信息不丢失）'
            };
        }

        // 如果简单压缩还不够，使用AI进行分段摘要
        const segments = this._splitIntoSegments(transcript);
        const summaries = [];

        for (const segment of segments) {
            const summary = await this._summarizeSegment(segment, apiKey);
            summaries.push(summary);
        }

        const combined = summaries.join('\n\n');
        return {
            compressed: combined,
            note: '\n（注：课堂内容非常丰富，已分段提取关键要点，确保全程内容都有体现）'
        };
    }

    /**
     * 简单压缩：去除冗余、合并重复、保留关键句
     */
    static _simpleCompress(transcript, maxChars) {
        // 1. 去除多余空白
        let text = transcript.replace(/\n{3,}/g, '\n\n').trim();

        // 2. 如果还超长，按段落保留关键信息
        if (text.length > maxChars) {
            const paragraphs = text.split(/\n{2,}/);
            const compressed = [];
            let currentLength = 0;

            // 为头部、中部、尾部分配预算
            // 头部30%（课程开始的重要信息）
            // 尾部30%（课程结束的重要信息）
            // 中部40%（中间段落的关键句）
            const headBudget = Math.floor(maxChars * 0.3);
            const tailBudget = Math.floor(maxChars * 0.3);
            const midBudget = maxChars - headBudget - tailBudget;

            const headCount = Math.min(5, Math.floor(paragraphs.length * 0.2));
            const tailCount = Math.min(5, Math.floor(paragraphs.length * 0.2));
            const midStart = headCount;
            const midEnd = paragraphs.length - tailCount;

            // 处理头部
            for (let i = 0; i < Math.min(headCount, paragraphs.length); i++) {
                const para = paragraphs[i].trim();
                if (!para) continue;
                // 头部段落也做截断，避免单段过长
                const truncated = para.length > 800 ? para.substring(0, 800) + '...' : para;
                if (currentLength + truncated.length + 2 <= headBudget) {
                    compressed.push(truncated);
                    currentLength += truncated.length + 2;
                }
            }

            // 处理中部（只保留关键句）
            let midLength = 0;
            for (let i = midStart; i < midEnd && i < paragraphs.length; i++) {
                const para = paragraphs[i].trim();
                if (!para) continue;
                const keySentences = this._extractKeySentences(para);
                for (const sent of keySentences) {
                    if (midLength + sent.length + 1 <= midBudget) {
                        compressed.push(sent);
                        midLength += sent.length + 1;
                        currentLength += sent.length + 1;
                    }
                }
            }

            // 处理尾部
            for (let i = Math.max(midEnd, 0); i < paragraphs.length; i++) {
                const para = paragraphs[i].trim();
                if (!para) continue;
                const truncated = para.length > 800 ? para.substring(0, 800) + '...' : para;
                if (currentLength + truncated.length + 2 <= maxChars) {
                    compressed.push(truncated);
                    currentLength += truncated.length + 2;
                }
            }

            text = compressed.join('\n');
        }

        return text;
    }

    /**
     * 从段落中提取包含关键词的关键句子
     */
    static _extractKeySentences(paragraph) {
        const sentences = paragraph.split(/[。！？；.!?;]/).filter(s => s.trim().length > 5);
        const keywords = [
            '掌握', '理解', '学会', '完成', '练习', '作业', '测试', '考试',
            '重点', '难点', '关键', '核心', '基础', '进阶', '拓展',
            '表现', '态度', '积极', '主动', '认真', '专注', '进步',
            '问题', '错误', '薄弱', '不足', '需要', '建议', '注意'
        ];

        return sentences.filter(sent => {
            const lower = sent.toLowerCase();
            return keywords.some(kw => lower.includes(kw));
        });
    }

    /**
     * 将长文本分割成适合API处理的段落
     */
    static _splitIntoSegments(transcript) {
        // 每段约3000字（约4500 tokens，留有余量）
        const SEGMENT_SIZE = 3000;
        const segments = [];

        // 按自然段落分割
        const paragraphs = transcript.split(/\n{2,}/);
        let currentSegment = '';

        for (const para of paragraphs) {
            if (currentSegment.length + para.length > SEGMENT_SIZE && currentSegment.length > 0) {
                segments.push(currentSegment.trim());
                currentSegment = para;
            } else {
                currentSegment += (currentSegment ? '\n\n' : '') + para;
            }
        }

        if (currentSegment.trim()) {
            segments.push(currentSegment.trim());
        }

        return segments;
    }

    /**
     * 使用AI对单段文本进行摘要
     */
    static async _summarizeSegment(segment, apiKey) {
        const baseUrl = Storage.getApiBaseUrl() || 'https://api.deepseek.com';

        const prompt = `请对以下课堂内容进行摘要，提取关键教学点、学生表现和重要信息。保持时间顺序，用简洁的语言概括：

${segment}

摘要要求：
- 保留具体知识点名称
- 保留学生具体表现（好或差）
- 保留作业或任务安排
- 用 bullet point 格式输出
- 总字数控制在200字以内`;

        try {
            const response = await this._fetchWithRetry(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-v4-flash',
                    messages: [
                        { role: 'system', content: '你是一位专业的课堂记录整理员，擅长提取课堂关键信息。' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3,
                    max_tokens: 500
                })
            });

            if (!response.ok) {
                // 如果摘要失败，返回原文前300字
                return segment.substring(0, 300) + (segment.length > 300 ? '...' : '');
            }

            const data = await response.json();
            return data.choices?.[0]?.message?.content || segment.substring(0, 300);
        } catch {
            // 降级：返回原文前300字
            return segment.substring(0, 300) + (segment.length > 300 ? '...' : '');
        }
    }

    static getToneInstructions(style) {
        const tone = style?.tone || 'formal';
        const map = {
            friendly: '语气温暖亲切，像关心学生的朋友，用词自然随和',
            formal: '语气严谨专业，体现教师素养，用词规范正式',
            concise: '语言简洁明了，直击要点，避免冗余描述',
            detailed: '内容详细具体，描述充分，涵盖更多细节',
            humorous: '语气轻松幽默，有趣生动，让反馈更活泼',
            encouraging: '多肯定进步，传递正能量，以鼓励为主'
        };
        return map[tone] || map.formal;
    }

    static estimateTranscriptLength(transcript) {
        const charCount = transcript.length;
        if (charCount < 500) return 'short';
        if (charCount < 2000) return 'medium';
        if (charCount < 5000) return 'long';
        if (charCount < 15000) return 'very_long';
        if (charCount < 40000) return 'extreme';
        return 'ultra'; // 4万字+
    }

    static getLengthGuidance(transcript) {
        const length = this.estimateTranscriptLength(transcript);
        const guidance = {
            short: '根据课堂内容生成完整反馈。',
            medium: '课堂内容较为丰富，请全面覆盖各个要点，不要遗漏前半部分的内容。',
            long: '课堂内容非常丰富，请确保覆盖整个课堂过程的所有重要内容，特别注意不要只关注最后部分。',
            very_long: '课堂内容极其丰富（超过5000字），请务必覆盖从课程开始到结束的完整内容，不得遗漏前半段的大量信息。你需要从所有内容中提炼要点，但必须确保每一段内容都有体现。',
            extreme: '这是一节超长课程（超过15000字），内容已经过智能压缩处理。请基于提供的课堂要点生成反馈，确保覆盖课程全程的关键信息，包括：知识点讲解、学生表现变化、作业安排等。不要遗漏任何重要内容。',
            ultra: '这是一节超长的课程（超过40000字）。请从容地基于提供的完整课堂内容生成反馈，不需要紧张或压缩。按照正常的模块要求输出即可，确保覆盖课程全程。'
        };
        return guidance[length] || guidance.medium;
    }

    static getModuleDescription(moduleName) {
        const map = {
            '课堂内容': '总结本节课讲解的主要知识点和教学内容',
            '课堂表现': '描述学生在课堂上的参与度、专注度、互动情况等',
            '薄弱环节': '指出学生在本节课中暴露出的知识薄弱点或需要加强的地方',
            '课后作业': '布置课后作业并说明完成要求',
            '后续计划': '说明后续课程安排、预习要求或长期学习计划'
        };
        if (map[moduleName]) return map[moduleName];
        // 自定义模块：从 Storage 读取 description
        const modules = Storage.getModules();
        const mod = modules.find(m => m.name === moduleName && m.custom);
        return (mod && mod.description) ? mod.description : '生成相关内容';
    }

    static parseFeedback(content, modules) {
        const feedback = [];
        const lines = content.split('\n');
        let currentModule = null;
        let currentContent = [];

        for (const line of lines) {
            const moduleMatch = line.match(/【(.+)】/);
            if (moduleMatch && modules.includes(moduleMatch[1].trim())) {
                // 只识别已知模块名，避免AI在内容中使用【注意】等标记截断当前模块
                if (currentModule) {
                    feedback.push({
                        module: currentModule,
                        content: currentContent.join('\n').trim()
                    });
                }
                currentModule = moduleMatch[1].trim();
                currentContent = [];
            } else if (currentModule && line.trim()) {
                currentContent.push(line);
            }
        }

        if (currentModule) {
            feedback.push({
                module: currentModule,
                content: currentContent.join('\n').trim()
            });
        }

        // 过滤掉内容为空的模块
        return feedback.filter(f => f.content.trim());
    }

    static async validateApiKey(apiKey) {
        const baseUrl = Storage.getApiBaseUrl() || 'https://api.deepseek.com';
        try {
            const response = await fetch(`${baseUrl}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json'
                }
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * 通用聊天补全接口（供其他页面复用，避免重复编写 fetch/错误处理逻辑）
     * @param {Array<{role: string, content: string}>} messages - 消息列表
     * @param {{temperature?: number, maxTokens?: number}} options - 可选参数
     * @returns {Promise<string>} AI 返回的文本内容
     */
    static async chatCompletion(messages, { temperature = 0.7, maxTokens = 1500 } = {}) {
        const apiKey = Storage.getApiKey();
        if (!apiKey) throw new Error('请先设置 API Key');

        const baseUrl = Storage.getApiBaseUrl() || 'https://api.deepseek.com';
        const response = await this._fetchWithRetry(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-v4-flash',
                messages,
                temperature,
                max_tokens: maxTokens
            })
        });

        if (!response.ok) {
            let errorMsg = `API 请求失败: ${response.status}`;
            try {
                const error = await response.json();
                if (error.error?.message) errorMsg = error.error.message;
            } catch {
                // 响应非JSON格式，使用默认错误信息
            }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    }

    // ===== 小组模式：为多位学生分别生成独立反馈 =====

    /**
     * 为小组中的每位学生分别生成独立反馈
     * @param {string} transcript - 课堂内容（包含与所有学生的互动）
     * @param {string[]} modules - 启用的模块列表
     * @param {string[]} studentNames - 所有学生姓名数组
     * @param {string} subjectName - 科目名称
     * @param {object} style - 风格设置
     * @param {string|null} subjectId - 科目ID
     * @returns {Promise<Array<{studentName: string, feedback: Array<{module: string, content: string}>}>>}
     */
    static async generateGroupFeedback(transcript, modules, studentNames, subjectName, style, subjectId) {
        const apiKey = Storage.getApiKey();
        if (!apiKey) throw new Error('请先设置 API Key');

        const toneDesc = this.getToneInstructions(style);
        const emojiReq = this.getEmojiInstructions(style);
        const formatReq = this.getFormatInstructions(style, modules);
        const strictReq = style.strictInput !== false
            ? '严格基于我提供的课堂内容生成反馈，不要编造任何未提及的内容。如果某个学生没有足够的信息，如实简要说明即可。'
            : '';
        const conciseReq = '反馈要简洁精炼，适当总结，避免冗长和重复。每个模块控制在要求的字数范围内，不要过度展开。';
        const parentReq = style.includeParentHelp
            ? '在课后作业模块中，可以适当建议家长协助监督。'
            : '不要在反馈中提及"请家长协助"、"请家长监督"、"请家长提醒"等类似内容。';
        const customReq = style.customPrompt ? `\n\n## 用户自定义要求\n${style.customPrompt}` : '';

        // 科目专属模板
        let subjectTemplateReq = '';
        if (subjectId) {
            const template = store.getSubjectTemplate(subjectId);
            if (template && template.prompt) {
                subjectTemplateReq = `\n\n## 科目专属要求（${subjectName}）\n${template.prompt}`;
            }
        }

        // 按模块生成字数限制说明
        const moduleLengthInstructions = modules.map(m => {
            const len = Storage.getModuleLength(m, style);
            return `- ${m}：${len.min}到${len.max}字`;
        }).join('\n');

        const moduleInstructions = modules.map(m => {
            const desc = this.getModuleDescription(m);
            return `- ${m}：${desc}`;
        }).join('\n');

        // 超长文本处理
        const availableTokens = this.MAX_CONTEXT_TOKENS
            - this.SYSTEM_PROMPT_TOKENS - this.FRAMEWORK_TOKENS - this.MAX_OUTPUT_TOKENS;
        const maxContentChars = Math.floor(availableTokens / this.TOKENS_PER_CHAR);
        let processedTranscript = transcript;
        let compressionNote = '';
        if (transcript.length > maxContentChars) {
            const result = await this._compressTranscript(transcript, maxContentChars, apiKey);
            processedTranscript = result.compressed;
            compressionNote = result.note;
        }

        // 构建学生列表和姓名处理规则
        const studentListMarkdown = studentNames.map((name, i) => {
            const shortName = name.length >= 3 ? name.slice(-2) : name;
            const note = name.length >= 3
                ? `（全名"${name}"，反馈中称呼为"${shortName}"）`
                : `（反馈中直接使用全名"${name}"）`;
            return `  ${i + 1}. ${name} ${note}`;
        }).join('\n');

        const nameInstruction = style.nameShorten !== false
            ? `姓名处理规则（必须严格遵守）：
- 对于三字姓名（如"王小明"），在反馈中只使用最后两个字（"小明"）
- 对于两字姓名（如"梓含"），直接使用全名
- 绝对禁止创造不存在的昵称（如"明明"、"含含"等）
- 在反馈中称呼学生时使用处理后的名字，不要使用"该生"、"这位同学"等代称`
            : `姓名处理规则：直接使用学生全名，不要截取、不要创造昵称。`;

        const prompt = `你是一位专业的教育培训老师，需要根据课堂内容为多位学生分别生成独立的课堂反馈。

## 学生信息
- 科目：${subjectName}
- 本堂课共有 ${studentNames.length} 位学生一起上课：
${studentListMarkdown}
${compressionNote}

## 课堂内容
${processedTranscript}

## 课堂内容分析要求（重要）
- 仔细阅读全文，识别涉及**每位学生**的内容
- 如果学生姓名在内容中被明确提及（如"小明回答正确"），以此为依据
- 如果内容中没有明确姓名，根据上下文和对话逻辑推断哪位学生在什么情境下的表现
- 注意同一句话可能涉及多个学生（如"你们两个都做得不错"）
- 对于没有足够信息的学生，在对应模块中如实说明"本节课相关记录较少"

## 生成要求
1. ${toneDesc}
2. ${emojiReq}
3. 每位学生的每个模块字数要求：\n${moduleLengthInstructions}
4. ${strictReq}
5. ${conciseReq}
6. ${parentReq}
7. ${nameInstruction}
8. ${formatReq}
9. 请为每位学生**分别**生成独立的课堂反馈
${subjectTemplateReq}
${customReq}

## 需要包含的模块
${moduleInstructions}

## 公共模块特殊要求（极其重要，必须严格遵守）
【课堂内容】和【课后作业】这两个模块是**全组统一的公共内容**，描述的是整节课的客观情况，不是针对某个学生的个人反馈。因此：
- **绝对禁止**在【课堂内容】和【课后作业】中出现任何学生姓名（包括"彦祖"、"亦凡"、"杰伦"、"小明"等）
- **绝对禁止**在【课堂内容】和【课后作业】中使用"请某某同学"、"某某需要"、"某某在课后"等指向特定学生的表述
- 【课堂内容】应客观描述本节课的教学内容、知识点、课堂活动，不要提及任何具体学生的表现
- 【课后作业】应客观布置作业内容和要求，面向全体学生，不要指定由某位学生完成
- 如果作业要求中需要提及学生，使用"同学们"、"大家"等集体称谓
- 错误的例子："请彦祖在课后独立完成..."、"亦凡需要复习..."、"杰伦的时间轴作业..."
- 正确的例子："请同学们在课后独立完成..."、"本次作业要求大家..."

## 输出格式（必须严格遵守）
请为每位学生生成独立的反馈，每位学生之间用分隔线隔开。格式如下：

===== 学生：王小明 =====
【课堂内容】
（客观描述整节课的教学内容，不出现任何学生姓名）

【课堂表现】
（针对小明的课堂表现反馈，可以使用姓名）

【薄弱环节】
（针对小明的薄弱环节反馈，可以使用姓名）

【课后作业】
（客观布置作业，面向全体，不出现任何学生姓名）

===== 学生：李小红 =====
【课堂内容】
（客观描述整节课的教学内容，不出现任何学生姓名）

...

**注意：**
- 必须为每位学生都生成完整反馈
- 分隔线必须使用"===== 学生：姓名 ====="格式
- 每位学生内部的模块用【模块名】标记
- 【课堂内容】和【课后作业】对所有学生应该是**完全相同**的客观描述`

        const baseUrl = Storage.getApiBaseUrl() || 'https://api.deepseek.com';
        try {
            const response = await this._fetchWithRetry(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-v4-flash',
                    messages: [
                        { role: 'system', content: '你是一位经验丰富的教育培训老师，擅长为多位学生分别撰写专业、有针对性的课堂反馈。你严格遵守姓名处理规则，不会混淆不同学生的表现。' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: this.MAX_OUTPUT_TOKENS
                })
            });

            if (!response.ok) {
                let errorMsg = `API 请求失败: ${response.status}`;
                try {
                    const error = await response.json();
                    if (error.error?.message) errorMsg = error.error.message;
                } catch {
                    // 响应非JSON格式，使用默认错误信息
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            return this.parseGroupFeedback(content, studentNames, modules);
        } catch (err) {
            if (err.message.includes('API Key')) throw err;
            throw new Error('生成反馈失败：' + err.message);
        }
    }

    /**
     * 解析小组反馈内容，提取每位学生的独立反馈
     * @param {string} content - AI返回的原始内容
     * @param {string[]} studentNames - 学生姓名列表（用于校验）
     * @param {string[]} modules - 模块列表
     * @returns {Array<{studentName: string, feedback: Array<{module: string, content: string}>}>}
     */
    static parseGroupFeedback(content, studentNames, modules) {
        // 尝试按分隔线分割：===== 学生：姓名 =====
        // 也支持 ===== 姓名 ===== 的简化格式
        const separatorRegex = /={3,}\s*(?:学生[：:]\s*)?(.+?)\s*={3,}/g;

        const result = [];
        let match;
        let lastIndex = 0;
        let currentStudent = null;
        let accumulatedContent = '';

        // 收集所有分割点的位置
        const sections = [];
        while ((match = separatorRegex.exec(content)) !== null) {
            const studentName = match[1].trim();
            const sectionStart = match.index + match[0].length;
            if (currentStudent) {
                sections.push({
                    studentName: currentStudent,
                    contentStart: lastIndex,
                    contentEnd: match.index
                });
            }
            currentStudent = studentName;
            lastIndex = sectionStart;
        }

        // 最后一个学生
        if (currentStudent) {
            sections.push({
                studentName: currentStudent,
                contentStart: lastIndex,
                contentEnd: content.length
            });
        }

        // 如果没有找到任何分隔线，尝试整体按学生姓名智能分割
        if (sections.length === 0) {
            // 降级策略1：尝试按 "学生姓名：" 或 "姓名：" 等模式分割
            const nameHeaderPatterns = [];
            for (const name of studentNames) {
                // 匹配各种可能的姓名标题格式
                const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                nameHeaderPatterns.push(
                    new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[：:]\\s*`, 'gm'),
                    new RegExp(`(?:^|\\n)\\s*学生\\s*[：:]\\s*${escaped}\\s*`, 'gm'),
                    new RegExp(`(?:^|\\n)\\s*【${escaped}】\\s*`, 'gm')
                );
            }

            let splitPoints = [];
            for (const pattern of nameHeaderPatterns) {
                let m;
                while ((m = pattern.exec(content)) !== null) {
                    splitPoints.push({ index: m.index, name: '' });
                }
            }

            // 如果找到了姓名分割点，按分割点分割内容
            if (splitPoints.length > 0) {
                splitPoints.sort((a, b) => a.index - b.index);
                // 识别每个分割点对应的学生
                for (const sp of splitPoints) {
                    const headerText = content.substring(sp.index, Math.min(sp.index + 30, content.length));
                    for (const name of studentNames) {
                        if (headerText.includes(name)) {
                            sp.name = name;
                            break;
                        }
                    }
                }

                // 构建分段
                const namedSections = [];
                for (let i = 0; i < splitPoints.length; i++) {
                    const start = splitPoints[i].index;
                    const end = (i + 1 < splitPoints.length) ? splitPoints[i + 1].index : content.length;
                    const sectionContent = content.substring(start, end).trim();
                    if (splitPoints[i].name) {
                        namedSections.push({
                            studentName: splitPoints[i].name,
                            content: sectionContent
                        });
                    }
                }

                if (namedSections.length > 0) {
                    for (const ns of namedSections) {
                        const feedback = this.parseFeedback(ns.content, modules);
                        result.push({
                            studentName: ns.studentName,
                            feedback: feedback.length > 0 ? feedback : modules.map(m => ({
                                module: m,
                                content: '（AI未能正确按学生区分，建议重新生成）'
                            }))
                        });
                    }
                }
            }

            // 降级策略2：如果按姓名分割也失败了，检查内容中是否包含学生姓名
            if (result.length === 0) {
                let foundAnyName = false;
                for (const name of studentNames) {
                    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    if (new RegExp(escapedName).test(content)) {
                        foundAnyName = true;
                        break;
                    }
                }
                if (foundAnyName) {
                    // 内容中有学生姓名但无法按格式分割，给每个学生一份整体反馈（标记为降级）
                    const feedback = this.parseFeedback(content, modules);
                    return studentNames.map(name => ({
                        studentName: name,
                        feedback: feedback.length > 0 ? feedback : modules.map(m => ({
                            module: m,
                            content: '（AI未能正确按学生区分，建议重新生成）'
                        }))
                    }));
                }
                // 完全无法解析
                return studentNames.map(name => ({
                    studentName: name,
                    feedback: modules.map(m => ({
                        module: m,
                        content: '（AI未能正确按学生区分，建议重新生成）'
                    }))
                }));
            }
        }

        // 解析每个学生的模块内容
        for (const section of sections) {
            const sectionContent = content.substring(section.contentStart, section.contentEnd).trim();
            const feedback = this.parseFeedback(sectionContent, modules);
            result.push({
                studentName: section.studentName,
                feedback: feedback.length > 0 ? feedback : modules.map(m => ({
                    module: m,
                    content: '（本节课未获取到该学生的相关信息）'
                }))
            });
        }

        // 确保结果包含所有学生
        // 如果AI漏掉了某个学生，补上空反馈
        const foundNames = result.map(r => r.studentName);
        for (const name of studentNames) {
            // 检查是否已存在（模糊匹配：仅允许AI省略姓氏，不允许短名匹配长名）
            const exists = foundNames.some(fn => fn === name || fn.endsWith(name) || name.endsWith(fn));
            if (!exists) {
                result.push({
                    studentName: name,
                    feedback: modules.map(m => ({
                        module: m,
                        content: '（本节课未获取到该学生的相关信息）'
                    }))
                });
            }
        }

        return result;
    }
}

// AiService 是 AI 的别名，用于外部引用（recordPage.js）
const AiService = AI;
