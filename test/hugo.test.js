'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const script = path.join(__dirname, '..', 'hugo.js');
const manifestName = '.hugo-data-to-pages.json';
const isAvailable = (command) => spawnSync('sh', ['-c', 'command -v ' + command]).status === 0;

//Creates a throwaway hugo site, with a stub instead of the hugo binary ("ok", "fail" or "wait")
const makeSite = (t, pages, options) => {
  options = options || {};
  const site = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hugo-data-to-pages-')));
  t.after(() => fs.rmSync(site, { recursive: true, force: true }));
  fs.mkdirSync(path.join(site, 'data'));
  fs.mkdirSync(path.join(site, 'content'));
  fs.writeFileSync(path.join(site, 'content', '_index.md'), 'home\n');
  fs.writeFileSync(path.join(site, 'data', 'articles.json'), JSON.stringify({ articles: pages }));
  const stubs = {
    ok: 'ls content > built.txt\n',
    fail: 'echo "build broke" >&2\nexit 1\n',
    wait: 'exec sleep 30\n'
  };
  fs.writeFileSync(path.join(site, 'hugo-stub'), '#!/bin/sh\n' + stubs[options.hugo || 'ok'], { mode: 0o755 });
  const config = Object.assign({ root: site, hugoPath: path.join(site, 'hugo-stub') }, options.config);
  fs.writeFileSync(path.join(site, 'config.json'), JSON.stringify(config));
  return site;
};
//Runs the script without a terminal (stdin is an empty pipe)
const run = (site, args, options) => {
  const result = spawnSync(process.execPath, [script].concat(args, ['-c', 'config.json']), Object.assign({ cwd: site, encoding: 'utf8', input: '' }, options));
  result.output = result.stdout + result.stderr;
  return result;
};
const content = (site) => fs.readdirSync(path.join(site, 'content')).sort();
const exists = (site, ...parts) => fs.existsSync(path.join(site, ...parts));
const page = (pagePath, fields) => ({ path: pagePath, fields: fields || { name: pagePath } });

test('generate writes the fields as JSON front matter', (t) => {
  const site = makeSite(t, [page('one', { name: 'One', children: 2 }), page('two', { name: 'Two', type: 'custom' })]);
  const result = run(site, ['generate']);
  assert.strictEqual(result.status, 0, result.output);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(site, 'content', 'one', 'index.md'), 'utf8')), { name: 'One', children: 2, type: 'article' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(site, 'content', 'two', 'index.md'), 'utf8')).type, 'custom');
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(site, manifestName), 'utf8')).pages), ['content/one', 'content/two']);
});

test('clean removes generated folders, the manifest and nothing else', (t) => {
  const site = makeSite(t, [page('one'), page('two')]);
  fs.mkdirSync(path.join(site, 'content', 'about'));
  fs.writeFileSync(path.join(site, 'content', 'about', 'index.md'), 'mine\n');
  run(site, ['generate']);
  const result = run(site, ['clean', '-f']);
  assert.strictEqual(result.status, 0, result.output);
  assert.deepStrictEqual(content(site), ['_index.md', 'about']);
  assert.ok(!exists(site, manifestName));
});

test('generating twice and cleaning once leaves nothing behind', (t) => {
  const site = makeSite(t, [page('one')]);
  assert.strictEqual(run(site, ['generate']).status, 0);
  assert.strictEqual(run(site, ['generate']).status, 0);
  run(site, ['clean', '-f']);
  assert.deepStrictEqual(content(site), ['_index.md']);
});

test('default mode builds with the pages in place, then removes them', (t) => {
  const site = makeSite(t, [page('one'), page('two')]);
  const result = run(site, ['-f']);
  assert.strictEqual(result.status, 0, result.output);
  assert.match(result.stdout, /Done!/);
  assert.deepStrictEqual(fs.readFileSync(path.join(site, 'built.txt'), 'utf8').trim().split('\n'), ['_index.md', 'one', 'two']);
  assert.deepStrictEqual(content(site), ['_index.md']);
  assert.ok(!exists(site, manifestName));
});

