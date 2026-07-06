const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const csv = require('csv-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection via DATABASE_URL (Render.com)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Khởi tạo Database table
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS records (
                id SERIAL PRIMARY KEY,
                emp_id TEXT,
                cccd TEXT,
                data TEXT
            )
        `);
        console.log('PostgreSQL: Bảng records đã sẵn sàng');
    } catch (err) {
        console.error('PostgreSQL init error:', err);
    }
}
initDB();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Disable caching for all static files
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });

// CCCD Sheet URL (mật khẩu nhân viên)
const CCCD_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1l6mQ8-lIJvdXfJhYWy0-_5eZ09o3bnmu2VyVbJzG-Hs/gviz/tq?tqx=out:csv&gid=1803813137';

// Background caching mechanism
const sheetCache = {};
const CACHE_TTL_MS = 60 * 1000; // 1 phút tự động update

async function fetchWithCache(url) {
    const now = Date.now();
    if (sheetCache[url] && (now - sheetCache[url].time < CACHE_TTL_MS)) {
        return sheetCache[url].data;
    }
    
    try {
        const response = await fetch(url);
        const text = await response.text();
        sheetCache[url] = { data: text, time: now };
        return text;
    } catch (e) {
        console.error('Fetch error for', url, e);
        return sheetCache[url] ? sheetCache[url].data : null;
    }
}

// Background auto-updater (chạy ngầm mỗi phút)
setInterval(async () => {
    try {
        await Promise.all([
            fetchWithCache(CCCD_SHEET_URL),
            fetchWithCache('https://docs.google.com/spreadsheets/d/1n6pRyTVUTKoZ1sm7Sf6fBeZKtPkJ4EngXjIqj_yTyLo/gviz/tq?tqx=out:csv&gid=705507122'),
            fetchWithCache('https://docs.google.com/spreadsheets/d/1u94UMFj6E-W4xER1MjZZPlEZ7w6qsyj8z1bOQTarVig/gviz/tq?tqx=out:csv&gid=1466899718'),
            fetchWithCache('https://docs.google.com/spreadsheets/d/1l6mQ8-lIJvdXfJhYWy0-_5eZ09o3bnmu2VyVbJzG-Hs/gviz/tq?tqx=out:csv&gid=747633366')
        ]);
        console.log(`[${new Date().toLocaleTimeString()}] Đã tự động cập nhật ngầm CCCD, Lịch, Chấm công, Kỷ luật`);
    } catch (e) {}
}, CACHE_TTL_MS);

// CCCD Cache xử lý
let cccdMapCache = null;
let cccdMapCacheTime = 0;

async function getCccdMap() {
    const now = Date.now();
    if (cccdMapCache && (now - cccdMapCacheTime) < CACHE_TTL_MS) return cccdMapCache;
    
    const csvText = await fetchWithCache(CCCD_SHEET_URL);
    if (!csvText) return cccdMapCache || {};
    
    try {
        const lines = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < csvText.length; i++) {
            const ch = csvText[i];
            if (ch === '"') { inQuotes = !inQuotes; }
            else if (ch === '\n' && !inQuotes) { lines.push(current); current = ''; }
            else { current += ch; }
        }
        if (current) lines.push(current);
        
        const parseRow = (line) => {
            const cells = [];
            let cell = '';
            let q = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { q = !q; }
                else if (ch === ',' && !q) { cells.push(cell.trim()); cell = ''; }
                else { cell += ch; }
            }
            cells.push(cell.trim());
            return cells;
        };
        
        const map = {};
        for (let i = 1; i < lines.length; i++) {
            const row = parseRow(lines[i]);
            const empId = String(row[1] || '').trim();
            const cccd = String(row[2] || '').trim();
            if (empId && cccd) {
                map[empId] = cccd;
            }
        }
        
        cccdMapCache = map;
        cccdMapCacheTime = now;
        return map;
    } catch (e) {
        console.error('CCCD parse error:', e);
        return cccdMapCache || {};
    }
}

// 1. Employee Login API
app.post('/api/login', async (req, res) => {
    const { id, cccd } = req.body;
    
    try {
        const result = await pool.query("SELECT * FROM records WHERE emp_id = $1", [String(id)]);
        const rows = result.rows;
        
        if (rows.length > 0) {
            // Lấy CCCD từ Google Sheets
            const cccdMap = await getCccdMap();
            const correctCccd = cccdMap[String(id).trim()] || '123456';
            
            if (String(cccd) === correctCccd) {
                const safeRecords = rows.map(r => {
                    const obj = JSON.parse(r.data);
                    const { CCCD, CMND, cccd: _, ...safe } = obj;
                    return safe;
                });
                res.json({ success: true, user: safeRecords });
            } else {
                res.status(401).json({ success: false, message: 'Sai số Căn cước công dân (Mật khẩu)' });
            }
        } else {
            res.status(401).json({ success: false, message: 'Sai Mã nhân viên' });
        }
    } catch (err) {
        console.error('Login DB error:', err);
        res.status(500).json({ success: false, message: 'Lỗi truy vấn CSDL' });
    }
});

// 2. Admin Batch Upload API (nhận dữ liệu theo đợt nhỏ, không bị timeout)
app.post('/api/upload-batch', async (req, res) => {
    const { password, action, rows } = req.body;
    if (password !== 'admin123') {
        return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin' });
    }

    const client = await pool.connect();
    try {
        if (action === 'start') {
            // Đợt đầu tiên: xoá dữ liệu cũ
            await client.query('DELETE FROM records');
            adminCache = null;
        }

        if (rows && rows.length > 0) {
            // Batch insert bằng cách tạo multi-row VALUES
            const batchSize = 100;
            for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);
                const values = [];
                const params = [];
                batch.forEach((row, idx) => {
                    const offset = idx * 3;
                    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
                    params.push(row.emp_id, row.cccd, row.data);
                });
                await client.query(
                    `INSERT INTO records (emp_id, cccd, data) VALUES ${values.join(',')}`,
                    params
                );
            }
        }

        if (action === 'finish') {
            adminCache = null;
        }

        res.json({ success: true, message: `Đã nhận ${(rows || []).length} bản ghi` });
    } catch (err) {
        console.error('Batch upload error:', err);
        res.status(500).json({ success: false, message: 'Lỗi lưu CSDL: ' + err.message });
    } finally {
        client.release();
    }
});
// 2b. Import từ Google Drive URL (xử lý ngầm, không bị timeout 30s)
let importStatus = { status: 'idle', progress: 0, message: '', count: 0 };

app.post('/api/import-url', (req, res) => {
    const { password, url } = req.body;
    if (password !== 'admin123') {
        return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin' });
    }
    if (!url) {
        return res.status(400).json({ success: false, message: 'Thiếu link Google Drive' });
    }
    if (importStatus.status === 'running') {
        return res.json({ success: true, message: 'Import đang chạy, vui lòng đợi...' });
    }

    // Trả lời ngay lập tức, xử lý ngầm phía sau
    importStatus = { status: 'running', progress: 0, message: 'Đang tải file từ Google Drive...', count: 0 };
    res.json({ success: true, message: 'Bắt đầu import! Vui lòng đợi...' });

    // Xử lý ngầm
    processImport(url).catch(err => {
        console.error('Import background error:', err);
        importStatus = { status: 'error', progress: 0, message: 'Lỗi: ' + err.message, count: 0 };
    });
});

app.get('/api/import-status', (req, res) => {
    res.json(importStatus);
});

async function processImport(url) {
    // Chuyển Google Drive share link thành direct download link
    let downloadUrl = url;
    
    let match = url.match(/\/file\/d\/([^/]+)/);
    if (match) {
        downloadUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${match[1]}`;
    }
    match = url.match(/[?&]id=([^&]+)/);
    if (match && !downloadUrl.includes('uc?export')) {
        downloadUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${match[1]}`;
    }
    if (url.includes('docs.google.com/spreadsheets')) {
        const sheetMatch = url.match(/\/d\/([^/]+)/);
        if (sheetMatch) {
            downloadUrl = `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=csv&gid=0`;
        }
    }

    console.log('Importing from URL:', downloadUrl);
    importStatus.message = 'Đang tải file từ Google Drive...';

    const response = await fetch(downloadUrl, { 
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) {
        importStatus = { status: 'error', progress: 0, message: `Không tải được file (HTTP ${response.status}). Kiểm tra link và quyền chia sẻ!`, count: 0 };
        return;
    }

    const csvText = await response.text();
    const sizeMB = (csvText.length / 1024 / 1024).toFixed(1);
    console.log(`Downloaded CSV: ${sizeMB}MB`);
    importStatus.message = `Đã tải ${sizeMB}MB. Đang phân tích dữ liệu...`;
    importStatus.progress = 20;

    // Parse CSV
    const lines = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
        const ch = csvText[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if ((ch === '\n' || (ch === '\r' && csvText[i+1] !== '\n')) && !inQuotes) {
            if (current.trim()) lines.push(current);
            current = '';
        } else if (ch === '\r' && csvText[i+1] === '\n' && !inQuotes) {
            if (current.trim()) lines.push(current);
            current = '';
            i++;
        }
        else { current += ch; }
    }
    if (current.trim()) lines.push(current);

    if (lines.length < 2) {
        importStatus = { status: 'error', progress: 0, message: 'File CSV trống hoặc không đọc được', count: 0 };
        return;
    }

    const parseRow = (line) => {
        const cells = [];
        let cell = '';
        let q = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { q = !q; }
            else if (ch === ',' && !q) { cells.push(cell.trim()); cell = ''; }
            else { cell += ch; }
        }
        cells.push(cell.trim());
        return cells;
    };

    const headers = parseRow(lines[0]);
    const idIdx = headers.findIndex(h => h.toLowerCase() === 'id' || h.toLowerCase() === 'textid' || h.toLowerCase().includes('mã nv') || h.toLowerCase().includes('mã nhân viên'));
    const cccdIdx = headers.findIndex(h => h.toLowerCase() === 'cccd' || h.toLowerCase() === 'cmnd');

    importStatus.message = `Đang lưu ${(lines.length - 1).toLocaleString()} dòng vào CSDL...`;
    importStatus.progress = 40;

    const client = await pool.connect();
    try {
        await client.query('DELETE FROM records');
        adminCache = null;

        let totalInserted = 0;
        const BATCH = 500;
        const totalLines = lines.length - 1;
        
        for (let i = 1; i < lines.length; i += BATCH) {
            const values = [];
            const params = [];
            let paramIdx = 0;

            for (let j = i; j < Math.min(i + BATCH, lines.length); j++) {
                const cells = parseRow(lines[j]);
                const emp_id = idIdx >= 0 ? (cells[idIdx] || '').trim() : '';
                if (!emp_id) continue;

                const cccd = cccdIdx >= 0 ? (cells[cccdIdx] || '123456').trim() : '123456';
                const obj = {};
                headers.forEach((h, idx) => { obj[h] = cells[idx] || ''; });

                values.push(`($${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3})`);
                params.push(emp_id, cccd, JSON.stringify(obj));
                paramIdx += 3;
                totalInserted++;
            }

            if (values.length > 0) {
                await client.query(
                    `INSERT INTO records (emp_id, cccd, data) VALUES ${values.join(',')}`,
                    params
                );
            }

            const progress = 40 + Math.round(((i - 1) / totalLines) * 55);
            importStatus = { status: 'running', progress, message: `Đang lưu... ${totalInserted.toLocaleString()} / ${totalLines.toLocaleString()} dòng`, count: totalInserted };
        }

        adminCache = null;
        console.log(`Import complete: ${totalInserted} records`);
        importStatus = { status: 'done', progress: 100, message: `✅ Import thành công! ${totalInserted.toLocaleString()} bản ghi`, count: totalInserted };
    } catch (dbErr) {
        console.error('Import DB error:', dbErr);
        importStatus = { status: 'error', progress: 0, message: 'Lỗi lưu CSDL: ' + dbErr.message, count: 0 };
    } finally {
        client.release();
    }
}


// 3. Schedule API - Lấy lịch làm việc từ Google Sheets
const SCHEDULE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1n6pRyTVUTKoZ1sm7Sf6fBeZKtPkJ4EngXjIqj_yTyLo/gviz/tq?tqx=out:csv&gid=705507122';

app.get('/api/schedule', async (req, res) => {
    const empId = String(req.query.id || '').trim();
    if (!empId) return res.status(400).json({ success: false, message: 'Thiếu mã NV' });
    
    try {
        const csvText = await fetchWithCache(SCHEDULE_SHEET_URL);
        if (!csvText) return res.status(500).json({ success: false, message: 'Lỗi tải lịch làm việc' });
        
        // Parse CSV thủ công (vì dữ liệu có dấu phẩy trong quoted fields)
        const rows = [];
        let current = '';
        let inQuotes = false;
        const lines = [];
        
        for (let i = 0; i < csvText.length; i++) {
            const ch = csvText[i];
            if (ch === '"') { inQuotes = !inQuotes; }
            else if (ch === '\n' && !inQuotes) { lines.push(current); current = ''; }
            else { current += ch; }
        }
        if (current) lines.push(current);
        
        // Parse mỗi dòng thành array cells
        const parseRow = (line) => {
            const cells = [];
            let cell = '';
            let q = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { q = !q; }
                else if (ch === ',' && !q) { cells.push(cell.trim()); cell = ''; }
                else { cell += ch; }
            }
            cells.push(cell.trim());
            return cells;
        };
        
        const allRows = lines.map(l => parseRow(l));
        
        // Dòng 2 (index 1) chứa header ngày: "", "", "", "HỌ TÊN", "13/10/2025", "14/10/2025", ...
        const headerRow = allRows[1] || [];
        
        // Tìm nhân viên theo mã NV (cột index 2)
        let empRow = null;
        for (let i = 3; i < allRows.length; i++) {
            const row = allRows[i];
            if (row[2] && String(row[2]).trim() === empId) {
                empRow = row;
                break;
            }
        }
        
        if (!empRow) {
            return res.json({ success: true, schedule: [], message: 'Không tìm thấy lịch cho mã NV này' });
        }
        
        // Ghép header ngày + giá trị ca làm
        const schedule = [];
        for (let col = 4; col < headerRow.length && col < empRow.length; col++) {
            const dateStr = headerRow[col];
            const shift = empRow[col];
            // Chỉ lấy những cột có ngày hợp lệ (dd/mm/yyyy)
            if (dateStr && /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr) && shift) {
                schedule.push({ date: dateStr, shift: shift });
            }
        }
        
        res.json({ success: true, schedule, name: empRow[3] || '' });
        
    } catch (error) {
        console.error('Schedule fetch error:', error);
        res.status(500).json({ success: false, message: 'Lỗi tải lịch từ Google Sheets' });
    }
});

// 4. Attendance API - Đếm ngày công thực tế từ Google Sheets
const ATTENDANCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1u94UMFj6E-W4xER1MjZZPlEZ7w6qsyj8z1bOQTarVig/gviz/tq?tqx=out:csv&gid=1466899718';

app.get('/api/attendance', async (req, res) => {
    const empId = String(req.query.id || '').trim();
    const filterMonth = String(req.query.month || '').trim(); // format: "6/2026"
    if (!empId) return res.status(400).json({ success: false, message: 'Thiếu mã NV' });
    
    try {
        const csvText = await fetchWithCache(ATTENDANCE_SHEET_URL);
        if (!csvText) return res.status(500).json({ success: false, message: 'Lỗi tải dữ liệu chấm công' });
        
        // Parse CSV
        const lines = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < csvText.length; i++) {
            const ch = csvText[i];
            if (ch === '"') { inQuotes = !inQuotes; }
            else if (ch === '\n' && !inQuotes) { lines.push(current); current = ''; }
            else { current += ch; }
        }
        if (current) lines.push(current);
        
        const parseRow = (line) => {
            const cells = [];
            let cell = '';
            let q = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { q = !q; }
                else if (ch === ',' && !q) { cells.push(cell.trim()); cell = ''; }
                else { cell += ch; }
            }
            cells.push(cell.trim());
            return cells;
        };
        
        // Parse tháng cần lọc
        let targetMonth = null;
        let targetYear = null;
        if (filterMonth) {
            const mp = filterMonth.split('/');
            targetMonth = parseInt(mp[0]); // 1-indexed
            targetYear = parseInt(mp[1]);
        }
        
        // Đếm ngày chấm công: lọc theo mã NV (cột index 3), đếm ngày unique (cột index 2)
        const workDays = new Set();
        
        for (let i = 0; i < lines.length; i++) {
            const row = parseRow(lines[i]);
            if (row[3] && String(row[3]).trim() === empId && row[2]) {
                const dateStr = String(row[2]).trim();
                
                // Lọc theo tháng nếu có (format: "1/6/2026" → ngày/tháng/năm)
                if (targetMonth && targetYear) {
                    const parts = dateStr.split('/');
                    if (parts.length >= 3) {
                        const m = parseInt(parts[1]);
                        const y = parseInt(parts[2]);
                        if (m !== targetMonth || y !== targetYear) continue;
                    }
                }
                
                workDays.add(dateStr);
            }
        }
        
        res.json({ 
            success: true, 
            totalDays: workDays.size,
            dates: Array.from(workDays)
        });
        
    } catch (error) {
        console.error('Attendance fetch error:', error);
        res.status(500).json({ success: false, message: 'Lỗi tải chấm công' });
    }
});

// 5. Discipline API - Đi trễ & Off đột xuất
const DISCIPLINE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1l6mQ8-lIJvdXfJhYWy0-_5eZ09o3bnmu2VyVbJzG-Hs/gviz/tq?tqx=out:csv&gid=747633366';

app.get('/api/discipline', async (req, res) => {
    const empId = String(req.query.id || '').trim();
    if (!empId) return res.status(400).json({ success: false, message: 'Thiếu mã NV' });
    
    try {
        const csvText = await fetchWithCache(DISCIPLINE_SHEET_URL);
        if (!csvText) return res.status(500).json({ success: false, message: 'Lỗi tải dữ liệu kỷ luật' });
        
        const lines = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < csvText.length; i++) {
            const ch = csvText[i];
            if (ch === '"') { inQuotes = !inQuotes; }
            else if (ch === '\n' && !inQuotes) { lines.push(current); current = ''; }
            else { current += ch; }
        }
        if (current) lines.push(current);
        
        const parseRow = (line) => {
            const cells = [];
            let cell = '';
            let q = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { q = !q; }
                else if (ch === ',' && !q) { cells.push(cell.trim()); cell = ''; }
                else { cell += ch; }
            }
            cells.push(cell.trim());
            return cells;
        };
        
        const lateList = [];
        const offList = [];
        
        // Chỉ lấy dữ liệu tháng hiện tại
        const now = new Date();
        const currentMonth = now.getMonth(); // 0-indexed
        const currentYear = now.getFullYear();
        
        for (let i = 1; i < lines.length; i++) {
            const row = parseRow(lines[i]);
            if (row[1] && String(row[1]).trim() === empId) {
                // Lọc theo tháng hiện tại: format "2026-06-01 06:44:15"
                const timeStr = String(row[0] || '').trim();
                if (timeStr) {
                    const d = new Date(timeStr);
                    if (d.getMonth() !== currentMonth || d.getFullYear() !== currentYear) {
                        continue; // Bỏ qua tháng cũ
                    }
                }
                
                const action = String(row[2] || '').trim();
                const entry = {
                    time: row[0] || '',
                    action: action,
                    reason: row[3] || ''
                };
                if (action.toLowerCase().includes('trễ')) {
                    lateList.push(entry);
                } else if (action.toLowerCase().includes('off')) {
                    offList.push(entry);
                }
            }
        }
        
        res.json({
            success: true,
            lateCount: lateList.length,
            offCount: offList.length,
            lateList,
            offList
        });
        
    } catch (error) {
        console.error('Discipline fetch error:', error);
        res.status(500).json({ success: false, message: 'Lỗi tải dữ liệu kỷ luật' });
    }
});

let adminCache = null;

// 6. Admin Summary API
app.post('/api/admin/summary', async (req, res) => {
    const { password, department, shift } = req.body;
    if (password !== 'admin123') {
        return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin' });
    }
    
    // Hàm xử lý lọc từ cache
    const processFilters = () => {
        const empMap = {};
        const availableDepartments = new Set();
        const availableShifts = new Set();
        
        adminCache.forEach(rec => {
            if (rec.dept) availableDepartments.add(rec.dept);
            if (rec.shift) availableShifts.add(rec.shift);
            
            // Lọc
            if (department && department !== 'all' && rec.dept !== department) return;
            if (shift && shift !== 'all' && rec.shift !== shift) return;
            
            const empId = rec.empId;
            if (!empMap[empId]) {
                empMap[empId] = {
                    id: empId,
                    name: rec.name,
                    totalQty: 0,
                    totalSalary: 0,
                    days: new Set()
                };
            }
            
            empMap[empId].totalQty += rec.qty;
            empMap[empId].totalSalary += rec.salary;
            if (rec.date) {
                empMap[empId].days.add(rec.date);
            }
        });
        
        // Convert to array & sort
        const employees = Object.values(empMap).map(e => ({
            id: e.id,
            name: e.name,
            totalQty: e.totalQty,
            salary: e.totalSalary,
            days: e.days.size
        })).sort((a, b) => b.totalQty - a.totalQty);
        
        const totalEmployees = employees.length;
        const totalProduction = employees.reduce((sum, e) => sum + e.totalQty, 0);
        const avgProduction = totalEmployees > 0 ? Math.round(totalProduction / totalEmployees) : 0;
        const totalSalary = employees.reduce((sum, e) => sum + e.salary, 0);
        
        res.json({
            success: true,
            totalEmployees,
            totalProduction,
            avgProduction,
            totalSalary,
            employees,
            departments: Array.from(availableDepartments).sort(),
            shifts: Array.from(availableShifts).sort()
        });
    };
    
    if (adminCache) {
        return processFilters();
    }
    
    // Cache miss: load từ DB (PostgreSQL)
    try {
        const result = await pool.query("SELECT emp_id, data FROM records");
        const rows = result.rows;
        
        adminCache = [];
        
        rows.forEach(r => {
            const obj = JSON.parse(r.data);
            const keys = Object.keys(obj);
            
            const deptKey = keys.find(k => k.toLowerCase().includes('bộ phận'));
            const shiftKey = keys.find(k => k.toLowerCase().includes('ca làm'));
            const nameKey = keys.find(k => k.toLowerCase().includes('nhân viên') || k.toLowerCase().includes('họ tên') || k.toLowerCase().includes('tên'));
            const qtyKey = keys.find(k => k.toLowerCase().includes('sản lượng') || k.toLowerCase().includes('stop') || k.toLowerCase().includes('số lượng'));
            const salaryKey = keys.find(k => k.toLowerCase().includes('thu nhập'));
            const dateKey = keys.find(k => k.toLowerCase().includes('ngày') || k.toLowerCase().includes('date'));
            
            const rec = {
                empId: r.emp_id,
                name: nameKey ? obj[nameKey] : r.emp_id,
                dept: deptKey ? String(obj[deptKey]).trim() : '',
                shift: shiftKey ? String(obj[shiftKey]).trim() : '',
                qty: 0,
                salary: 0,
                date: dateKey ? String(obj[dateKey]).trim() : ''
            };
            
            if (qtyKey) {
                const raw = String(obj[qtyKey] || '0').replace(/,/g, '');
                rec.qty = parseFloat(raw) || 0;
            }
            if (salaryKey) {
                const raw = String(obj[salaryKey] || '0').replace(/,/g, '');
                rec.salary = parseFloat(raw) || 0;
            }
            
            adminCache.push(rec);
        });
        
        processFilters();
    } catch (err) {
        console.error('Admin summary DB error:', err);
        res.status(500).json({ success: false, message: 'Lỗi CSDL' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`PostgreSQL Cloud Server - Ready for Render.com deployment`);
});
