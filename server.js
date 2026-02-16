const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;

    // Prevent directory traversal
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(__dirname, filePath);

    // Check file exists within project directory
    if (!fullPath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // SPA fallback: serve index.html
                fs.readFile(path.join(__dirname, 'index.html'), (err2, indexData) => {
                    if (err2) {
                        res.writeHead(500);
                        res.end('Internal Server Error');
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(indexData);
                });
            } else {
                res.writeHead(500);
                res.end('Internal Server Error');
            }
            return;
        }

        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
        });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`CineGrade server running on port ${PORT}`);
});
