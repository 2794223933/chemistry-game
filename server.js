const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const db = new Database('game_data.db');

db.exec(`
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY,
        name TEXT DEFAULT '',
        level1_passed INTEGER DEFAULT 0,
        level1_selected TEXT DEFAULT '[]',
        level2_slots TEXT DEFAULT '[-1,-1,-1,-1,-1,-1,-1]',
        level2_passed INTEGER DEFAULT 0,
        level2_last_order TEXT DEFAULT '',
        level2_submit_time INTEGER DEFAULT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    
    CREATE TABLE IF NOT EXISTS global_state (
        key TEXT PRIMARY KEY,
        value TEXT
    );
`);

const initDatabase = db.transaction(() => {
    const globalExists = db.prepare("SELECT COUNT(*) as cnt FROM global_state WHERE key = 'level1_global_passed'").get();
    if (globalExists.cnt === 0) {
        db.prepare("INSERT INTO global_state (key, value) VALUES ('level1_global_passed', 'false')").run();
    }
});
initDatabase();

app.get('/api/student/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (id < 1) {
        return res.status(400).json({ error: '学生编号必须大于0' });
    }
    
    let student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!student) {
        db.prepare('INSERT INTO students (id) VALUES (?)').run(id);
        student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    }
    
    res.json({
        id: student.id,
        name: student.name,
        level1Passed: student.level1_passed === 1,
        level1Selected: JSON.parse(student.level1_selected || '[]'),
        level2Slots: JSON.parse(student.level2_slots || '[-1,-1,-1,-1,-1,-1,-1]'),
        level2Passed: student.level2_passed === 1,
        level2LastOrder: student.level2_last_order,
        level2SubmitTime: student.level2_submit_time
    });
});

app.post('/api/student/:id/level1', (req, res) => {
    const id = parseInt(req.params.id);
    const { passed, selected } = req.body;
    
    db.prepare(`
        UPDATE students 
        SET level1_passed = ?, level1_selected = ?, updated_at = strftime('%s', 'now')
        WHERE id = ?
    `).run(passed ? 1 : 0, JSON.stringify(selected || []), id);
    
    res.json({ success: true });
});

app.post('/api/student/:id/level2', (req, res) => {
    const id = parseInt(req.params.id);
    const { slots, passed, lastOrder } = req.body;
    
    db.prepare(`
        UPDATE students 
        SET level2_slots = ?, level2_passed = ?, level2_last_order = ?, 
            level2_submit_time = strftime('%s', 'now'), updated_at = strftime('%s', 'now')
        WHERE id = ?
    `).run(JSON.stringify(slots), passed ? 1 : 0, lastOrder || '', id);
    
    res.json({ success: true });
});

app.post('/api/student/:id/name', (req, res) => {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    
    db.prepare(`UPDATE students SET name = ?, updated_at = strftime('%s', 'now') WHERE id = ?`).run(name || '', id);
    
    res.json({ success: true });
});

app.get('/api/global/level1', (req, res) => {
    const row = db.prepare("SELECT value FROM global_state WHERE key = 'level1_global_passed'").get();
    res.json({ passed: row?.value === 'true' });
});

app.post('/api/global/level1', (req, res) => {
    const { passed } = req.body;
    db.prepare("UPDATE global_state SET value = ? WHERE key = 'level1_global_passed'").run(passed ? 'true' : 'false');
    res.json({ success: true });
});

app.get('/api/admin/students', (req, res) => {
    const students = db.prepare('SELECT * FROM students ORDER BY id').all();
    res.json(students.map(s => ({
        id: s.id,
        name: s.name,
        level1Passed: s.level1_passed === 1,
        level1Selected: JSON.parse(s.level1_selected || '[]'),
        level2Slots: JSON.parse(s.level2_slots || '[-1,-1,-1,-1,-1,-1,-1]'),
        level2Passed: s.level2_passed === 1,
        level2LastOrder: s.level2_last_order,
        level2SubmitTime: s.level2_submit_time,
        updatedAt: s.updated_at
    })));
});

app.post('/api/admin/reset', (req, res) => {
    db.transaction(() => {
        db.prepare("UPDATE global_state SET value = 'false' WHERE key = 'level1_global_passed'").run();
        db.prepare(`
            UPDATE students 
            SET level1_passed = 0, level1_selected = '[]',
                level2_slots = '[-1,-1,-1,-1,-1,-1,-1]',
                level2_passed = 0, level2_last_order = '',
                level2_submit_time = NULL,
                updated_at = strftime('%s', 'now')
        `).run();
    })();
    res.json({ success: true });
});

app.post('/api/admin/reset-student/:id', (req, res) => {
    const id = parseInt(req.params.id);
    db.prepare(`
        UPDATE students 
        SET level1_passed = 0, level1_selected = '[]',
            level2_slots = '[-1,-1,-1,-1,-1,-1,-1]',
            level2_passed = 0, level2_last_order = '',
            level2_submit_time = NULL,
            updated_at = strftime('%s', 'now')
        WHERE id = ?
    `).run(id);
    res.json({ success: true });
});

app.get('/api/admin/stats', (req, res) => {
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(level1_passed) as level1_passed_count,
            SUM(level2_passed) as level2_passed_count,
            SUM(CASE WHEN level2_last_order != '' THEN 1 ELSE 0 END) as level2_submitted_count
        FROM students
    `).get();
    
    const globalLevel1 = db.prepare("SELECT value FROM global_state WHERE key = 'level1_global_passed'").get();
    
    res.json({
        total: stats.total,
        level1PassedCount: stats.level1_passed_count || 0,
        level2PassedCount: stats.level2_passed_count || 0,
        level2SubmittedCount: stats.level2_submitted_count || 0,
        globalLevel1Passed: globalLevel1?.value === 'true'
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'game.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务器已启动: http://localhost:${PORT}`);
    console.log(`教师后台: http://localhost:${PORT}/admin`);
    console.log(`学生游戏: http://localhost:${PORT}/`);
    console.log('局域网访问: 请查看本机IP地址，其他设备可通过 http://本机IP:3000 访问');
});
