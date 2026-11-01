import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('out');
const port = Number(process.env.PORT || 3000);
const repositoryPath = process.env.GITHUB_PAGES === 'true' ? '/Mouse_Sens_Calculator' : '';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    if (repositoryPath && pathname.startsWith(repositoryPath))
      pathname = pathname.slice(repositoryPath.length) || '/';
    const relativePath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const filePath = path.resolve(outputDir, `.${relativePath}`);
    if (
      !filePath.startsWith(`${outputDir}${path.sep}`) &&
      filePath !== path.join(outputDir, 'index.html')
    ) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`SENS/LAB static export running at http://localhost:${port}`);
});
