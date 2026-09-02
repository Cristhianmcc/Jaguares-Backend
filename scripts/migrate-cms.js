import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
config({ path: path.join(serverRoot, '.env') });

const expectedDatabase = 'jaguares_cms_dev';
const expectedPort = '3308';
if (process.env.DB_NAME !== expectedDatabase || String(process.env.DB_PORT) !== expectedPort) {
  throw new Error(`Migración cancelada: se esperaba ${expectedDatabase} en el puerto ${expectedPort}.`);
}

const sql = await fs.readFile(path.join(serverRoot, 'migrations', '20260901_cms_landing_v2.sql'), 'utf8');
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
  charset: 'utf8mb4',
});

try {
  await connection.query(sql);
  const [tables] = await connection.query("SHOW TABLES LIKE 'landing_%'");
  console.log(`Migración CMS aplicada en ${expectedDatabase}. Tablas landing_: ${tables.length}`);
} finally {
  await connection.end();
}
