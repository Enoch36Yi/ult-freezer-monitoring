import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE_SIZE = 1000;
const TABLES = new Set(['readings', 'prototype_readings']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return 'Usage: node scripts/export-readings.mjs --table readings|prototype_readings --output PATH [--start ISO] [--end ISO]';
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--table', '--output', '--start', '--end'].includes(flag) ||
        !value || value.startsWith('--') || options[flag]) {
      throw new Error(usage());
    }
    options[flag] = value;
  }
  if (!options['--table'] || !options['--output'] || !TABLES.has(options['--table'])) {
    throw new Error(usage());
  }
  if ((options['--start'] && !Number.isFinite(Date.parse(options['--start']))) ||
      (options['--end'] && !Number.isFinite(Date.parse(options['--end'])))) {
    throw new Error('Start and end must be valid ISO timestamps.');
  }
  if (options['--start'] && options['--end'] &&
      Date.parse(options['--end']) <= Date.parse(options['--start'])) {
    throw new Error('End must be after start.');
  }
  return {
    table: options['--table'],
    output: options['--output'],
    start: options['--start'] ?? null,
    end: options['--end'] ?? null,
  };
}

export function summarizeRows(rows) {
  const bounds = (field) => {
    const values = rows
      .map((row) => row[field])
      .filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)))
      .map((value) => new Date(value).toISOString())
      .sort();
    return values.length ? { first: values[0], last: values.at(-1) } : null;
  };
  return {
    row_count: rows.length,
    recorded_at: bounds('recorded_at'),
    received_at: bounds('received_at'),
  };
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*["']?([^"'\r\n]*)["']?\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

async function loadConfig() {
  const env = { ...process.env };
  const hasPublicConfig = () => env.NEXT_PUBLIC_SUPABASE_URL &&
    (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!hasPublicConfig()) {
    try {
      Object.assign(env, parseEnv(await readFile(path.join(root, 'web/.env.local'), 'utf8')));
    } catch {
      // The explicit environment is enough in CI or a deployment shell.
    }
  }
  if (!hasPublicConfig()) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  }
  return {
    baseUrl: env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ''),
    key: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

async function fetchRows({ table, start, end }, config, fetchImpl = fetch) {
  const rows = [];
  let offset = 0;
  let pages = 0;
  while (true) {
    const params = new URLSearchParams({
      select: '*',
      order: 'id.asc',
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (start) params.set('recorded_at', `gte.${start}`);
    if (end) params.set('recorded_at', `lt.${end}`);
    const response = await fetchImpl(`${config.baseUrl}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
    });
    if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status} at offset ${offset}.`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Supabase returned a non-array page at offset ${offset}.`);
    rows.push(...page);
    pages++;
    if (page.length < PAGE_SIZE) return { rows, pages };
    offset += PAGE_SIZE;
  }
}

export async function exportReadings(options, config, fetchImpl = fetch) {
  const { rows, pages } = await fetchRows(options, config, fetchImpl);
  const lines = rows.map((row) => JSON.stringify(row));
  const content = lines.length ? `${lines.join('\n')}\n` : '';
  const sha256 = createHash('sha256').update(content).digest('hex');
  return {
    content,
    manifest: {
      format: 'jsonl',
      exported_at_utc: new Date().toISOString(),
      source_host: new URL(config.baseUrl).host,
      table: options.table,
      recorded_at_gte: options.start,
      recorded_at_lt: options.end,
      pagination: { page_size: PAGE_SIZE, pages },
      sha256,
      ...summarizeRows(rows),
      limitations: [
        'This is a public read snapshot, not a database backup.',
        'RLS, API row limits, and the selected time window define what is included.',
        'Keep the JSONL file and manifest together; the hash covers the exact JSONL bytes.',
      ],
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const result = await exportReadings(options, config);
  await writeFile(options.output, result.content, { flag: 'wx' });
  const manifestPath = `${options.output}.manifest.json`;
  await writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(`Exported ${result.manifest.row_count} rows to ${options.output}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`SHA-256: ${result.manifest.sha256}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
