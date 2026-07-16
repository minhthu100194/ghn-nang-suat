const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const XLSX = require('xlsx');

// ─── App & Database Setup ────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
});

async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS records (
                id SERIAL PRIMARY KEY,
                emp_id TEXT,
                cccd TEXT,
                data TEXT
            );
            CREATE TABLE IF NOT EXISTS monthly_salary (
                id SERIAL PRIMARY KEY,
                emp_id TEXT,
                data TEXT
            );
            CREATE TABLE IF NOT EXISTS admin_cache (
                id INTEGER PRIMARY KEY DEFAULT 1,
                summary TEXT
            );
        `);
        console.log('PostgreSQL: Tables ready');
    } catch (err) {
        console.error('PostgreSQL init error:', err);
    }
}
initDB();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Version check endpoint
app.get('/api/version', (req, res) => res.json({ version: 'v10-raw-upload', deployed: new Date().toISOString() }));

// No-cache headers for all responses
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Google Sheets URLs ──────────────────────────────────────────────────────

const SHEET_URLS = {
    CCCD:       'https://docs.google.com/spreadsheets/d/1l6mQ8-lIJvdXfJhYWy0-_5eZ09o3bnmu2VyVbJzG-Hs/gviz/tq?tqx=out:csv&gid=1803813137',
    SCHEDULE:   'https://docs.google.com/spreadsheets/d/1n6pRyTVUTKoZ1sm7Sf6fBeZKtPkJ4EngXjIqj_yTyLo/gviz/tq?tqx=out:csv&gid=705507122',
    ATTENDANCE: 'https://docs.google.com/spreadsheets/d/1u94UMFj6E-W4xER1MjZZPlEZ7w6qsyj8z1bOQTarVig/gviz/tq?tqx=out:csv&gid=1466899718',
    DISCIPLINE: 'https://docs.google.com/spreadsheets/d/1l6mQ8-lIJvdXfJhYWy0-_5eZ09o3bnmu2VyVbJzG-Hs/gviz/tq?tqx=out:csv&gid=747633366'
};

// ─── CSV Parser ──────────────────────────────────────────────────────────────

function parseCSVText(text) {
    if (!text) return [];

    const rows = [];
    let currentLine = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === '\r' && !inQuotes) {
            // Handle \r\n or standalone \r
            if (text[i + 1] === '\n') i++;
            if (currentLine.length > 0) rows.push(parseCSVRow(currentLine));
            currentLine = '';
        } else if (ch === '\n' && !inQuotes) {
            if (currentLine.length > 0) rows.push(parseCSVRow(currentLine));
            currentLine = '';
        } else {
            currentLine += ch;
        }
    }
    if (currentLine.length > 0) rows.push(parseCSVRow(currentLine));

    return rows;
}

function parseCSVRow(line) {
    const cells = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            cells.push(cell.trim());
            cell = '';
        } else {
            cell += ch;
        }
    }
    cells.push(cell.trim());
    return cells;
}

// ─── Caching Layer ───────────────────────────────────────────────────────────

const sheetCache = {};
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

async function fetchWithCache(url) {
    const now = Date.now();
    const cached = sheetCache[url];

    if (cached && (now - cached.time < CACHE_TTL_MS)) {
        return cached.data;
    }

    try {
        const response = await fetch(url);
        const text = await response.text();
        sheetCache[url] = { data: text, time: now };
        return text;
    } catch (err) {
        console.error('Fetch error:', url, err.message);
        return cached ? cached.data : null;
    }
}

// CCCD map cache (employee ID → CCCD number)
let cccdMapCache = null;
let cccdMapCacheTime = 0;

async function getCccdMap() {
    const now = Date.now();
    if (cccdMapCache && (now - cccdMapCacheTime) < CACHE_TTL_MS) return cccdMapCache;

    const csvText = await fetchWithCache(SHEET_URLS.CCCD);
    if (!csvText) return cccdMapCache || {};

    try {
        const rows = parseCSVText(csvText);
        const map = {};

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const empId = String(row[1] || '').trim();
            const cccd = String(row[2] || '').trim();
            if (empId && cccd) {
                map[empId] = cccd;
            }
        }

        cccdMapCache = map;
        cccdMapCacheTime = now;
        return map;
    } catch (err) {
        console.error('CCCD parse error:', err);
        return cccdMapCache || {};
    }
}

// Admin cache (parsed records for dashboard, cleared on new upload)
let adminCache = null;

// Background auto-updater: refresh all Google Sheets caches every 5 minutes
setInterval(async () => {
    try {
        await Promise.all(Object.values(SHEET_URLS).map(url => fetchWithCache(url)));
        console.log(`[${new Date().toLocaleTimeString()}] Background cache refresh complete`);
    } catch (err) {
        console.error('Background cache refresh error:', err.message);
    }
}, 5 * 60 * 1000);

// ─── API 1: Employee Login ───────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
    const { id, cccd } = req.body;

    try {
        const result = await pool.query('SELECT * FROM records WHERE emp_id = $1', [String(id)]);
        const rows = result.rows;

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Sai Mã nhân viên' });
        }

        // Validate CCCD against Google Sheets map
        const cccdMap = await getCccdMap();
        const correctCccd = cccdMap[String(id).trim()] || '123456';

        if (String(cccd) !== correctCccd) {
            return res.status(401).json({ success: false, message: 'Sai số Căn cước công dân (Mật khẩu)' });
        }

        // Fetch monthly salary data if exists
        let salaryData = null;
        try {
            const salaryResult = await pool.query('SELECT data FROM monthly_salary WHERE emp_id = $1', [String(id)]);
            if (salaryResult.rows.length > 0) {
                // There should only be one salary row per employee per month, but we'll take the first
                salaryData = JSON.parse(salaryResult.rows[0].data);
            }
        } catch (e) {
            console.error('Error fetching monthly salary:', e);
        }

        res.json({ success: true, user: safeRecords, salaryData });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Lỗi truy vấn CSDL' });
    }
});

// ─── API 2: Admin Batch Upload ───────────────────────────────────────────────

// In-memory accumulator for building admin summary during upload
let uploadAccumulator = null;

app.post('/api/upload-batch', async (req, res) => {
    const { password, action, rows } = req.body;

    if (password !== 'admin123') {
        return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin' });
    }

    const client = await pool.connect();
    try {
        // On 'start': wipe old data and init accumulator
        if (action === 'start') {
            await client.query('DELETE FROM records');
            adminCache = null;
            uploadAccumulator = { empMap: {}, departments: new Set(), shifts: new Set(), keysDone: false };
            console.log('[Upload] Started — old records deleted');
        }

        // Insert rows and accumulate summary
        if (rows && rows.length > 0) {
            const BATCH_SIZE = 100;
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);
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

            // Accumulate admin summary from upload data (already in memory!)
            if (uploadAccumulator && rows.length > 0) {
                // Detect keys from first row if not done yet
                if (!uploadAccumulator.keysDone) {
                    try {
                        const obj0 = JSON.parse(rows[0].data);
                        const keys = Object.keys(obj0);
                        const find = (...patterns) => keys.find(k => patterns.some(p => k.toLowerCase().includes(p)));
                        uploadAccumulator.kDept = find('bộ phận');
                        uploadAccumulator.kShift = find('ca làm');
                        uploadAccumulator.kName = find('nhân viên', 'họ tên', 'tên');
                        uploadAccumulator.kQty = find('sản lượng', 'stop', 'số lượng');
                        uploadAccumulator.kDate = find('ngày', 'date');
                        uploadAccumulator.keysDone = true;
                    } catch (e) {}
                }

                const { empMap, departments, shifts, kDept, kShift, kName, kQty, kDate } = uploadAccumulator;
                for (const row of rows) {
                    try {
                        const obj = JSON.parse(row.data);
                        const empId = row.emp_id;
                        if (!empId) continue;

                        const dept = (obj[kDept] || '').trim();
                        const shiftVal = (obj[kShift] || '').trim();
                        const name = (obj[kName] || empId).toString().trim();
                        let qty = obj[kQty] ? parseFloat(String(obj[kQty]).replace(/[^0-9.-]/g, '')) || 0 : 0;
                        const dateStr = (obj[kDate] || '').trim();

                        if (dept) departments.add(dept);
                        if (shiftVal) shifts.add(shiftVal);

                        if (!empMap[empId]) {
                            empMap[empId] = { id: empId, name, dept, shift: shiftVal, totalQty: 0, totalSalary: 0, daysSet: new Set() };
                        }
                        empMap[empId].totalQty += qty;
                        if (dateStr) empMap[empId].daysSet.add(dateStr);
                    } catch (e) {}
                }
            }
        }

        // On 'finish': save admin summary to database
        if (action === 'finish' && uploadAccumulator) {
            const { empMap, departments, shifts } = uploadAccumulator;
            // Convert Sets to counts
            for (const empId in empMap) {
                empMap[empId].daysCount = empMap[empId].daysSet.size;
                delete empMap[empId].daysSet;
            }
            const summaryObj = {
                empMap,
                departments: Array.from(departments).sort(),
                shifts: Array.from(shifts).sort()
            };
            // Save to DB
            await client.query(
                `INSERT INTO admin_cache (id, summary) VALUES (1, $1)
                 ON CONFLICT (id) DO UPDATE SET summary = $1`,
                [JSON.stringify(summaryObj)]
            );
            adminCache = summaryObj;
            uploadAccumulator = null;
            console.log(`[Upload] Finished — admin summary saved (${Object.keys(empMap).length} employees)`);
        }

        res.json({ success: true, message: `Đã nhận ${(rows || []).length} bản ghi` });
    } catch (err) {
        console.error('Batch upload error:', err);
        res.status(500).json({ success: false, message: 'Lỗi lưu CSDL: ' + err.message });
    } finally {
        client.release();
    }
});

// ─── API 2b: Admin Salary Batch Upload ───────────────────────────────────────

app.post('/api/upload-salary-batch', async (req, res) => {
    const { password, action, rows } = req.body;

    if (password !== 'admin123') {
        return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin' });
    }

    const client = await pool.connect();
    try {
        if (action === 'start') {
            await client.query('DELETE FROM monthly_salary');
            console.log('[Upload Salary] Started — old records deleted');
        }

        if (rows && rows.length > 0) {
            const BATCH_SIZE = 100;
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);
                const values = [];
                const params = [];

                batch.forEach((row, idx) => {
                    const offset = idx * 2;
                    values.push(`($${offset + 1}, $${offset + 2})`);
                    params.push(row.emp_id, row.data);
                });

                await client.query(
                    `INSERT INTO monthly_salary (emp_id, data) VALUES ${values.join(',')}`,
                    params
                );
            }
        }

        if (action === 'finish') {
            console.log('[Upload Salary] Finished');
        }

        res.json({ success: true, message: `Đã nhận ${(rows || []).length} bản ghi lương tháng` });
    } catch (err) {
        console.error('Salary batch upload error:', err);
        res.status(500).json({ success: false, message: 'Lỗi lưu CSDL lương tháng: ' + err.message });
    } finally {
        client.release();
    }
});

// ─── API 2c: Server-side Excel Salary Upload ─────────────────────────────────

const rawParser = express.raw({ type: 'application/octet-stream', limit: '100mb' });

app.post('/api/upload-salary-file', rawParser, async (req, res) => {
    const password = req.query.password;
    if (password !== 'admin123') {
        return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin' });
    }
    if (!req.body || req.body.length === 0) {
        return res.status(400).json({ success: false, message: 'Không tìm thấy file' });
    }

    try {
        console.log('[Salary Upload] Parsing Excel file:', req.body.length, 'bytes');
        const workbook = XLSX.read(req.body, { type: 'buffer' });
        
        // Find salary sheet
        const sheetName = workbook.SheetNames.find(n => 
            n.toLowerCase().includes('lương') || n.toLowerCase().includes('luong') || 
            n.toLowerCase().includes('tổng hợp') || n.toLowerCase().includes('tong hop')
        ) || workbook.SheetNames[0];
        
        console.log('[Salary Upload] Using sheet:', sheetName);
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Find header row (look for 'ID' column in first 15 rows)
        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(15, jsonData.length); i++) {
            const row = jsonData[i];
            if (row && row.some(c => String(c).toUpperCase() === 'ID')) {
                headerRowIndex = i;
                break;
            }
        }
        
        if (headerRowIndex === -1) {
            return res.status(400).json({ success: false, message: 'Không tìm thấy dòng tiêu đề có cột ID trong sheet ' + sheetName });
        }
        
        // Parse rows from header
        const rows = XLSX.utils.sheet_to_json(worksheet, { range: headerRowIndex });
        const records = [];
        rows.forEach(obj => {
            const keys = Object.keys(obj);
            const idKey = keys.find(k => ['id', 'mã nv', 'mã nhân viên', 'textid'].includes(k.toLowerCase()));
            if (idKey && obj[idKey]) {
                records.push({
                    emp_id: String(obj[idKey]).trim(),
                    data: JSON.stringify(obj)
                });
            }
        });
        
        if (records.length === 0) {
            return res.status(400).json({ success: false, message: 'Không tìm thấy dữ liệu hợp lệ (cần cột ID/Mã NV)' });
        }
        
        console.log('[Salary Upload] Found', records.length, 'records. Inserting...');
        
        // Insert into DB
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM monthly_salary');
            
            const BATCH_SIZE = 100;
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
                const batch = records.slice(i, i + BATCH_SIZE);
                const values = [];
                const params = [];
                batch.forEach((row, idx) => {
                    const offset = idx * 2;
                    values.push(`($${offset + 1}, $${offset + 2})`);
                    params.push(row.emp_id, row.data);
                });
                await client.query(`INSERT INTO monthly_salary (emp_id, data) VALUES ${values.join(',')}`, params);
            }
            
            console.log('[Salary Upload] Done!', records.length, 'records saved');
            res.json({ success: true, message: 'Tải lên thành công! Đã lưu ' + records.length + ' nhân viên.', count: records.length });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('[Salary Upload] Error:', err);
        res.status(500).json({ success: false, message: 'Lỗi xử lý file: ' + err.message });
    }
});

// ─── API 3: Employee Schedule ────────────────────────────────────────────────

app.get('/api/schedule', async (req, res) => {
    const empId = String(req.query.id || '').trim();
    if (!empId) return res.status(400).json({ success: false, message: 'Thiếu mã NV' });

    try {
        const csvText = await fetchWithCache(SHEET_URLS.SCHEDULE);
        if (!csvText) return res.status(500).json({ success: false, message: 'Lỗi tải lịch làm việc' });

        const allRows = parseCSVText(csvText);
        const headerRow = allRows[1] || []; // Row index 1 has date headers

        // Find employee by ID in column index 2
        let empRow = null;
        for (let i = 3; i < allRows.length; i++) {
            if (allRows[i][2] && String(allRows[i][2]).trim() === empId) {
                empRow = allRows[i];
                break;
            }
        }

        if (!empRow) {
            return res.json({ success: true, schedule: [], message: 'Không tìm thấy lịch cho mã NV này' });
        }

        // Build date+shift pairs from column 4 onwards
        const schedule = [];
        for (let col = 4; col < headerRow.length && col < empRow.length; col++) {
            const dateStr = headerRow[col];
            const shift = empRow[col];
            if (dateStr && /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr) && shift) {
                schedule.push({ date: dateStr, shift });
            }
        }

        res.json({ success: true, schedule, name: empRow[3] || '' });
    } catch (err) {
        console.error('Schedule error:', err);
        res.status(500).json({ success: false, message: 'Lỗi tải lịch từ Google Sheets' });
    }
});

// ─── API 4: Attendance ───────────────────────────────────────────────────────

app.get('/api/attendance', async (req, res) => {
    const empId = String(req.query.id || '').trim();
    const filterMonth = String(req.query.month || '').trim(); // "MM/YYYY" or "M/YYYY"
    if (!empId) return res.status(400).json({ success: false, message: 'Thiếu mã NV' });

    try {
        const csvText = await fetchWithCache(SHEET_URLS.ATTENDANCE);
        if (!csvText) return res.status(500).json({ success: false, message: 'Lỗi tải dữ liệu chấm công' });

        const allRows = parseCSVText(csvText);

        // Parse target month/year if provided
        let targetMonth = null;
        let targetYear = null;
        if (filterMonth) {
            const parts = filterMonth.split('/');
            targetMonth = parseInt(parts[0]); // 1-indexed month
            targetYear = parseInt(parts[1]);
        }

        // Count unique work days: employee ID in column 3, date in column 2
        const workDays = new Set();

        for (let i = 0; i < allRows.length; i++) {
            const row = allRows[i];
            if (row[3] && String(row[3]).trim() === empId && row[2]) {
                const dateStr = String(row[2]).trim();

                // Filter by month if specified (date format: "d/m/yyyy")
                if (targetMonth && targetYear) {
                    const dateParts = dateStr.split('/');
                    if (dateParts.length >= 3) {
                        const m = parseInt(dateParts[1]);
                        const y = parseInt(dateParts[2]);
                        if (m !== targetMonth || y !== targetYear) continue;
                    }
                }

                workDays.add(dateStr);
            }
        }

        res.json({ success: true, totalDays: workDays.size, dates: Array.from(workDays) });
    } catch (err) {
        console.error('Attendance error:', err);
        res.status(500).json({ success: false, message: 'Lỗi tải chấm công' });
    }
});

// ─── API 5: Discipline (Late / Unplanned Off) ───────────────────────────────

app.get('/api/discipline', async (req, res) => {
    const empId = String(req.query.id || '').trim();
    if (!empId) return res.status(400).json({ success: false, message: 'Thiếu mã NV' });

    try {
        const csvText = await fetchWithCache(SHEET_URLS.DISCIPLINE);
        if (!csvText) return res.status(500).json({ success: false, message: 'Lỗi tải dữ liệu kỷ luật' });

        const allRows = parseCSVText(csvText);

        const now = new Date();
        const currentMonth = now.getMonth(); // 0-indexed
        const currentYear = now.getFullYear();

        const lateList = [];
        const offList = [];

        for (let i = 1; i < allRows.length; i++) {
            const row = allRows[i];
            if (!row[1] || String(row[1]).trim() !== empId) continue;

            // Filter to current month only (date format: "YYYY-MM-DD HH:MM:SS")
            const timeStr = String(row[0] || '').trim();
            if (timeStr) {
                const d = new Date(timeStr);
                if (d.getMonth() !== currentMonth || d.getFullYear() !== currentYear) continue;
            }

            const action = String(row[2] || '').trim();
            const entry = { time: row[0] || '', action, reason: row[3] || '' };

            if (action.toLowerCase().includes('trễ')) {
                lateList.push(entry);
            } else if (action.toLowerCase().includes('off')) {
                offList.push(entry);
            }
        }

        res.json({
            success: true,
            lateCount: lateList.length,
            offCount: offList.length,
            lateList,
            offList
        });
    } catch (err) {
        console.error('Discipline error:', err);
        res.status(500).json({ success: false, message: 'Lỗi tải dữ liệu kỷ luật' });
    }
});

function getFilteredResponse(department, shift) {
    const { empMap, departments, shifts: shiftsList } = adminCache;
    const employees = Object.values(empMap)
        .filter(e => {
            if (department && department !== 'all' && e.dept !== department) return false;
            if (shift && shift !== 'all' && e.shift !== shift) return false;
            return true;
        })
        .map(e => ({
            id: e.id, name: e.name,
            totalQty: e.totalQty, salary: e.totalSalary || 0,
            days: e.daysCount
        }))
        .sort((a, b) => b.totalQty - a.totalQty);

    const totalEmployees = employees.length;
    const totalProduction = employees.reduce((sum, e) => sum + e.totalQty, 0);

    return {
        success: true,
        totalEmployees,
        totalProduction,
        avgProduction: totalEmployees > 0 ? Math.round(totalProduction / totalEmployees) : 0,
        totalSalary: employees.reduce((sum, e) => sum + e.salary, 0),
        employees,
        departments,
        shifts: shiftsList
    };
}

app.post('/api/admin/summary', async (req, res) => {
    const { password, department, shift } = req.body;

    if (password !== 'admin123') {
        return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin' });
    }

    // If cache in memory, use it
    if (adminCache) {
        return res.json(getFilteredResponse(department, shift));
    }

    // Try loading from admin_cache table (pre-computed during upload)
    try {
        const result = await pool.query('SELECT summary FROM admin_cache WHERE id = 1');
        if (result.rows.length > 0 && result.rows[0].summary) {
            adminCache = JSON.parse(result.rows[0].summary);
            console.log('[Admin] Loaded cached summary:', Object.keys(adminCache.empMap || {}).length, 'employees');
            return res.json(getFilteredResponse(department, shift));
        }
    } catch (err) {
        console.error('[Admin] Error loading cached summary:', err.message);
    }

    // No cached data
    return res.json({
        success: true,
        totalEmployees: 0,
        totalProduction: 0,
        avgProduction: 0,
        totalSalary: 0,
        employees: [],
        departments: [],
        shifts: [],
        message: 'Chưa có dữ liệu tổng hợp. Vui lòng upload lại file CSV năng suất để tạo bảng tổng hợp.'
    });
});

// ─── Start Server ────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log('PostgreSQL Cloud Server — Ready for Render.com deployment');
});