test('a failed build still cleans up and exits with an error', (t) => {
  const site = makeSite(t, [page('one')], { hugo: 'fail' });
  const result = run(site, ['-f']);
  assert.strictEqual(result.status, 1, result.output);
  assert.doesNotMatch(result.stdout, /Done!/);
  assert.deepStrictEqual(content(site), ['_index.md']);
});

test('a failed build without --force and without a terminal exits with an error and keeps the pages', (t) => {
  const site = makeSite(t, [page('one')], { hugo: 'fail' });
  const result = run(site, []);
  assert.strictEqual(result.status, 1, result.output);
  assert.match(result.stdout, /Keeping .*one/);
  assert.deepStrictEqual(content(site), ['_index.md', 'one']);
  assert.strictEqual(run(site, ['clean', '-f']).status, 0);
  assert.deepStrictEqual(content(site), ['_index.md']);
});

test('nothing is removed without a terminal unless forced', (t) => {
  const site = makeSite(t, [page('one')]);
  run(site, ['generate']);
  for (const args of [['clean'], ['clean', '--no-force'], ['clean', '--force=false'], ['clean', '-f=false']]) {
    const result = run(site, args);
    assert.strictEqual(result.status, 0, result.output);
    assert.deepStrictEqual(content(site), ['_index.md', 'one'], args.join(' '));
  }
});

test('the removal prompt deletes on "y" and keeps on "n"', { skip: process.platform !== 'linux' || !isAvailable('script') }, (t) => {
  const site = makeSite(t, [page('one')]);
  run(site, ['generate']);
  const command = '"' + process.execPath + '" "' + script + '" clean -c config.json';
  spawnSync('script', ['-qec', command, '/dev/null'], { cwd: site, input: 'n', encoding: 'utf8' });
  assert.deepStrictEqual(content(site), ['_index.md', 'one']);
  spawnSync('script', ['-qec', command, '/dev/null'], { cwd: site, input: 'y', encoding: 'utf8' });
  assert.deepStrictEqual(content(site), ['_index.md']);
});

test('paths outside of the content folder are rejected', (t) => {
  const site = makeSite(t, [page('ok'), page('../layouts'), page('.'), page('a/../..'), page('../content-other/x')]);
  fs.mkdirSync(path.join(site, 'layouts'));
  for (const args of [['generate'], ['clean', '-f'], ['-f']]) {
    const result = run(site, args);
    if (args[0] !== 'clean') {
      assert.strictEqual(result.status, 1, result.output);
      for (const index of [1, 2, 3, 4]) assert.match(result.stderr, new RegExp('articles\\.json \\[' + index + '\\]'));
    }
    assert.deepStrictEqual(content(site), ['_index.md']);
    assert.ok(exists(site, 'layouts'));
    assert.ok(!exists(site, 'content-other'));
  }
});

test('invalid pages are all reported and nothing is generated', (t) => {
  const site = makeSite(t, [
    page('ok'),
    { fields: { name: 'no path' } },
    { path: 'no-fields' },
    { path: 'text-fields', fields: 'bad' },
    { path: 'list-fields', fields: ['bad'] },
    { path: { not: 'text' }, fields: { name: 'x' } },
    { path: '', fields: { name: 'x' } },
    null
  ]);
  const result = run(site, ['generate']);
  assert.strictEqual(result.status, 1, result.output);
  assert.doesNotMatch(result.stdout, /Done!/);
  for (const index of [1, 2, 3, 4, 5, 6, 7]) assert.match(result.stderr, new RegExp('articles\\.json \\[' + index + '\\]'));
  assert.doesNotMatch(result.stderr, /articles\.json \[0\]/);
  assert.deepStrictEqual(content(site), ['_index.md']);
  assert.ok(!exists(site, manifestName));
});

test('numeric paths are accepted', (t) => {
  const site = makeSite(t, [page(1984)]);
  assert.strictEqual(run(site, ['generate']).status, 0);
  assert.deepStrictEqual(content(site), ['1984', '_index.md']);
});

