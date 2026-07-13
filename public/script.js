// Utilities
const formatCurrency = (number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(number);
};

// --- Employee Pages Logic ---
const loginForm = document.getElementById('login-form');
const loginContainer = document.getElementById('login-container');
const dashboardContainer = document.getElementById('dashboard-container');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('emp-id').value;
        const cccd = document.getElementById('emp-cccd').value;

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, cccd })
            });
            const data = await res.json();

            if (data.success) {
                showDashboard(data.user, data.salaryData);
            } else {
                loginError.textContent = data.message;
                loginError.classList.remove('hidden');
            }
        } catch (error) {
            loginError.textContent = 'Lỗi kết nối đến máy chủ';
            loginError.classList.remove('hidden');
        }
    });
}

function showDashboard(records, salaryData) {
    loginContainer.classList.add('hidden');
    dashboardContainer.classList.remove('hidden');

    const firstRecord = records[0];
    const keys = Object.keys(firstRecord);
    
    // Tên và ID linh hoạt
    const nameKey = keys.find(k => k.toLowerCase().includes('tên') || k.toLowerCase().includes('nhân viên'));
    const idKey = keys.find(k => k.toLowerCase().includes('id') || k.toLowerCase().includes('mã'));
    
    document.getElementById('user-name').textContent = nameKey ? firstRecord[nameKey] : (firstRecord.name || 'N/A');
    document.getElementById('user-id').textContent = idKey ? firstRecord[idKey] : (firstRecord.id || 'N/A');
    
    // Tìm key chung cho tất cả records
    const actionKeyName = keys.find(k => k.toLowerCase().includes('thao tác') || k.toLowerCase() === 'tenthaotac');
    const qtyKeyName = keys.find(k => 
        k.toLowerCase().includes('stop điều chỉnh theo trạm min') || 
        k.toLowerCase() === 'sl_stops' ||
        k.toLowerCase() === 'sl_stops_cn'
    );
    const dateKeyName = keys.find(k => k.toLowerCase() === 'ngay' || k.toLowerCase() === 'ngày');
    
    // Helper: parse số lượng (xoá dấu phẩy phân cách hàng nghìn)
    const parseQty = (record) => {
        if (!qtyKeyName) return 0;
        let valStr = String(record[qtyKeyName]).replace(/,/g, '');
        let val = parseFloat(valStr);
        return isNaN(val) ? 0 : val;
    };
    
    // Helper: format ngày từ "2026-06-01" hoặc "01/06/2026" thành "01/06"
    const formatDate = (raw) => {
        if (!raw) return 'N/A';
        let str = String(raw).trim();
        // Format "2026-06-01"
        if (str.includes('-')) {
            const parts = str.split('-');
            return parts[2] + '/' + parts[1];
        }
        // Format "01/06/2026"
        if (str.includes('/')) {
            const parts = str.split('/');
            return parts[0] + '/' + parts[1];
        }
        return str;
    };
    
    // Gom nhóm theo Thao tác (bảng tổng)
    const groupedActions = {};
    // Gom nhóm theo Ngày (bảng ngày)
    const groupedDays = {};
    
    records.forEach(record => {
        const actionName = actionKeyName && record[actionKeyName] ? String(record[actionKeyName]).trim() : 'Không xác định';
        const quantity = parseQty(record);
        const dateRaw = dateKeyName ? record[dateKeyName] : 'N/A';
        const dateKey = String(dateRaw).trim();
        
        // Gom theo thao tác
        if (!groupedActions[actionName]) groupedActions[actionName] = 0;
        groupedActions[actionName] += quantity;
        
        // Gom theo ngày
        if (!groupedDays[dateKey]) groupedDays[dateKey] = 0;
        groupedDays[dateKey] += quantity;
    });
    
    // === BIỂU ĐỒ CỘT SẢN LƯỢNG THEO NGÀY ===
    const sortedDays = Object.keys(groupedDays).sort((a, b) => new Date(a) - new Date(b));
    const chartLabels = sortedDays.map(d => formatDate(d));
    const chartData = sortedDays.map(d => groupedDays[d]);
    
    // Xoá chart cũ nếu có
    if (window._dailyChart) window._dailyChart.destroy();
    
    const ctx = document.getElementById('daily-chart').getContext('2d');
    
    // Tạo gradient cho cột
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(249, 115, 22, 0.85)');
    gradient.addColorStop(1, 'rgba(236, 72, 153, 0.5)');
    
    window._dailyChart = new Chart(ctx, {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Sản lượng',
                data: chartData,
                backgroundColor: gradient,
                borderColor: 'rgba(249, 115, 22, 0.9)',
                borderWidth: 1,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: { top: 25 }
            },
            plugins: {
                legend: { display: false },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    color: '#475569',
                    font: {
                        family: 'Outfit',
                        weight: '600',
                        size: 11
                    },
                    formatter: (value) => {
                        if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
                        return Number.isInteger(value) ? value : value.toFixed(0);
                    }
                },
                tooltip: {
                    backgroundColor: '#fff',
                    titleColor: '#f97316',
                    bodyColor: '#334155',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    cornerRadius: 10,
                    padding: 12,
                    callbacks: {
                        label: (ctx) => ' Sản lượng: ' + ctx.raw.toLocaleString('vi-VN')
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { family: 'Outfit' } },
                    grid: { display: false }
                },
                y: {
                    ticks: {
                        color: '#64748b',
                        font: { family: 'Outfit' },
                        callback: (v) => v.toLocaleString('vi-VN')
                    },
                    grid: { color: 'rgba(0,0,0,0.04)' }
                }
            }
        }
    });
    
    // === BẢNG TỔNG THEO THAO TÁC ===
    const tbody = document.getElementById('actions-body');
    tbody.innerHTML = '';
    
    let totalQty = 0;
    let actionCount = 0;
    
    Object.keys(groupedActions).forEach(actionName => {
        const qty = groupedActions[actionName];
        totalQty += qty;
        actionCount++;
        
        const displayQty = Number.isInteger(qty) ? qty.toLocaleString('vi-VN') : qty.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${actionName}</td>
            <td class="qty-val">${displayQty}</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Cập nhật thống kê tổng
    const elTotalActions = document.getElementById('total-actions');
    const elTotalQty = document.getElementById('total-qty');
    const elTotalDays = document.getElementById('total-days');
    
    if (elTotalActions) elTotalActions.textContent = actionCount;
    if (elTotalQty) elTotalQty.textContent = Number.isInteger(totalQty) ? totalQty.toLocaleString('vi-VN') : totalQty.toFixed(2);
    if (elTotalDays) elTotalDays.textContent = sortedDays.length;
    // === XÁC ĐỊNH THÁNG CỦA DỮ LIỆU SẢN LƯỢNG ===
    let dataMonth = null;
    if (sortedDays.length > 0) {
        // sortedDays format: "2026-06-01" hoặc "01/06/2026" etc
        const firstDay = sortedDays[0];
        // Thử parse để lấy tháng
        const d = new Date(firstDay);
        if (!isNaN(d)) {
            dataMonth = (d.getMonth() + 1) + '/' + d.getFullYear();
        }
    }
    
    // === LOAD LỊCH LÀM VIỆC & CHẤM CÔNG ===
    const empIdVal = document.getElementById('user-id').textContent;
    loadSchedule(empIdVal);
    loadAttendance(empIdVal, dataMonth);
    loadDiscipline(empIdVal);

    // === RENDER LƯƠNG THÁNG ===
    renderSalary(salaryData);
}

// --- Render Lương tháng ---
function renderSalary(salary) {
    const emptyEl = document.getElementById('salary-empty');
    const contentEl = document.getElementById('salary-content');
    
    if (!salary) {
        emptyEl.classList.remove('hidden');
        contentEl.classList.add('hidden');
        return;
    }
    
    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
    
    // Tìm keys
    const keys = Object.keys(salary);
    const findKey = (...patterns) => keys.find(k => patterns.some(p => String(k).toLowerCase().includes(p)));
    
    const kBase = findKey('thu nhập lương đảm bảo');
    const kProd = findKey('lương năng suất');
    const kTotal = findKey('chi lương');
    
    document.getElementById('salary-base').textContent = formatCurrency(parseFloat(salary[kBase]) || 0);
    document.getElementById('salary-prod').textContent = formatCurrency(parseFloat(salary[kProd]) || 0);
    document.getElementById('salary-total').textContent = formatCurrency(parseFloat(salary[kTotal]) || 0);
    
    // Tìm các cột ngày (tên cột là số như 46204)
    // Excel date = số ngày từ 1/1/1900
    const parseExcelDate = (serial) => {
        const utc_days = Math.floor(serial - 25569);
        const utc_value = utc_days * 86400;
        const date_info = new Date(utc_value * 1000);
        return date_info.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const tbody = document.getElementById('salary-body');
    tbody.innerHTML = '';
    
    let hasDays = false;
    keys.forEach(k => {
        if (!isNaN(k) && parseInt(k) > 40000) { // Cột ngày Excel
            const val = parseFloat(salary[k]) || 0;
            if (val > 0) {
                hasDays = true;
                const tr = document.createElement('tr');
                tr.innerHTML = \`
                    <td>\${parseExcelDate(k)}</td>
                    <td class="qty-val">\${formatCurrency(val)}</td>
                \`;
                tbody.appendChild(tr);
            }
        }
    });

    if (!hasDays) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align: center;">Không có chi tiết từng ngày</td></tr>';
    }
}


// --- Load đi trễ / off đột xuất ---
async function loadDiscipline(empId) {
    try {
        const res = await fetch('/api/discipline?id=' + encodeURIComponent(empId));
        const data = await res.json();
        if (!data.success) return;
        
        // Cập nhật số liệu
        const lateEl = document.getElementById('late-count');
        const offEl = document.getElementById('off-count');
        const lateWarn = document.getElementById('late-warning');
        const offWarn = document.getElementById('off-warning');
        
        if (lateEl) lateEl.textContent = data.lateCount;
        if (offEl) offEl.textContent = data.offCount;
        
        // Cảnh báo đi trễ
        if (lateWarn) {
            if (data.lateCount === 0) {
                lateWarn.textContent = '✅ Tốt! Không đi trễ';
                lateWarn.className = 'disc-warning warn-good';
            } else if (data.lateCount <= 2) {
                lateWarn.textContent = '💛 Lưu ý: Hạn chế đi trễ';
                lateWarn.className = 'disc-warning warn-medium';
            } else {
                lateWarn.textContent = '🔴 Cảnh báo! Đi trễ nhiều lần';
                lateWarn.className = 'disc-warning warn-high';
            }
        }
        
        // Cảnh báo off đột xuất
        if (offWarn) {
            if (data.offCount === 0) {
                offWarn.textContent = '✅ Tốt! Không off đột xuất';
                offWarn.className = 'disc-warning warn-good';
            } else if (data.offCount <= 2) {
                offWarn.textContent = '💛 Lưu ý: Hạn chế off đột xuất';
                offWarn.className = 'disc-warning warn-medium';
            } else {
                offWarn.textContent = '🔴 Cảnh báo! Off đột xuất nhiều';
                offWarn.className = 'disc-warning warn-high';
            }
        }
        
        // Bảng chi tiết đi trễ
        const lateBody = document.getElementById('late-body');
        if (lateBody) {
            lateBody.innerHTML = '';
            if (data.lateList.length === 0) {
                lateBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#64748b;">Không có dữ liệu</td></tr>';
            }
            data.lateList.forEach(item => {
                const tr = document.createElement('tr');
                const timeShort = item.time.substring(0, 16);
                const reasonShort = item.reason.length > 120 ? item.reason.substring(0, 120) + '...' : item.reason;
                tr.innerHTML = `<td style="white-space:nowrap">${timeShort}</td><td>${reasonShort}</td>`;
                lateBody.appendChild(tr);
            });
        }
        
        // Bảng chi tiết off
        const offBody = document.getElementById('off-body');
        if (offBody) {
            offBody.innerHTML = '';
            if (data.offList.length === 0) {
                offBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#64748b;">Không có dữ liệu</td></tr>';
            }
            data.offList.forEach(item => {
                const tr = document.createElement('tr');
                const timeShort = item.time.substring(0, 16);
                const reasonShort = item.reason.length > 120 ? item.reason.substring(0, 120) + '...' : item.reason;
                tr.innerHTML = `<td style="white-space:nowrap">${timeShort}</td><td>${reasonShort}</td>`;
                offBody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error('Discipline error:', e);
    }
}

// --- Load chấm công thực tế ---
async function loadAttendance(empId, dataMonth) {
    try {
        let url = '/api/attendance?id=' + encodeURIComponent(empId);
        if (dataMonth) url += '&month=' + encodeURIComponent(dataMonth);
        
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) {
            const elTotalDays = document.getElementById('total-days');
            if (elTotalDays) {
                elTotalDays.textContent = data.totalDays;
            }
        }
    } catch (e) {
        console.error('Attendance error:', e);
    }
}

// --- Tab Switching ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

// --- Schedule Logic ---
let allSchedule = [];
let currentWeekOffset = 0;

async function loadSchedule(empId) {
    const loading = document.getElementById('schedule-loading');
    if (loading) loading.classList.remove('hidden');
    
    try {
        const res = await fetch('/api/schedule?id=' + encodeURIComponent(empId));
        const data = await res.json();
        if (data.success) {
            allSchedule = data.schedule;
            currentWeekOffset = 0;
            // Tự động nhảy đến tuần hiện tại
            findCurrentWeek();
            renderWeek();
        }
    } catch (e) {
        console.error('Schedule error:', e);
    } finally {
        if (loading) loading.classList.add('hidden');
    }
}

function findCurrentWeek() {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    for (let i = 0; i < allSchedule.length; i++) {
        const parts = allSchedule[i].date.split('/');
        const d = new Date(parts[2], parts[1]-1, parts[0]);
        if (d >= today) {
            // Tìm đầu tuần (Thứ Hai)
            currentWeekOffset = Math.floor(i / 7) * 7;
            break;
        }
    }
}

const dayNames = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

function renderWeek() {
    const tbody = document.getElementById('schedule-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Lấy 7 ngày từ offset
    const weekData = allSchedule.slice(currentWeekOffset, currentWeekOffset + 7);
    
    if (weekData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">Không có dữ liệu tuần này</td></tr>';
    }
    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    weekData.forEach(item => {
        const parts = item.date.split('/');
        const d = new Date(parts[2], parts[1]-1, parts[0]);
        const dayName = dayNames[d.getDay()];
        const isToday = d.getTime() === today.getTime();
        const isOff = item.shift.toUpperCase().includes('OFF');
        
        const tr = document.createElement('tr');
        if (isToday) tr.classList.add('today-row');
        if (isOff) tr.classList.add('off-row');
        
        tr.innerHTML = `
            <td>${dayName}</td>
            <td>${item.date.substring(0, 5)}</td>
            <td class="${isOff ? 'off-shift' : 'shift-val'}">${item.shift}</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Cập nhật label tuần
    const label = document.getElementById('week-label');
    if (label && weekData.length > 0) {
        label.textContent = weekData[0].date.substring(0,5) + ' → ' + weekData[weekData.length-1].date.substring(0,5);
    }
}

document.getElementById('prev-week')?.addEventListener('click', () => {
    currentWeekOffset = Math.max(0, currentWeekOffset - 7);
    renderWeek();
});

document.getElementById('next-week')?.addEventListener('click', () => {
    currentWeekOffset = Math.min(allSchedule.length - 7, currentWeekOffset + 7);
    renderWeek();
});

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        loginContainer.classList.remove('hidden');
        dashboardContainer.classList.add('hidden');
        loginForm.reset();
        loginError.classList.add('hidden');
    });
}


// --- Admin Page Logic ---
const adminForm = document.getElementById('admin-form');
const adminError = document.getElementById('admin-error');
const adminSuccess = document.getElementById('admin-success');

if (adminForm) {
    adminForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('admin-pwd').value;
        const fileInput = document.getElementById('data-file');
        
        if (fileInput.files.length === 0) return;

        const formData = new FormData();
        formData.append('password', pwd);
        formData.append('datafile', fileInput.files[0]);

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                adminSuccess.textContent = data.message;
                adminSuccess.classList.remove('hidden');
                adminError.classList.add('hidden');
                adminForm.reset();
            } else {
                adminError.textContent = data.message;
                adminError.classList.remove('hidden');
                adminSuccess.classList.add('hidden');
            }
        } catch (error) {
            adminError.textContent = 'Lỗi kết nối đến máy chủ';
            adminError.classList.remove('hidden');
            adminSuccess.classList.add('hidden');
        }
    });
}
