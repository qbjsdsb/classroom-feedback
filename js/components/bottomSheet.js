// bottomSheet.js - 底部弹窗组件

class BottomSheet {
    constructor() {
        this.container = null;
        this.overlay = null;
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

        this.container.addEventListener('click', (e) => {
            if (e.target === this.container) this.close();
        });
    }

    show(html) {
        const content = this.container.querySelector('.bottom-sheet-content');
        content.innerHTML = html;
        this.container.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.container.classList.remove('active');
        document.body.style.overflow = '';
    }
}

const bottomSheet = new BottomSheet();

// 挂载到 UI 对象
UI.showBottomSheet = (html) => bottomSheet.show(html);
UI.closeBottomSheet = () => bottomSheet.close();
