const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://user:password@localhost:5432/preempt_db' });
async function run() {
  const res = await pool.query("SELECT * FROM Templates");
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}
run();
