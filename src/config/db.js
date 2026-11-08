import pg from 'pg';

const { DATABASE_URL } = process.env;
const db = new pg.Pool({ connectionString: DATABASE_URL });

export default db;