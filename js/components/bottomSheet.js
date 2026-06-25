// bottomSheet.js - 底部弹窗组件（含无障碍：焦点陷阱、Escape 关闭、焦点还原）

class BottomSheet {
    constructor() {
        this.container = null;
        this.overlay = null;
        this._lastFocused = null;   // 打开前焦点所在元素，关闭时还原
        this._keyHandler = null;   // 键盘事件处理器引用（用于移除）
        this.init();
    }

    init() {
        // 查找或创建容器
        this.container = document.getElementById('bottom-sheet');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'bottom-sheet';
            this.container.className = 'bottom-sheet';
            this.container.innerHTML = '<div class="bottom-sheet-content"></div>';
            document.body.appendChild(this.container);
        }

        // 确保对话框语义（index.html 已设置，此处兜底）
        this.container.setAttribute('role', 'dialog');
        this.container.setAttribute('aria-modal', 'true');

        // 点击背景关闭
        this.container.addEventListener('click', (e) => {
            if (e.target === this.container) this.close();
        });
    }

    show(html) {
        const content = this.container.querySelector('.bottom-sheet-content');
        content.innerHTML = html;
        this.container.classList.add('active');
        document.body.style.overflow = 'hidden';

        // 记录打开前的焦点元素，关闭时还原
        this._lastFocused = document.activeElement;

        // 将焦点移至弹窗内第一个可聚焦元素，便于屏幕阅读器立即播报
        requestAnimationFrame(() => {
            const focusable = this._getFocusableElements();
            if (focusable.length > 0) {
                focusable[0].focus();
            } else {
                // 无可聚焦元素时，聚焦容器本身（需 tabindex=-1 才能接收焦点）
                this.container.setAttribute('tabindex', '-1');
                this.container.focus();
            }
        });

        // 绑定键盘事件：Escape 关闭 + Tab 焦点陷阱
        this._keyHandler = (e) => this._onKeyDown(e);
        document.addEventListener('keydown', this._keyHandler, true);
    }

    close() {
        this.container.classList.remove('active');
        document.body.style.overflow = '';

        // 移除键盘事件监听
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler, true);
            this._keyHandler = null;
        }

        // 还原焦点到触发元素
        if (this._lastFocused && typeof this._lastFocused.focus === 'function') {
            this._lastFocused.focus();
            this._lastFocused = null;
        }
    }

    // 获取弹窗内所有可聚焦元素
    _getFocusableElements() {
        const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        return Array.from(this.container.querySelectorAll(selector))
            .filter(el => !el.disabled && el.offsetParent !== null);
    }

    // 键盘事件处理
    _onKeyDown(e) {
        // Escape 关闭
        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
            return;
        }

        // Tab 焦点陷阱：在弹窗内循环
        if (e.key === 'Tab') {
            const focusable = this._getFocusableElements();
            if (focusable.length === 0) {
                e.preventDefault();
                this.container.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey) {
                // Shift+Tab：从第一个跳到最后一个
                if (document.activeElement === first || document.activeElement === this.container) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                // Tab：从最后一个跳到第一个
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    }
}

const bottomSheet = new BottomSheet();

// 挂载到 UI 对象
UI.showBottomSheet = (html) => bottomSheet.show(html);
UI.closeBottomSheet = () => bottomSheet.close();