test('duplicate and nested page paths are rejected', (t) => {
  const site = makeSite(t, [page('one'), page('./one/'), page('one/child'), page('two')]);
  const result = run(site, ['generate']);
  assert.strictEqual(result.status, 1, result.output);
  assert.match(result.stderr, /articles\.json \[1\].*already used by articles\.json \[0\]/);
  assert.match(result.stderr, /articles\.json \[2\].*inside the page of articles\.json \[0\]/);
  assert.deepStrictEqual(content(site), ['_index.md']);
});

test('a folder that already exists is never overwritten or removed', (t) => {
  const site = makeSite(t, [page('one'), page('about')]);
  fs.mkdirSync(path.join(site, 'content', 'about'));
  fs.writeFileSync(path.join(site, 'content', 'about', 'index.md'), 'mine\n');
  const result = run(site, ['generate']);
  assert.strictEqual(result.status, 1, result.output);
  assert.match(result.stderr, /content\/about/);
  assert.deepStrictEqual(content(site), ['_index.md', 'about']);
  run(site, ['clean', '-f']);
  assert.strictEqual(fs.readFileSync(path.join(site, 'content', 'about', 'index.md'), 'utf8'), 'mine\n');
});

test('generated folders that were changed by hand are left alone', (t) => {
  const site = makeSite(t, [page('edited'), page('added-to'), page('untouched')]);
  run(site, ['generate']);
  fs.writeFileSync(path.join(site, 'content', 'edited', 'index.md'), 'mine\n');
  fs.writeFileSync(path.join(site, 'content', 'added-to', 'photo.txt'), 'mine\n');
  const regenerate = run(site, ['generate']);
  assert.strictEqual(regenerate.status, 1, regenerate.output);
  assert.strictEqual(fs.readFileSync(path.join(site, 'content', 'edited', 'index.md'), 'utf8'), 'mine\n');
  const result = run(site, ['clean', '-f']);
  assert.strictEqual(result.status, 0, result.output);
  assert.match(result.stdout, /Leaving .*edited/);
  assert.match(result.stdout, /Leaving .*added-to/);
  assert.deepStrictEqual(content(site), ['_index.md', 'added-to', 'edited']);
  assert.ok(exists(site, 'content', 'added-to', 'photo.txt'));
});

test('a page dropped from the data is still cleaned up, unless it was replaced by hand', (t) => {
  const site = makeSite(t, [page('dropped'), page('replaced')]);
  run(site, ['generate']);
  fs.writeFileSync(path.join(site, 'data', 'articles.json'), JSON.stringify({ articles: [] }));
  fs.writeFileSync(path.join(site, 'content', 'replaced', 'index.md'), 'mine\n');
  run(site, ['clean', '-f']);
  assert.deepStrictEqual(content(site), ['_index.md', 'replaced']);
});

test('a generation that fails halfway only tracks what it created', (t) => {
  const site = makeSite(t, [page('first'), page('block/child'), page('later')]);
  fs.writeFileSync(path.join(site, 'content', 'block'), 'a file, not a folder\n');
  const result = run(site, ['generate']);
  assert.strictEqual(result.status, 1, result.output);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(site, manifestName), 'utf8')).pages), ['content/first']);
  fs.mkdirSync(path.join(site, 'content', 'later'));
  fs.writeFileSync(path.join(site, 'content', 'later', 'index.md'), 'mine\n');
  run(site, ['clean', '-f']);
  assert.deepStrictEqual(content(site), ['_index.md', 'block', 'later']);
});

test('default mode cleans up after a generation that fails halfway', (t) => {
  const site = makeSite(t, [page('first'), page('block/child')]);
  fs.writeFileSync(path.join(site, 'content', 'block'), 'a file, not a folder\n');
  const result = run(site, ['-f']);
  assert.strictEqual(result.status, 1, result.output);
  assert.ok(!exists(site, 'built.txt'));
  assert.deepStrictEqual(content(site), ['_index.md', 'block']);
});

