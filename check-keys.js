const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgres://ghn_ns_user:7LDBB8c90W8FfKryePijvW50gL3jRkly@dpg-cqlu506j1k6c73af4gug-a.oregon-postgres.render.com/ghn_ns',
    ssl: { rejectUnauthorized: false }
});

async function check() {
    try {
        const res = await pool.query('SELECT data FROM records LIMIT 1');
        const obj = JSON.parse(res.rows[0].data);
        console.log("Keys:", Object.keys(obj));
    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
check();
