#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { runCapacityReview } from '../src/index.js';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('用法: node bin/cli.js <场景文件.json>');
    console.error('该工具仅做离线计算，不会调用任何扩容系统。');
    process.exit(1);
  }
  const raw = await readFile(filePath, 'utf8');
  const scenario = JSON.parse(raw);
  const result = runCapacityReview(scenario);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
