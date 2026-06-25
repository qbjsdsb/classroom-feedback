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
            if (status) status.textContent = '正在录音，点击暂停';
        } else if (hasPausedContent) {
            // 有暂停的内容，显示"继续录音"
            btn.classList.remove('recording');
            icon.textContent = '▶️';
            text.textContent = '继续录音';
            if (status) status.textContent = '录音已暂停，点击继续';
        } else {
            btn.classList.remove('recording');
            icon.textContent = '🔴';
            text.textContent = '开始录音';
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

        // 记录打开前焦点，关闭时还原
        const lastFocused = document.activeElement;

        const close = () => {
            overlay.classList.remove('show');
            document.removeEventListener('keydown', keyHandler, true);
            setTimeout(() => overlay.remove(), 250);
            // 还原焦点
            if (lastFocused && typeof lastFocused.focus === 'function') {
                lastFocused.focus();
            }
        };

        // Escape 关闭 + Enter 确认
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            } else if (e.key === 'Enter' && document.activeElement !== dialog.querySelector('.confirm-cancel-btn')) {
                // Enter 默认触发确认（除非焦点在取消按钮上）
                e.preventDefault();
                close();
                if (onConfirm) onConfirm();
            }
        };
        document.addEventListener('keydown', keyHandler, true);

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
                // 聚焦确认按钮，便于键盘用户快速操作
                dialog.querySelector('.confirm-ok-btn').focus();
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

        // 记录打开前焦点，关闭时还原
        const lastFocused = document.activeElement;

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
            document.removeEventListener('keydown', keyHandler, true);
            setTimeout(() => overlay.remove(), 250);
            if (lastFocused && typeof lastFocused.focus === 'function') {
                lastFocused.focus();
            }
        };

        // Escape 关闭
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };
        document.addEventListener('keydown', keyHandler, true);

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
                input.focus();
            });
        });
    },
    
    showLoading(message) {
        const overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.setAttribute('role', 'alert');
        overlay.setAttribute('aria-live', 'assertive');
        overlay.innerHTML = `
            <div class="loading-spinner"></div>
            <p id="loading-message" style="margin-top: 20px; color: var(--text-secondary); font-size: 0.95rem;">${message}</p>
        `;
        document.body.appendChild(overlay);
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
            setTimeout(() => overlay.remove(), 300);
        }
    },
    
    };
