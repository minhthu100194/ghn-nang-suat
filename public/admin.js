const loginEl = document.getElementById('admin-login');
const dashEl = document.getElementById('admin-dashboard');
const form = document.getElementById('admin-form');
const passInput = document.getElementById('admin-pass');
const errorEl = document.getElementById('admin-error');

let adminPass = '';

// === LOGIN ===
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    adminPass = passInput.value;
    errorEl.classList.add('hidden');
    
    try {
        const res = await fetch('/api/admin/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPass })
        });
        const data = await res.json();
        
        if (data.success) {
            loginEl.classList.add('hidden');
            dashEl.classList.remove('hidden');
            renderDashboard(data);
        } else {
            errorEl.textContent = data.message;
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.textContent = 'Lỗi kết nối server';
        errorEl.classList.remove('hidden');
    }
});

document.getElementById('admin-logout').addEventListener('click', () => {
    dashEl.classList.add('hidden');
    loginEl.classList.remove('hidden');
    passInput.value = '';
    adminPass = '';
});

// === RENDER DASHBOARD ===
let allEmployees = [];
let initialLoad = true;

const deptSelect = document.getElementById('filter-dept');
const shiftSelect = document.getElementById('filter-shift');

async function fetchDashboardData() {
    try {
        const payload = { 
            password: adminPass,
            department: deptSelect.value,
            shift: shiftSelect.value
        };
        
        const res = await fetch('/api/admin/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success && data.loading) {
            // Server đang xử lý dữ liệu, tự retry sau 5 giây
            document.getElementById('stat-total').textContent = '⏳';
            document.getElementById('stat-production').textContent = 'Đang tải...';
            document.getElementById('stat-avg').textContent = '...';
            document.getElementById('stat-salary').textContent = '...';
            setTimeout(() => fetchDashboardData(), 5000);
            return;
        }
        
        if (data.success) {
            renderDashboard(data);
        } else {
            alert('Lỗi tải dữ liệu: ' + data.message);
        }
    } catch (err) {
        console.error('Lỗi khi fetch dashboard data', err);
    }
}

deptSelect.addEventListener('change', fetchDashboardData);
shiftSelect.addEventListener('change', fetchDashboardData);

function renderDashboard(data) {
    allEmployees = data.employees;
    
    // Stats
    document.getElementById('s-emp').textContent = data.totalEmployees.toLocaleString('vi-VN');
    document.getElementById('s-prod').textContent = data.totalProduction.toLocaleString('vi-VN');
    document.getElementById('s-avg').textContent = data.avgProduction.toLocaleString('vi-VN');
    document.getElementById('s-salary').textContent = data.totalSalary.toLocaleString('vi-VN') + 'đ';
    
    // Populate filters only on initial load to avoid resetting user's selection
    if (initialLoad) {
        if (data.departments) {
            data.departments.forEach(dept => {
                const opt = document.createElement('option');
                opt.value = dept;
                opt.textContent = dept;
                deptSelect.appendChild(opt);
            });
        }
        if (data.shifts) {
            data.shifts.forEach(shift => {
                const opt = document.createElement('option');
                opt.value = shift;
                opt.textContent = shift;
                shiftSelect.appendChild(opt);
            });
        }
        initialLoad = false;
    }
    
    // Chart - Top 10
    renderTopChart(data.employees.slice(0, 10));
    
    // Table
    renderTable(data.employees);
}

