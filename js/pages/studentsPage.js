// studentsPage.js - 学生列表页

class StudentsPage {
    constructor() {
        this.container = document.getElementById('students-page');
        this.searchQuery = '';
        this.selectedGrade = '';
        this.selectedStudentIds = new Set();
        this.isGroupMode = false;
    }

    render() {
        const students = store.searchStudents(this.searchQuery, this.selectedGrade);
        const apiKey = Storage.getApiKey();
        const hasSetup = apiKey && students.length > 0 && store.getSubjects().length > 0;
        const allGrades = this._getAllGrades();

        this.container.innerHTML = `
            <header>
                <h1>👥 学生管理</h1>
                <button id="btn-group-mode" class="icon-btn ${this.isGroupMode ? 'active' : ''}">
                    ${this.isGroupMode ? '👥 小组模式' : '👤 单人模式'}
                </button>
            </header>

            ${!hasSetup ? this.renderWelcomeGuide(students, apiKey) : ''}

            <div class="search-section">
                <div class="search-bar">
                    <span class="search-icon">🔍</span>
                    <input type="text" id="student-search"
                           placeholder="搜索学生姓名..."
                           value="${escapeHtml(this.searchQuery)}">
                    ${this.searchQuery ? '<button class="clear-search">✕</button>' : ''}
                </div>
                ${allGrades.length > 0 ? `
                <div class="grade-filter">
                    <select id="grade-filter">
                        <option value="">全部年级</option>
                        ${allGrades.map(g => `<option value="${escapeHtml(g)}" ${this.selectedGrade === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
                    </select>
                </div>
                ` : ''}
                <div class="student-count">${students.length} 名学生</div>
            </div>

            <div class="students-list" id="students-list">
                ${students.length === 0 ? `
                    <div class="empty-state">
                        <div class="empty-state-icon">📝</div>
                        <p>还没有添加学生</p>
                        <button class="empty-state-action" onclick="app.navigate('student-form')">+ 添加第一名学生</button>
                    </div>
                ` : students.map(s => this.renderStudentCard(s)).join('')}
            </div>

            ${this.isGroupMode && this.selectedStudentIds.size > 0 ? `
                <div class="group-action-bar">
                    <span>已选择 ${this.selectedStudentIds.size} 人</span>
                    <button id="btn-confirm-group" class="primary-btn">确认选择</button>
                </div>
            ` : ''}

            <button id="btn-add-student" class="fab-btn" aria-label="添加学生">+</button>
        `;

        this.bindEvents();
    }

    // 仅更新学生列表区域（不重建搜索栏，避免输入框失焦）
    updateStudentList() {
        const students = store.searchStudents(this.searchQuery, this.selectedGrade);
        const listEl = document.getElementById('students-list');
        const countEl = document.querySelector('.student-count');
        const searchBar = document.querySelector('.search-bar');

        if (listEl) {
            listEl.innerHTML = students.length === 0 ? `
                <div class="empty-state">
                    <div class="empty-icon">📝</div>
                    <p>暂无学生</p>
                    <button class="secondary-btn" onclick="app.navigate('student-form')">添加第一名学生</button>
                </div>
            ` : students.map(s => this.renderStudentCard(s)).join('');
        }
        if (countEl) {
            countEl.textContent = `${students.length} 名学生`;
        }
        // 更新清除按钮
        if (searchBar) {
            const existingClear = searchBar.querySelector('.clear-search');
            if (this.searchQuery && !existingClear) {
                const clearBtn = document.createElement('button');
                clearBtn.className = 'clear-search';
                clearBtn.textContent = '✕';
                clearBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.searchQuery = '';
                    this.updateStudentList();
                    const input = document.getElementById('student-search');
                    if (input) input.value = '';
                });
                searchBar.appendChild(clearBtn);
            } else if (!this.searchQuery && existingClear) {
                existingClear.remove();
            }
        }
    }

    renderWelcomeGuide(students, apiKey) {
        let tips = [];
        if (!apiKey) {
            tips.push('在「设置」页面填入您的 DeepSeek API Key');
        }
        if (store.getSubjects().length === 0) {
            tips.push('在「设置」页面添加教学科目（如数学、英语）');
        }
        if (students.length === 0) {
            tips.push('点击右下角「+」按钮添加您的学生');
        }
        
        if (tips.length === 0) return '';

        return `
            <div class="quick-tips">
                <h4>快速开始</h4>
                <ul>
                    ${tips.map(tip => `<li>${tip}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    renderStudentCard(student) {
        const isSelected = this.selectedStudentIds.has(student.id);
        const subjects = store.getStudentSubjects(student.id);

        return `
            <div class="student-card ${isSelected ? 'selected' : ''}"
                 data-id="${student.id}"
                 onclick="studentsPage.onStudentClick('${student.id}')">
                <div class="student-avatar" style="background: ${this._getAvatarColor(student.name)}">
                    ${escapeHtml(student.name.charAt(0))}
                </div>
                <div class="student-info">
                    <div class="student-name">${escapeHtml(student.name)} ${student.isTrial ? '<span class="trial-badge">试听</span>' : ''} ${student.grade ? `<span class="grade-badge">${escapeHtml(student.grade)}</span>` : ''}</div>
                    <div class="student-subjects">
                        ${subjects.map(s => `<span class="subject-tag" style="background:${escapeHtml(s.color)}20;color:${escapeHtml(s.color)}">${escapeHtml(s.name)}</span>`).join('')}
                    </div>
                </div>
                ${this.isGroupMode ? `
                    <div class="select-indicator">${isSelected ? '✓' : ''}</div>
                ` : `
                    <button class="student-menu-btn" onclick="event.stopPropagation(); studentsPage.showMenu('${student.id}')">
                        ⋮
                    </button>
                `}
            </div>
        `;
    }

    _getAvatarColor(name) {
        const gradients = [
            'linear-gradient(135deg, #6366F1, #8B5CF6)',
            'linear-gradient(135deg, #10B981, #34D399)',
            'linear-gradient(135deg, #F59E0B, #FBBF24)',
            'linear-gradient(135deg, #EF4444, #F87171)',
            'linear-gradient(135deg, #8B5CF6, #A78BFA)',
            'linear-gradient(135deg, #EC4899, #F472B6)',
            'linear-gradient(135deg, #06B6D4, #22D3EE)',
            'linear-gradient(135deg, #F97316, #FB923C)',
            'linear-gradient(135deg, #14B8A6, #2DD4BF)',
            'linear-gradient(135deg, #E11D48, #FB7185)',
            'linear-gradient(135deg, #7C3AED, #A78BFA)',
            'linear-gradient(135deg, #0891B2, #67E8F9)'
        ];
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return gradients[Math.abs(hash) % gradients.length];
    }

    _getAllGrades() {
        const grades = [...new Set(store._students.map(s => s.grade).filter(Boolean))];
        // 按年级顺序排序
        const gradeOrder = ['一年级','二年级','三年级','四年级','五年级','六年级','初一','初二','初三','高一','高二','高三'];
        return grades.sort((a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b));
    }

    onStudentClick(studentId) {
        if (this.isGroupMode) {
            if (this.selectedStudentIds.has(studentId)) {
                this.selectedStudentIds.delete(studentId);
            } else {
                this.selectedStudentIds.add(studentId);
            }
            // 仅切换选中态和更新底部栏，不重建全部DOM
            this._toggleGroupSelection(studentId);
        } else {
            app.setCurrentStudent(studentId);
            app.navigate('subject-select');
        }
    }

    // 小组模式：仅更新单个卡片选中态和底部操作栏（避免全量DOM重建）
    _toggleGroupSelection(studentId) {
        // 更新卡片选中状态
        const card = document.querySelector(`.student-card[data-id="${studentId}"]`);
        if (card) {
            card.classList.toggle('selected');
            const indicator = card.querySelector('.select-indicator');
            if (indicator) {
                indicator.textContent = this.selectedStudentIds.has(studentId) ? '✓' : '';
            }
        }
        // 更新底部操作栏
        this._updateGroupActionBar();
    }

    _updateGroupActionBar() {
        const existingBar = document.querySelector('.group-action-bar');
        if (this.selectedStudentIds.size > 0) {
            if (existingBar) {
                existingBar.querySelector('span').textContent = `已选择 ${this.selectedStudentIds.size} 人`;
            } else {
                // 需要重建底部栏的情况，使用最小范围更新
                const container = this.container;
                const fabBtn = container.querySelector('.fab-btn');
                const bar = document.createElement('div');
                bar.className = 'group-action-bar';
                bar.innerHTML = `
                    <span>已选择 ${this.selectedStudentIds.size} 人</span>
                    <button id="btn-confirm-group" class="primary-btn">确认选择</button>
                `;
                container.insertBefore(bar, fabBtn);
                bar.querySelector('#btn-confirm-group')?.addEventListener('click', () => {
                    app.setCurrentGroup(Array.from(this.selectedStudentIds));
                    app.navigate('subject-select');
                });
            }
        } else {
            if (existingBar) existingBar.remove();
        }
    }

    showMenu(studentId) {
        const student = store.getStudentById(studentId);
        const safeName = student ? escapeHtml(student.name) : '';
        UI.showBottomSheet(`
            <div class="action-sheet">
                <button onclick="app.navigate('student-form', {id:'${studentId}'}); UI.closeBottomSheet();">✏️ 编辑 ${safeName}</button>
                <button onclick="studentsPage.confirmDelete('${studentId}')" class="danger">🗑️ 删除 ${safeName}</button>
                <button onclick="UI.closeBottomSheet()">取消</button>
            </div>
        `);
    }

    confirmDelete(studentId) {
        UI.closeBottomSheet();
        UI.showConfirm('确定删除该学生？相关反馈历史也将被删除。', () => {
            const snapshot = store.softDeleteStudent(studentId);
            this.render();
            if (snapshot) {
                UI.showUndoToast('已删除学生', () => {
                    store.restoreStudent(snapshot);
                    this.render();
                });
            }
        });
    }

    bindEvents() {
        const searchInput = document.getElementById('student-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                this.updateStudentList();
            });
        }

        const clearBtn = document.querySelector('.clear-search');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.searchQuery = '';
                const input = document.getElementById('student-search');
                if (input) input.value = '';
                this.updateStudentList();
            });
        }

        const gradeFilter = document.getElementById('grade-filter');
        if (gradeFilter) {
            gradeFilter.addEventListener('change', (e) => {
                this.selectedGrade = e.target.value;
                this.updateStudentList();
            });
        }

        document.getElementById('btn-group-mode')?.addEventListener('click', () => {
            this.isGroupMode = !this.isGroupMode;
            this.selectedStudentIds.clear();
            this.render();
        });

        document.getElementById('btn-add-student')?.addEventListener('click', () => {
            app.navigate('student-form');
        });

        document.getElementById('btn-confirm-group')?.addEventListener('click', () => {
            app.setCurrentGroup(Array.from(this.selectedStudentIds));
            app.navigate('subject-select');
        });
    }
}

const studentsPage = new StudentsPage();
