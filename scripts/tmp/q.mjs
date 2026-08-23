import pg from "pg"; import fs from "node:fs";
const url = fs.readFileSync(".env.local","utf8").match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^"|"$/g,"");
const c = new pg.Client({ connectionString: url, ssl:{rejectUnauthorized:false} });
await c.connect(); const r = await c.query(process.argv[2]); console.table(r.rows.slice(0,25)); await c.end();