function renderTopChart(top10) {
    const ctx = document.getElementById('top-chart').getContext('2d');
    
    if (window._topChart) window._topChart.destroy();
    
    const labels = top10.map(e => e.name ? e.name.split(' ').slice(-2).join(' ') : e.id);
    const values = top10.map(e => e.totalQty);
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(249, 115, 22, 0.85)');
    gradient.addColorStop(1, 'rgba(236, 72, 153, 0.4)');
    
    window._topChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: gradient,
                borderColor: 'rgba(249,115,22,0.7)',
                borderWidth: 1,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    titleColor: '#f97316',
                    bodyColor: '#f1f5f9',
                    cornerRadius: 8,
                    padding: 12,
                    callbacks: {
                        label: (ctx) => ' Sản lượng: ' + ctx.raw.toLocaleString('vi-VN')
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { family: 'Outfit' }, callback: v => v >= 1000 ? (v/1000).toFixed(0) + 'k' : v },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                },
                y: {
                    ticks: { color: '#cbd5e1', font: { family: 'Outfit', size: 11 } },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderTable(employees) {
    const tbody = document.getElementById('emp-body');
    tbody.innerHTML = '';
    
    employees.forEach((emp, i) => {
        const rank = i + 1;
        let rankClass = 'rank-other';
        if (rank === 1) rankClass = 'rank-1';
        else if (rank === 2) rankClass = 'rank-2';
        else if (rank === 3) rankClass = 'rank-3';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="rank-badge ${rankClass}">${rank}</span></td>
            <td>${emp.id}</td>
            <td>${emp.name || '—'}</td>
            <td style="color:#a78bfa;font-weight:700">${emp.salary.toLocaleString('vi-VN')}đ</td>
            <td class="qty-highlight">${emp.totalQty.toLocaleString('vi-VN')}</td>
            <td>${emp.days}</td>
        `;
        tbody.appendChild(tr);
    });
}

// === SEARCH ===
document.getElementById('search-emp').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = allEmployees.filter(emp => 
        emp.id.toLowerCase().includes(q) || 
        (emp.name && emp.name.toLowerCase().includes(q))
    );
    renderTable(filtered);
});

// === UPLOAD ===
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileNameEl = document.getElementById('file-name');
const btnUpload = document.getElementById('btn-upload');
const uploadMsg = document.getElementById('upload-msg');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        showFileName(e.dataTransfer.files[0].name);
    }
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length) showFileName(fileInput.files[0].name);
});

function showFileName(name) {
    fileNameEl.textContent = '📄 ' + name;
    fileNameEl.classList.remove('hidden');
    btnUpload.disabled = false;
}

// Parse CSV text thành array of objects
function parseCSV(text) {
    const lines = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (current.trim()) lines.push(current);
            current = '';
            if (ch === '\r' && text[i + 1] === '\n') i++; // skip \r\n
        }
        else { current += ch; }
    }
    if (current.trim()) lines.push(current);

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

    if (lines.length < 2) return [];

    const headers = parseRow(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = parseRow(lines[i]);
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = cells[idx] || ''; });
        rows.push(obj);
    }
    return rows;
}

document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fileInput.files.length) return;

    btnUpload.disabled = true;
    uploadMsg.classList.add('hidden');

    // Đọc file CSV trên trình duyệt
    btnUpload.textContent = 'Đang đọc file...';
    const file = fileInput.files[0];
    const text = await file.text();
    const allRows = parseCSV(text);

    if (allRows.length === 0) {
        uploadMsg.textContent = 'File CSV trống hoặc không đọc được';
        uploadMsg.className = 'upload-msg error';
        uploadMsg.classList.remove('hidden');
        btnUpload.disabled = false;
        btnUpload.textContent = 'Tải lên';
        return;
    }

    // Tìm cột ID và CCCD
    const sampleKeys = Object.keys(allRows[0]);
    const idKey = sampleKeys.find(k => k.toLowerCase() === 'id' || k.toLowerCase() === 'textid' || k.toLowerCase().includes('mã nv') || k.toLowerCase().includes('mã nhân viên'));
    const cccdKey = sampleKeys.find(k => k.toLowerCase() === 'cccd' || k.toLowerCase() === 'cmnd');

    // Chuẩn bị dữ liệu
    const records = allRows.filter(row => {
        const empId = idKey ? String(row[idKey] || '').trim() : '';
        return empId !== '';
    }).map(row => ({
        emp_id: idKey ? String(row[idKey]).trim() : '',
        cccd: cccdKey ? String(row[cccdKey]).trim() : '123456',
        data: JSON.stringify(row)
    }));

    // Gửi từng đợt 500 dòng
    const BATCH_SIZE = 500;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);
    let successCount = 0;

    for (let i = 0; i < totalBatches; i++) {
        const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const isFirst = i === 0;
        const isLast = i === totalBatches - 1;
        const action = isLast ? 'finish' : (isFirst ? 'start' : 'continue');
        const progress = Math.round(((i + 1) / totalBatches) * 100);
        btnUpload.textContent = `Đang tải... ${progress}% (${i + 1}/${totalBatches})`;

        try {
            const res = await fetch('/api/upload-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: adminPass, action, rows: batch })
            });
            const data = await res.json();
            if (!data.success) {
                uploadMsg.textContent = 'Lỗi đợt ' + (i + 1) + ': ' + data.message;
                uploadMsg.className = 'upload-msg error';
                uploadMsg.classList.remove('hidden');
                btnUpload.disabled = false;
                btnUpload.textContent = 'Tải lên';
                return;
            }
            successCount += batch.length;
        } catch (err) {
            uploadMsg.textContent = 'Lỗi kết nối đợt ' + (i + 1) + '. Thử lại!';
            uploadMsg.className = 'upload-msg error';
            uploadMsg.classList.remove('hidden');
            btnUpload.disabled = false;
            btnUpload.textContent = 'Tải lên';
            return;
        }
    }

    uploadMsg.textContent = `✅ Tải lên thành công! ${successCount.toLocaleString('vi-VN')} bản ghi`;
    uploadMsg.className = 'upload-msg success';
    uploadMsg.classList.remove('hidden');

    // Reload dashboard
    initialLoad = true;
    deptSelect.innerHTML = '<option value="all">Tất cả bộ phận</option>';
    shiftSelect.innerHTML = '<option value="all">Tất cả ca làm</option>';
    await fetchDashboardData();

    btnUpload.disabled = false;
    btnUpload.textContent = 'Tải lên';
});

// === UPLOAD SALARY (EXCEL) ===
const dropZoneSalary = document.getElementById('drop-zone-salary');
const fileInputSalary = document.getElementById('file-input-salary');
const fileNameSalaryEl = document.getElementById('file-name-salary');
const btnUploadSalary = document.getElementById('btn-upload-salary');
const uploadMsgSalary = document.getElementById('upload-msg-salary');

if (dropZoneSalary) {
    dropZoneSalary.addEventListener('click', () => fileInputSalary.click());
    dropZoneSalary.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneSalary.classList.add('dragover'); });
    dropZoneSalary.addEventListener('dragleave', () => dropZoneSalary.classList.remove('dragover'));
    dropZoneSalary.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZoneSalary.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            fileInputSalary.files = e.dataTransfer.files;
            showFileNameSalary(e.dataTransfer.files[0].name);
        }
    });

    fileInputSalary.addEventListener('change', () => {
        if (fileInputSalary.files.length) showFileNameSalary(fileInputSalary.files[0].name);
    });

    function showFileNameSalary(name) {
        fileNameSalaryEl.textContent = '?? ' + name;
        fileNameSalaryEl.classList.remove('hidden');
        btnUploadSalary.disabled = false;
    }

    document.getElementById('upload-salary-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!fileInputSalary.files.length) return;

        const file = fileInputSalary.files[0];
        const password = adminPass;

        btnUploadSalary.disabled = true;
        btnUploadSalary.textContent = '�ang d?c file Excel...';
        uploadMsgSalary.className = 'upload-msg';
        uploadMsgSalary.textContent = '';

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // L?y d? li?u d?ng m?ng d? t�m d�ng ti�u d?
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            let headerRowIndex = -1;
            
            for (let i = 0; i < Math.min(10, jsonData.length); i++) {
                const row = jsonData[i];
            if (row && row.some(c => String(c).toUpperCase() === 'ID')) {
                    headerRowIndex = i;
                    break;
                }
            }

            if (headerRowIndex === -1) {
                throw new Error('Kh�ng t�m th?y d�ng ti�u d? (c� c?t ID, T�n, Ph�ng ban) trong sheet ' + sheetName);
            }

            // �?c l?i t? d�ng ti�u d?
            const rows = XLSX.utils.sheet_to_json(worksheet, { range: headerRowIndex });
            
            // T�m c?t ID
            const records = [];
            rows.forEach(obj => {
                const keys = Object.keys(obj);
                const idKey = keys.find(k => ['id', 'm� nv', 'm� nh�n vi�n', 'textid'].includes(k.toLowerCase()));
                if (idKey && obj[idKey]) {
                    records.push({
                        emp_id: String(obj[idKey]).trim(),
                        data: JSON.stringify(obj)
                    });
                }
            });

            if (records.length === 0) {
                throw new Error('Kh�ng t�m th?y d? li?u h?p l?. C?n c?t ID/M� NV.');
            }

            const BATCH_SIZE = 100;
            const totalBatches = Math.ceil(records.length / BATCH_SIZE);

            for (let i = 0; i < totalBatches; i++) {
                const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
                let action = 'continue';
                if (i === 0) action = 'start';
                if (i === totalBatches - 1 && totalBatches > 1) action = 'finish';
                if (totalBatches === 1) action = 'start'; // If only 1 batch, just start and it clears then inserts. Wait, we need finish to clear cache if any. 
                // Actually, backend doesn't cache salary yet, but just in case. Let's send start, then finish in next request if needed, or if 1 batch just start and it's fine.

                btnUploadSalary.textContent = 'Dang day len server... ' + Math.round((i+1)/totalBatches*100) + '%';

                const res = await fetch('/api/upload-salary-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password, action, rows: batch })
                });

                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || 'L?i server');
                }
                
                // if it's the only batch, we should also send a 'finish' action just to be safe
                if (totalBatches === 1) {
                    await fetch('/api/upload-salary-batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password, action: 'finish', rows: [] })
                    });
                }
            }
            
            // if more than 1 batch, and we already sent start/continue, we need to send finish on the last batch.
            // Wait, if i === totalBatches - 1, action is 'finish'. 
            // The backend processes rows AND action. So if action='finish', it inserts rows AND clears cache. This is perfect.

            uploadMsgSalary.textContent = 'Tai len thanh cong! Da luu ' + records.length + ' nhan vien.';
            uploadMsgSalary.classList.add('success');
            uploadMsgSalary.classList.remove('hidden');
            setTimeout(() => { uploadMsgSalary.classList.add('hidden'); }, 5000);

            fileInputSalary.value = '';
            fileNameSalaryEl.classList.add('hidden');
            btnUploadSalary.textContent = 'T?i Luong L�n';

        } catch (err) {
            console.error(err);
            uploadMsgSalary.textContent = '? L?i: ' + err.message;
            uploadMsgSalary.classList.add('error');
            uploadMsgSalary.classList.remove('hidden');
            btnUploadSalary.disabled = false;
            btnUploadSalary.textContent = 'T?i Luong L�n';
        }
    });
}

