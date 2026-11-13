/** Node/Vite configuration only. Never import this from browser source. */
import { constants, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';

export function practiceProxy(env = process.env) {
    if (!env.AGENTICOS_TOKEN_FILE) {
        return { target: 'http://127.0.0.1:8765', changeOrigin: true };
    }
    const fd = openSync(env.AGENTICOS_TOKEN_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
    let token;
    try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 4096) {
            throw new Error('Gateway token must be an owner-only regular file');
        }
        token = readFileSync(fd, 'utf8').trim();
    } finally {
        closeSync(fd);
    }
    if (!/^[\x21-\x7e]{32,4096}$/.test(token)) {
        throw new Error('Invalid private gateway token');
    }
    return { target: 'http://127.0.0.1:8787', changeOrigin: true,
        headers: { Authorization: `Bearer ${token}` } };
}
