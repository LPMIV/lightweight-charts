import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { practiceProxy } from '../src/agenticos-proxy.mjs';

test('retains existing adapter without gateway binding', () => {
    assert.deepEqual(practiceProxy({}), { target: 'http://127.0.0.1:8765', changeOrigin: true });
});
test('gateway authorization stays in Node proxy settings with fixed loopback destination', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenticos-proxy-'));
    try {
        const path = join(dir, 'token');
        const token = 'fabricated-local-test-'.repeat(3);
        writeFileSync(path, token, { mode: 0o600 });
        const config = practiceProxy({ AGENTICOS_TOKEN_FILE: path, OANDA_API_TOKEN: 'must-not-forward' });
        assert.equal(config.target, 'http://127.0.0.1:8787');
        assert.deepEqual(Object.keys(config.headers), ['Authorization']);
        assert.equal(config.headers.Authorization, `Bearer ${token}`);
        chmodSync(path, 0o644);
        assert.throws(() => practiceProxy({ AGENTICOS_TOKEN_FILE: path }));
        chmodSync(path, 0o600);
        const link = join(dir, 'link'); symlinkSync(path, link);
        assert.throws(() => practiceProxy({ AGENTICOS_TOKEN_FILE: link }));
        writeFileSync(path, 'short');
        assert.throws(() => practiceProxy({ AGENTICOS_TOKEN_FILE: path }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
