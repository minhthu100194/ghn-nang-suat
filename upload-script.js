// Script tự động upload CSV lên Render server
const fs = require('fs');
const path = require('path');

const CSV_FILE = 'C:\\Users\\Dell\\Downloads\\Telegram Desktop\\data-ns.csv';
const SERVER_URL = 'https://ghn-nang-suat.onrender.com';
const PASSWORD = 'admin123';
const BATCH_SIZE = 300;

function parseCSVRow(line) {
    const cells = [];
    let cell = '', q = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') q = !q;
        else if (ch === ',' && !q) { cells.push(cell.trim()); cell = ''; }
        else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
}

async function main() {
    console.log('Đang đọc file CSV...');
    const text = fs.readFileSync(CSV_FILE, 'utf-8');
    console.log(`File size: ${(text.length / 1024 / 1024).toFixed(1)}MB`);

    // Parse lines
    const lines = [];
    let current = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (current.trim()) lines.push(current);
            current = '';
            if (ch === '\r' && text[i + 1] === '\n') i++;
        }
        else current += ch;
    }
    if (current.trim()) lines.push(current);

    console.log(`Tổng: ${lines.length - 1} dòng dữ liệu`);

    // Parse headers
    const headers = parseCSVRow(lines[0]);
    const idIdx = headers.findIndex(h => 
        h.toLowerCase() === 'id' || h.toLowerCase() === 'textid' || 
        h.toLowerCase().includes('mã nv') || h.toLowerCase().includes('mã nhân viên')
    );
    const cccdIdx = headers.findIndex(h => 
        h.toLowerCase() === 'cccd' || h.toLowerCase() === 'cmnd'
    );

    console.log(`Cột ID: "${headers[idIdx]}" (index ${idIdx})`);
    console.log(`Cột CCCD: "${headers[cccdIdx]}" (index ${cccdIdx})`);

    // Prepare records
    console.log('Đang chuẩn bị dữ liệu...');
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCSVRow(lines[i]);
        const emp_id = idIdx >= 0 ? (cells[idIdx] || '').trim() : '';
        if (!emp_id) continue;
        
        const cccd = cccdIdx >= 0 ? (cells[cccdIdx] || '123456').trim() : '123456';
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = cells[idx] || ''; });
        
        records.push({ emp_id, cccd, data: JSON.stringify(obj) });
    }

    console.log(`Tổng bản ghi hợp lệ: ${records.length}`);
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);
    console.log(`Sẽ gửi ${totalBatches} đợt (mỗi đợt ${BATCH_SIZE} dòng)\n`);

    // Send batches
    let successCount = 0;
    for (let i = 0; i < totalBatches; i++) {
        const batch = records.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const isFirst = i === 0;
        const isLast = i === totalBatches - 1;
        const action = isLast ? 'finish' : (isFirst ? 'start' : 'continue');
        const progress = Math.round(((i + 1) / totalBatches) * 100);

        try {
            const res = await fetch(`${SERVER_URL}/api/upload-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: PASSWORD, action, rows: batch })
            });
            const data = await res.json();
            
            if (!data.success) {
                console.error(`❌ Lỗi đợt ${i + 1}: ${data.message}`);
                return;
            }
            
            successCount += batch.length;
            process.stdout.write(`\r  Tiến trình: ${progress}% (${i + 1}/${totalBatches}) - ${successCount.toLocaleString()} bản ghi`);
        } catch (err) {
            console.error(`\n❌ Lỗi kết nối đợt ${i + 1}: ${err.message}`);
            console.log('Thử lại sau 5 giây...');
            await new Promise(r => setTimeout(r, 5000));
            i--; // retry
            continue;
        }
    }

    console.log(`\n\n✅ HOÀN TẤT! Đã upload ${successCount.toLocaleString()} bản ghi lên server.`);
}

main().catch(err => console.error('Lỗi:', err));
