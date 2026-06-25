// subjectSelectPage.js - 科目选择页

class SubjectSelectPage {
    constructor() {
        this.container = document.getElementById('subject-select-page');
    }

    render() {
        const subjects = store.getSubjects();
        const currentStudent = app.currentStudent;
        const currentGroup = app.currentGroup;

        let title, subtitle;
        if (currentGroup && currentGroup.length > 0) {
            const names = currentGroup.map(id => store.getStudentById(id)?.name).filter(Boolean).join('、');
            title = '选择科目';
            subtitle = `👥 ${escapeHtml(names)}`;
        } else if (currentStudent) {
            title = '选择科目';
            subtitle = `👤 ${escapeHtml(currentStudent.name)}`;
        } else {
            title = '选择科目';
            subtitle = '请先选择学生';
        }

        // 如果是单个学生，只显示该学生选修的科目
        let displaySubjects = subjects;
        if (currentStudent && !currentGroup) {
            const studentSubIds = store._studentSubjects[currentStudent.id] || [];
            if (studentSubIds.length > 0) {
                displaySubjects = studentSubIds.map(id => store.getSubjectById(id)).filter(Boolean);
            }
        }

        this.container.innerHTML = `
            <header>
                <button class="back-btn" onclick="app.navigate('students')" aria-label="返回学生管理">←</button>
                <div class="session-info">
                    <div class="student-name">${title}</div>
                    <div class="subject-name">${subtitle}</div>
                </div>
            </header>

            <div class="subjects-grid">
                ${displaySubjects.map(s => {
                    const safeColor = escapeHtml(s.color);
                    return `
                    <button class="subject-card"
                            style="--subject-color: ${safeColor}"
                            onclick="subjectSelectPage.selectSubject('${s.id}')">
                        <div class="subject-icon" style="background: ${safeColor}20; color: ${safeColor}">
                            ${escapeHtml(s.name.charAt(0))}
                        </div>
                        <span class="subject-name-text">${escapeHtml(s.name)}</span>
                    </button>
                    `;
                }).join('')}
            </div>

            ${displaySubjects.length === 0 ? `
                <div class="empty-state">
                    <div class="empty-state-icon">📚</div>
                    <p>暂无科目</p>
                    <button class="empty-state-action" onclick="app.openSettings()">前往设置添加科目</button>
                </div>
            ` : ''}
        `;
    }

    selectSubject(subjectId) {
        app.setCurrentSubject(subjectId);
        app.navigate('record');
    }
}

const subjectSelectPage = new SubjectSelectPage();
