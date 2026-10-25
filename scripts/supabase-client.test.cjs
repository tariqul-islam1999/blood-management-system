const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the real initialization code with synthetic settings and mocked
// dependencies. Never import the live client, load .env, or contact Supabase.
const source = fs.readFileSync(path.join(__dirname, '../src/lib/supabase.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function initialize({ os, browser = false, ...settings }) {
  const url = 'url' in settings ? settings.url : 'https://bms-offline.invalid';
  const key = 'key' in settings ? settings.key : 'test-placeholder';
  const storage = Object.freeze({ name: 'mock-storage' });
  const client = Object.freeze({ name: 'mock-client' });
  let configuration;
  const sandbox = {
    exports: {},
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key } },
    require(name) {
      if (name === 'react-native-url-polyfill/auto') return {};
      if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: storage };
      if (name === 'react-native') return { Platform: { OS: os } };
      if (name === '@supabase/supabase-js') {
        return { createClient(receivedUrl, receivedKey, options) {
          assert.equal(receivedUrl, url);
          assert.equal(receivedKey, key);
          configuration = options.auth;
          return client;
        } };
      }
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  if (browser) sandbox.window = {};
  vm.runInNewContext(compiled, sandbox);
  assert.equal(sandbox.exports.supabase, client);
  return { configuration, storage };
}

for (const os of ['ios', 'android']) {
  test(`${os} retains persisted sessions and refresh even without a window global`, () => {
    const { configuration, storage } = initialize({ os });
    assert.equal(configuration.storage, storage);
    assert.equal(configuration.persistSession, true);
    assert.equal(configuration.autoRefreshToken, true);
    assert.equal(configuration.detectSessionInUrl, false);
  });
}

test('web browser retains the existing authentication settings', () => {
  const { configuration, storage } = initialize({ os: 'web', browser: true });
  assert.equal(configuration.storage, storage);
  assert.equal(configuration.persistSession, true);
  assert.equal(configuration.autoRefreshToken, true);
  assert.equal(configuration.detectSessionInUrl, false);
});

test('static web rendering does not use browser storage or refresh sessions', () => {
  const { configuration } = initialize({ os: 'web' });
  assert.equal(configuration.storage, undefined);
  assert.equal(configuration.persistSession, false);
  assert.equal(configuration.autoRefreshToken, false);
  assert.equal(configuration.detectSessionInUrl, false);
});

for (const missing of ['url', 'key']) {
  test(`missing ${missing} still fails before creating a client`, () => {
    assert.throws(() => initialize({ os: 'web', [missing]: undefined }),
      /Supabase environment variables are missing/);
  });
}
