import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../..');
const appRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(appRoot, '.env'), override: true });

const defaultDbFile = path.join(appRoot, 'server', 'data', 'app.db');

function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith('file:')) return url;
  const filePath = url.slice(5);
  if (path.isAbsolute(filePath)) return url;
  return `file:${path.join(appRoot, filePath)}`;
}

const databaseUrl = process.env.DATABASE_URL
  ? resolveDatabaseUrl(process.env.DATABASE_URL)
  : `file:${defaultDbFile}`;
process.env.DATABASE_URL = databaseUrl;

export const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});
