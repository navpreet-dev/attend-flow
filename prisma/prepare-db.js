const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const schemaPath = path.join(__dirname, 'schema.prisma');

// Load environment variables if not already in process.env
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const dbUrl = process.env.DATABASE_URL || '';
const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');
const targetProvider = isPostgres ? 'postgresql' : 'sqlite';

console.log(`[db-prep] Detected database provider: ${targetProvider} (isPostgres: ${isPostgres})`);

let schema = fs.readFileSync(schemaPath, 'utf8');
const currentProviderMatch = schema.match(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/);
const currentProvider = currentProviderMatch ? currentProviderMatch[1] : null;

if (currentProvider !== targetProvider) {
  console.log(`[db-prep] Updating schema.prisma provider from ${currentProvider} to ${targetProvider}...`);
  schema = schema.replace(
    /(datasource\s+db\s*\{[\s\S]*?provider\s*=\s*")[^"]+(")/,
    `$1${targetProvider}$2`
  );
  fs.writeFileSync(schemaPath, schema, 'utf8');
}

// Generate Prisma Client
console.log('[db-prep] Running prisma generate...');
try {
  const prismaBin = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js');
  if (fs.existsSync(prismaBin)) {
    execSync(`node "${prismaBin}" generate`, { cwd: rootDir, stdio: 'inherit', timeout: 20000 });
  } else {
    execSync('npx prisma generate', { cwd: rootDir, stdio: 'inherit', timeout: 20000 });
  }
} catch (e) {
  console.error('[db-prep] prisma generate error:', e.message);
}

// If --push flag passed and postgres is used, sync schema to database
if (process.argv.includes('--push') && isPostgres) {
  console.log('[db-prep] Syncing schema with database (prisma db push)...');
  try {
    const prismaBin = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js');
    if (fs.existsSync(prismaBin)) {
      execSync(`node "${prismaBin}" db push --accept-data-loss`, { cwd: rootDir, stdio: 'inherit', timeout: 15000 });
    } else {
      execSync('npx prisma db push --accept-data-loss', { cwd: rootDir, stdio: 'inherit', timeout: 15000 });
    }
  } catch (err) {
    console.error('[db-prep] Warning: prisma db push failed:', err.message);
  }
}
