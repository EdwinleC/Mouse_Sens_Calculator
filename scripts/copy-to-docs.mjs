import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const exportDir = path.resolve('out');
const pagesDir = path.resolve('docs');

await rm(pagesDir, { recursive: true, force: true });
await mkdir(pagesDir, { recursive: true });
await cp(exportDir, pagesDir, { recursive: true });

console.log('Copied the static export from out/ to docs/.');
