import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const INCLUDE_TAG = /<!--\s*include:\s*(\S+)\s*-->/g;

function resolveIncludes(html, baseDir) {
    return html.replace(INCLUDE_TAG, (_match, relPath) => {
        const filePath = path.resolve(baseDir, relPath);
        const content = fs.readFileSync(filePath, 'utf-8');
        return resolveIncludes(content, path.dirname(filePath));
    });
}

// index.html은 <!-- include: path/to/partial.html --> 마커만 남기고,
// 실제 마크업은 src/partials/ 아래 섹션별 파일로 분리되어 있다.
// 이 플러그인이 dev 서버와 build 양쪽에서 마커를 파일 내용으로 치환한다.
function htmlInclude() {
    return {
        name: 'html-include',
        transformIndexHtml(html, ctx) {
            const baseDir = path.dirname(ctx.filename);
            return resolveIncludes(html, baseDir);
        }
    };
}

export default defineConfig({
    base: '/',
    plugins: [htmlInclude()],
    build: {
        outDir: 'dist',
        assetsDir: 'assets'
    }
});
