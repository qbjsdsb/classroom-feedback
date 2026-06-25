// studentFormPage.js - 学生添加/编辑页

class StudentFormPage {
    constructor() {
        this.container = document.getElementById('student-form-page');
        this._params = {};
    }

    render() {
        const isEdit = this._params && this._params.id;
        const student = isEdit ? store.getStudentById(this._params.id) : null;
        const allSubjects = store.getSubjects();
        const studentSubjectIds = isEdit && student
            ? (store._studentSubjects[student.id] || [])
            : [];

        this.container.innerHTML = `
            <header>
                <button class="back-btn" onclick="app.navigate('students')" aria-label="返回学生管理">←</button>
                <h1>${isEdit ? '✏️ 编辑学生' : '➕ 添加学生'}</h1>
            </header>

            <div class="form-section">
                <div class="form-group">
                    <label for="student-name">学生姓名 *</label>
                    <input type="text" id="student-name" name="student-name" placeholder="请输入学生姓名…"
                           autocomplete="off"
                           aria-label="学生姓名"
                           value="${student ? escapeHtml(student.name) : ''}">
                </div>

                <div class="form-group">
                    <label for="student-grade">年级</label>
                    <select id="student-grade" name="student-grade" aria-label="年级">
                        <option value="">未选择</option>
                        <option value="一年级" ${student?.grade === '一年级' ? 'selected' : ''}>一年级</option>
                        <option value="二年级" ${student?.grade === '二年级' ? 'selected' : ''}>二年级</option>
                        <option value="三年级" ${student?.grade === '三年级' ? 'selected' : ''}>三年级</option>
                        <option value="四年级" ${student?.grade === '四年级' ? 'selected' : ''}>四年级</option>
                        <option value="五年级" ${student?.grade === '五年级' ? 'selected' : ''}>五年级</option>
                        <option value="六年级" ${student?.grade === '六年级' ? 'selected' : ''}>六年级</option>
                        <option value="初一" ${student?.grade === '初一' ? 'selected' : ''}>初一</option>
                        <option value="初二" ${student?.grade === '初二' ? 'selected' : ''}>初二</option>
                        <option value="初三" ${student?.grade === '初三' ? 'selected' : ''}>初三</option>
                        <option value="高一" ${student?.grade === '高一' ? 'selected' : ''}>高一</option>
                        <option value="高二" ${student?.grade === '高二' ? 'selected' : ''}>高二</option>
                        <option value="高三" ${student?.grade === '高三' ? 'selected' : ''}>高三</option>
                    </select>
                </div>

                <div class="form-group">
                    <label style="display:block;margin-bottom:8px;font-weight:500;">试听学生</label>
                    <label class="toggle-label">
                        <input type="checkbox" id="student-trial" name="student-trial" ${student && student.isTrial ? 'checked' : ''}>
                        <span class="toggle-switch" aria-hidden="true"></span>
                        <span>标记为试听学生</span>
                    </label>
                    <p class="hint-text">标记后，生成的反馈标题会显示"试听"字样</p>
                </div>

                <div class="form-group">
                    <label>选修科目</label>
                    <div class="subject-checkboxes">
                        ${allSubjects.map(s => `
                            <label class="subject-checkbox-item" style="--subject-color: ${s.color}">
                                <input type="checkbox" name="subject" value="${s.id}"
                                    ${studentSubjectIds.includes(s.id) ? 'checked' : ''}>
                                <span class="check-box" style="border-color: ${s.color}" aria-hidden="true">
                                    <span class="check-mark" style="background: ${s.color}"></span>
                                </span>
                                <span class="subject-label">${escapeHtml(s.name)}</span>
                            </label>
                        `).join('')}
                    </div>
                    ${allSubjects.length === 0 ? '<p class="hint-text">暂无科目，请在设置中添加</p>' : ''}
                </div>

                <button id="btn-save-student" class="primary-btn">
                    ${isEdit ? '💾 保存修改' : '➕ 添加学生'}
                </button>

                ${isEdit ? `
                    <button id="btn-delete-student" class="danger-btn">
                        🗑️ 删除学生
                    </button>
                ` : ''}
            </div>
        `;

        this.bindEvents(isEdit, student?.id);
    }

    bindEvents(isEdit, studentId) {
        document.getElementById('btn-save-student')?.addEventListener('click', () => {
            const name = document.getElementById('student-name').value.trim();
            if (!name) {
                UI.showToast('请输入学生姓名');
                return;
            }

            const isTrial = document.getElementById('student-trial')?.checked || false;
            const grade = document.getElementById('student-grade')?.value || '';
            const checkedSubjects = Array.from(
                document.querySelectorAll('input[name="subject"]:checked')
            ).map(cb => cb.value);

            if (isEdit) {
                store.updateStudent(studentId, { name, isTrial, grade });
                store.setStudentSubjects(studentId, checkedSubjects);
                UI.showToast('学生信息已更新');
            } else {
                const newStudent = store.addStudent(name, isTrial, grade);
                store.setStudentSubjects(newStudent.id, checkedSubjects);
                UI.showToast('学生已添加');
            }

            app.navigate('students');
        });

        document.getElementById('btn-delete-student')?.addEventListener('click', () => {
            UI.showConfirm('确定删除该学生？相关反馈历史也将被删除。', () => {
                const snapshot = store.softDeleteStudent(studentId);
                app.navigate('students');
                if (snapshot) {
                    UI.showUndoToast('已删除学生', () => {
                        store.restoreStudent(snapshot);
                        app.navigate('students');
                    });
                }
            });
        });
    }
}

const studentFormPage = new StudentFormPage();