test('parent folders created for nested pages are removed, existing ones are kept', (t) => {
  const site = makeSite(t, [page('section/sub/page'), page('section/other'), page('mine/generated')]);
  fs.mkdirSync(path.join(site, 'content', 'mine'));
  run(site, ['generate']);
  assert.ok(exists(site, 'content', 'section', 'sub', 'page', 'index.md'));
  run(site, ['clean', '-f']);
  assert.deepStrictEqual(content(site), ['_index.md', 'mine']);
  assert.ok(!exists(site, manifestName));
  fs.writeFileSync(path.join(site, 'data', 'articles.json'), JSON.stringify({ articles: [page('section')] }));
  assert.strictEqual(run(site, ['generate']).status, 0);
});

test('a parent folder that got other content is kept', (t) => {
  const site = makeSite(t, [page('section/page')]);
  run(site, ['generate']);
  fs.writeFileSync(path.join(site, 'content', 'section', '_index.md'), 'mine\n');
  run(site, ['clean', '-f']);
  assert.deepStrictEqual(fs.readdirSync(path.join(site, 'content', 'section')), ['_index.md']);
  assert.ok(!exists(site, manifestName));
});

test('manifest entries outside of the content folder are never removed', (t) => {
  const site = makeSite(t, [page('one')]);
  fs.mkdirSync(path.join(site, 'layouts'));
  run(site, ['generate']);
  const manifestPath = path.join(site, manifestName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.pages['layouts'] = 'x';
  manifest.pages['content'] = 'x';
  manifest.folders.push('layouts', '..');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = run(site, ['clean', '-f']);
  assert.strictEqual(result.status, 0, result.output);
  assert.ok(exists(site, 'layouts'));
  assert.deepStrictEqual(content(site), ['_index.md']);
});

test('a broken manifest is reported instead of guessed at', (t) => {
  const site = makeSite(t, [page('one')]);
  fs.writeFileSync(path.join(site, manifestName), '[');
  for (const args of [['generate'], ['clean', '-f']]) {
    const result = run(site, args);
    assert.strictEqual(result.status, 1, result.output);
    assert.match(result.stderr, /Could not read .*\.hugo-data-to-pages\.json/);
  }
  assert.deepStrictEqual(content(site), ['_index.md']);
});

test('yaml, toml and json are read, everything else in the data folder is skipped', (t) => {
  const site = makeSite(t, [page('from-json')]);
  const data = path.join(site, 'data');
  fs.writeFileSync(path.join(data, 'more.yaml'), 'articles:\n  - path: from-yaml\n    fields:\n      born: 1940-10-09\n');
  fs.writeFileSync(path.join(data, 'more.yml'), 'articles:\n  - path: from-yml\n    fields: {name: x}\n');
  fs.writeFileSync(path.join(data, 'more.toml'), '[[articles]]\npath = "from-toml"\n[articles.fields]\nname = "x"\n');
  fs.writeFileSync(path.join(data, 'unrelated.yaml'), 'menu:\n  - home\n');
  fs.writeFileSync(path.join(data, 'empty.yaml'), '');
  fs.writeFileSync(path.join(data, '.DS_Store'), 'junk');
  fs.writeFileSync(path.join(data, 'notes.txt'), 'junk');
  fs.mkdirSync(path.join(data, 'nested.json'));
  const result = run(site, ['generate']);
  assert.strictEqual(result.status, 0, result.output);
  assert.deepStrictEqual(content(site), ['_index.md', 'from-json', 'from-toml', 'from-yaml', 'from-yml']);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(site, 'content', 'from-yaml', 'index.md'), 'utf8')).born, '1940-10-09T00:00:00.000Z');
});

test('a data file that cannot be parsed is an error', (t) => {
  const site = makeSite(t, [page('one')]);
  fs.writeFileSync(path.join(site, 'data', 'broken.json'), '{');
  const result = run(site, ['generate']);
  assert.strictEqual(result.status, 1, result.output);
  assert.match(result.stderr, /Could not parse broken\.json/);
  assert.deepStrictEqual(content(site), ['_index.md']);
});

