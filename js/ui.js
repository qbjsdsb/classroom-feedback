// ui.js - UI 交互与渲染

// 全局 HTML 转义函数，防止 XSS
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// FocusTrap - 通用焦点陷阱工具（P2-4）
// 供 modal/loading/confirm/log-panel 复用，统一无障碍焦点管理
// 职责：记录打开前焦点 → 转移焦点到弹窗 → Tab 循环 → ESC 关闭 → 还原焦点
const FocusTrap = {
    _stack: [], // 支持嵌套弹窗的栈结构

    /**
     * 激活焦点陷阱
     * @param {HTMLElement} container - 弹窗容器（焦点陷阱范围）
     * @param {object} opts
     * @param {Function} [opts.onEscape] - ESC 键回调（通常关闭弹窗）
     * @param {HTMLElement} [opts.initialFocus] - 初始聚焦元素（默认第一个可聚焦元素）
     */
    activate(container, opts = {}) {
        if (!container) return;
        const { onEscape, initialFocus } = opts;

        // 记录打开前焦点
        const lastFocused = document.activeElement;

        const handler = (e) => {
            if (e.key === 'Escape') {
                if (typeof onEscape === 'function') {
                    e.preventDefault();
                    onEscape();
                }
                return;
            }
            if (e.key === 'Tab') {
                const focusable = this._getFocusable(container);
                if (focusable.length === 0) {
                    e.preventDefault();
                    container.focus();
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey) {
                    if (document.activeElement === first || document.activeElement === container) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }
        };
        document.addEventListener('keydown', handler, true);

        const entry = { container, handler, lastFocused };
        this._stack.push(entry);

        // 转移焦点
        requestAnimationFrame(() => {
            if (initialFocus && typeof initialFocus.focus === 'function') {
                initialFocus.focus();
            } else {
                const focusable = this._getFocusable(container);
                if (focusable.length > 0) {
                    focusable[0].focus();
                } else {
                    container.setAttribute('tabindex', '-1');
                    container.focus();
                }
            }
        });

        // 返回 deactivate 句柄
        return () => this.deactivate(container);
    },

    /**
     * 停用焦点陷阱（还原焦点）
     * @param {HTMLElement} container
     */
    deactivate(container) {
        const idx = this._stack.findIndex(e => e.container === container);
        if (idx === -1) return;
        const entry = this._stack[idx];
        this._stack.splice(idx, 1);
        document.removeEventListener('keydown', entry.handler, true);
        // 还原焦点
        if (entry.lastFocused && typeof entry.lastFocused.focus === 'function') {
            try { entry.lastFocused.focus(); } catch (e) {}
        }
    },

    _getFocusable(container) {
        const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        return Array.from(container.querySelectorAll(selector))
            .filter(el => !el.disabled && el.offsetParent !== null);
    }
};

const UI = {
    updateRecordButton(isRecording, hasPausedContent = false) {
        const btn = document.getElementById('btn-record');
        if (!btn) return;
        const icon = btn.querySelector('.record-icon');
        const text = btn.querySelector('.record-text');
        const status = document.querySelector('.record-status');
        
        if (isRecording) {
            btn.classList.add('recording');
            icon.textContent = '⏸️';
            text.textContent = '暂停录音';
            btn.setAttribute('aria-pressed', 'true');
            btn.setAttribute('aria-label', '暂停录音（正在录音中）');
            if (status) status.textContent = '正在录音，点击暂停';
        } else if (hasPausedContent) {
            // 有暂停的内容，显示"继续录音"
            btn.classList.remove('recording');
            icon.textContent = '▶️';
            text.textContent = '继续录音';
            btn.setAttribute('aria-pressed', 'true');
            btn.setAttribute('aria-label', '继续录音（录音已暂停）');
            if (status) status.textContent = '录音已暂停，点击继续';
        } else {
            btn.classList.remove('recording');
            icon.textContent = '🔴';
            text.textContent = '开始录音';
            btn.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-label', '开始录音');
            if (status) status.textContent = '点击开始录制课堂内容';
        }
    },
    
    showToast(message, duration = 3000, type = 'auto') {
        // 自动判断类型
        if (type === 'auto') {
            if (/已删除|失败|错误|不支持|被拒绝|不可用|异常|出错/.test(message)) type = 'error';
            else if (/已保存|已添加|已复制|已导入|已导出|已插入|已完成|已切换|已更新|加载完成|识别完成/.test(message)) type = 'success';
            else if (/请先|请检查|请允许|⚠️|超过|过长|暂停|被占用/.test(message)) type = 'warning';
            else type = 'info';
        }

        // 移除已有的普通 toast（不影响带撤销按钮的 toast）
        const existing = document.querySelector('.toast:not(.toast-undo)');
        if (existing) {
            existing.classList.remove('show');
            setTimeout(() => existing.remove(), 300);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        // aria-live 让屏幕阅读器播报异步状态变化
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);

        // 强制回流后添加 show 类触发动画
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 350);
        }, duration);
    },

    /**
     * 显示带撤销按钮的 Toast
     * @param {string} message - 提示文字
     * @param {Function} onUndo - 撤销回调
     * @param {number} duration - 显示时长（默认5秒）
     */
    showUndoToast(message, onUndo, duration = 5000) {
        // 移除已有的 undo toast（新撤销提示替换旧的）
        const existing = document.querySelector('.toast-undo');
        if (existing) {
            existing.classList.remove('show');
            setTimeout(() => existing.remove(), 300);
        }

        const toast = document.createElement('div');
        toast.className = 'toast toast-warning toast-undo';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');

        const msgSpan = document.createElement('span');
        msgSpan.textContent = message;

        const undoBtn = document.createElement('button');
        undoBtn.className = 'toast-undo-btn';
        undoBtn.textContent = '撤销';
        undoBtn.setAttribute('aria-label', '撤销上一步操作');

        toast.appendChild(msgSpan);
        toast.appendChild(undoBtn);
        document.body.appendChild(toast);

        let undone = false;
        let hideTimer;

        const hide = () => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 350);
        };

        undoBtn.addEventListener('click', () => {
            if (undone) return;
            undone = true;
            clearTimeout(hideTimer);
            hide();
            if (onUndo) onUndo();
        });

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
        });

        hideTimer = setTimeout(() => {
            if (!undone) hide();
        }, duration);
    },

    showConfirm(message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', '确认操作');
        dialog.innerHTML = `
            <p class="confirm-message">${escapeHtml(message)}</p>
            <div class="confirm-actions">
                <button class="confirm-cancel-btn">取消</button>
                <button class="confirm-ok-btn">确定</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const close = () => {
            overlay.classList.remove('show');
            FocusTrap.deactivate(dialog);
            setTimeout(() => overlay.remove(), 250);
        };

        dialog.querySelector('.confirm-cancel-btn').addEventListener('click', close);
        dialog.querySelector('.confirm-ok-btn').addEventListener('click', () => {
            close();
            if (onConfirm) onConfirm();
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.classList.add('show');
                // 激活焦点陷阱：ESC 关闭 + Tab 循环 + Enter 确认 + 初始聚焦确认按钮
                FocusTrap.activate(dialog, {
                    onEscape: close,
                    initialFocus: dialog.querySelector('.confirm-ok-btn')
                });
                // Enter 确认（焦点陷阱之外补充的快捷键）
                dialog.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && document.activeElement !== dialog.querySelector('.confirm-cancel-btn')) {
                        e.preventDefault();
                        close();
                        if (onConfirm) onConfirm();
                    }
                });
            });
        });
    },

    /**
     * 输入确认对话框（用于危险操作，需输入指定文字确认）
     * @param {string} message - 提示信息
     * @param {string} confirmText - 需要输入的确认文字
     * @param {Function} onConfirm - 确认回调
     */
    showConfirmInput(message, confirmText, onConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', '输入确认');
        dialog.innerHTML = `
            <p class="confirm-message">${escapeHtml(message)}</p>
            <label for="confirm-input-field" style="display:block;font-size:0.85rem;color:var(--text-muted);margin:8px 0;">请输入 <strong style="color:var(--danger);">${escapeHtml(confirmText)}</strong> 以确认操作</label>
            <input type="text" id="confirm-input-field" class="confirm-input" placeholder="${escapeHtml(confirmText)}" autocomplete="off" name="confirm-input"
                style="width:100%;padding:10px 12px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:1rem;margin:8px 0;box-sizing:border-box;background:var(--bg);color:var(--text);">
            <div class="confirm-actions">
                <button class="confirm-cancel-btn">取消</button>
                <button class="confirm-ok-btn" disabled style="opacity:0.5;cursor:not-allowed;">确认</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const input = dialog.querySelector('.confirm-input');
        const okBtn = dialog.querySelector('.confirm-ok-btn');

        // 实时校验输入
        input.addEventListener('input', () => {
            const match = input.value.trim() === confirmText;
            okBtn.disabled = !match;
            okBtn.style.opacity = match ? '1' : '0.5';
            okBtn.style.cursor = match ? 'pointer' : 'not-allowed';
        });

        const close = () => {
            overlay.classList.remove('show');
            FocusTrap.deactivate(dialog);
            setTimeout(() => overlay.remove(), 250);
        };

        dialog.querySelector('.confirm-cancel-btn').addEventListener('click', close);
        okBtn.addEventListener('click', () => {
            if (input.value.trim() !== confirmText) return;
            close();
            if (onConfirm) onConfirm();
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.classList.add('show');
                // 激活焦点陷阱：ESC 关闭 + Tab 循环 + 初始聚焦输入框
                FocusTrap.activate(dialog, {
                    onEscape: close,
                    initialFocus: input
                });
            });
        });
    },
    
    showLoading(message, onCancel) {
        // 已存在 overlay 时仅更新消息，避免重复调用产生相同 id 的多个 overlay 导致残留无法移除
        let overlay = document.getElementById('loading-overlay');
        if (overlay) {
            // 重置可见性并取消挂起的 hideLoading 移除定时器，避免复用后 loading 不可见或被错误移除
            overlay.style.opacity = '';
            overlay.style.transition = '';
            if (overlay._hideTimer) { clearTimeout(overlay._hideTimer); overlay._hideTimer = null; }
            const msgEl = overlay.querySelector('#loading-message');
            if (msgEl) msgEl.textContent = message;
            // 更新取消按钮（若新调用方不需要取消，移除已有按钮）
            const existingCancelBtn = overlay.querySelector('.loading-cancel-btn');
            if (onCancel && typeof onCancel === 'function') {
                if (!existingCancelBtn) {
                    const btn = document.createElement('button');
                    btn.className = 'loading-cancel-btn';
                    btn.textContent = '取消';
                    btn.setAttribute('aria-label', '取消操作');
                    btn.addEventListener('click', () => {
                        try { onCancel(); } catch (e) {}
                        this.hideLoading();
                    });
                    overlay.appendChild(btn);
                }
            } else if (existingCancelBtn) {
                existingCancelBtn.remove();
            }
            return;
        }
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.setAttribute('role', 'alert');
        overlay.setAttribute('aria-live', 'assertive');
        overlay.innerHTML = `
            <div class="loading-spinner" aria-hidden="true"></div>
            <p id="loading-message" style="margin-top: 20px; color: var(--text-secondary); font-size: 0.95rem;">${message}</p>
        `;
        if (onCancel && typeof onCancel === 'function') {
            const btn = document.createElement('button');
            btn.className = 'loading-cancel-btn';
            btn.textContent = '取消';
            btn.setAttribute('aria-label', '取消操作');
            btn.addEventListener('click', () => {
                try { onCancel(); } catch (e) {}
                this.hideLoading();
            });
            overlay.appendChild(btn);
        }
        document.body.appendChild(overlay);
        // 激活焦点陷阱（有取消按钮时 Tab 可循环到按钮，无按钮时聚焦 overlay 本身）
        // loading 通常无 ESC 关闭（强制等待），故不传 onEscape
        FocusTrap.activate(overlay, {
            initialFocus: overlay.querySelector('.loading-cancel-btn') || undefined
        });
    },

    updateLoading(message) {
        const msgEl = document.getElementById('loading-message');
        if (msgEl) msgEl.textContent = message;
    },

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.3s';
            // 停用焦点陷阱（还原焦点）
            FocusTrap.deactivate(overlay);
            // 挂载到 overlay 属性，供 showLoading 复用时取消，避免复用后被错误移除
            overlay._hideTimer = setTimeout(() => {
                overlay.remove();
                overlay._hideTimer = null;
            }, 300);
        }
    },

    /**
     * 统一处理 IDB / 存储写入失败的用户提示（P2-8）
     * 策略：
     *  - 始终记录到控制台（保留诊断信息）
     *  - QuotaExceededError：toast 提示用户导出后清理（5 秒防抖，避免刷屏）
     *  - 其他错误：仅控制台记录，不打扰用户操作
     * @param {Error} err
     * @param {string} context - 调用方标识，如 'Storage' / 'DataStore:保存学生'
     */
    notifyWriteError(err, context) {
        // 始终记录到控制台
        console.warn(`[${context}] 写入失败:`, err);

        // 防抖：相同错误签名 5 秒内只提示一次，避免 toast 刷屏
        const sig = `${context}:${err?.name || ''}:${err?.message || ''}`;
        const now = Date.now();
        if (this._lastWriteErrorSig === sig && now - (this._lastWriteErrorTime || 0) < 5000) {
            return;
        }
        this._lastWriteErrorSig = sig;
        this._lastWriteErrorTime = now;

        // 仅对配额超限错误打扰用户（数据可能丢失，需要主动处理）
        const isQuota = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
        if (isQuota) {
            this.showToast('存储空间不足，请导出数据后清理', 5000, 'error');
        }
        // 其他写入错误（事务冲突、连接中断等）通常瞬时，不打扰用户
    }
};