test('a missing data folder is an error', (t) => {
  const site = makeSite(t, [page('one')], { config: { dataFolder: 'nope' } });
  const result = run(site, ['generate']);
  assert.strictEqual(result.status, 1, result.output);
  assert.match(result.stderr, /Could not read data folder/);
});

test('pages can be a list at the root of the data file', (t) => {
  const site = makeSite(t, [], { config: { pages: '' } });
  fs.writeFileSync(path.join(site, 'data', 'articles.json'), JSON.stringify([page('one')]));
  assert.strictEqual(run(site, ['generate']).status, 0);
  assert.deepStrictEqual(content(site), ['_index.md', 'one']);
});

test('contentPath and type can be overridden, an empty contentPath is refused', (t) => {
  const site = makeSite(t, [page('one')], { config: { contentPath: 'content2', type: 'post' } });
  assert.strictEqual(run(site, ['generate']).status, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(site, 'content2', 'one', 'index.md'), 'utf8')).type, 'post');
  assert.deepStrictEqual(content(site), ['_index.md']);

  const refused = makeSite(t, [page('one')], { config: { contentPath: '' } });
  assert.strictEqual(run(refused, ['generate']).status, 1);
  assert.deepStrictEqual(content(refused), ['_index.md']);
});

test('the config file is found from the current directory or by absolute path', (t) => {
  const site = makeSite(t, [page('one')]);
  const elsewhere = spawnSync(process.execPath, [script, 'generate', '-c', path.join(site, 'config.json')], { cwd: os.tmpdir(), encoding: 'utf8', input: '' });
  assert.strictEqual(elsewhere.status, 0, elsewhere.stderr);
  assert.deepStrictEqual(content(site), ['_index.md', 'one']);

  const missing = spawnSync(process.execPath, [script, 'generate', '-c', 'missing.json'], { cwd: site, encoding: 'utf8', input: '' });
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /Could not read config file missing\.json/);
});

test('server mode removes the pages when the server is interrupted', { skip: process.platform === 'win32' }, async (t) => {
  const site = makeSite(t, [page('one')], { hugo: 'wait' });
  const child = spawn(process.execPath, [script, 'server', '-f', '-c', 'config.json'], { cwd: site, detached: true, stdio: 'ignore' });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {} });
  for (let i = 0; i < 100 && !exists(site, 'content', 'one', 'index.md'); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(exists(site, 'content', 'one', 'index.md'));
  await new Promise((resolve) => setTimeout(resolve, 300)); //Giving the server stub a moment to start
  process.kill(-child.pid, 'SIGINT'); //Same as ctrl+c: goes to the script and to the server
  assert.strictEqual(await exited, 0);
  assert.deepStrictEqual(content(site), ['_index.md']);
  assert.ok(!exists(site, manifestName));
});

test('the example site builds with the real hugo', { skip: !isAvailable('hugo') }, (t) => {
  const site = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hugo-data-to-pages-')));
  t.after(() => fs.rmSync(site, { recursive: true, force: true }));
  const example = path.join(__dirname, '..', 'example');
  for (const folder of ['content', 'data', 'layouts']) fs.cpSync(path.join(example, folder), path.join(site, folder), { recursive: true });
  fs.copyFileSync(path.join(example, 'config.toml'), path.join(site, 'config.toml'));
  fs.writeFileSync(path.join(site, 'config.json'), JSON.stringify({ root: site }));
  const result = run(site, ['-f']);
  assert.strictEqual(result.status, 0, result.output);
  assert.deepStrictEqual(content(site), ['_index.md']);
  const built = fs.readFileSync(path.join(site, 'public', 'john-lennon', 'index.html'), 'utf8');
  assert.match(built, /<h1>John Lennon<\/h1>/);
  assert.match(built, /Birthday: 1940-10-09/);
  assert.match(built, /Children: 2/);
});
