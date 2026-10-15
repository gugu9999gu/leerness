'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0323 (owner request 2026-09-30): data features get the CRUD operations they need, by default and in every
// leerness project. The owner chose "guidance plus an automatic check at completion" (advisory, never blocking),
// for new features and changes to existing ones, and "the four operations plus quality items" as the standard:
//   AGENTS.md (standard mode, ko/en) carries a CRUD-by-default rule; `leerness lens crud` holds six questions;
//   review-request prints a CRUD checklist for a data request; verify-claim adds a crud line to its lens block when
//   the claimed files create and read a resource but never update or delete it (or asks the first question on
//   another data surface), without displacing any existing lens line, and reports the same in --json.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const C = require('../lib/crud-check');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-crud-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1' };
delete env.LEERNESS_LANG;
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let seq = 0, passed = 0, failed = 0;
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
const test = (name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const run = (dir, args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
const must = (r, label) => { assert.ifError(r.error); assert.strictEqual(r.status, 0, label + ' exit ' + r.status + '\n' + r.stdout + r.stderr); return r.stdout; };
const json = (r, label) => { const out = String(r.stdout || ''); try { return JSON.parse(out.slice(out.indexOf('{'))); } catch (e) { throw new Error(label + ': not JSON (exit ' + r.status + ')\n' + out.slice(0, 800) + r.stderr); } };
const HANGUL = /[가-힣]/;
const install = (command, lang, extra = []) => [command, '.', '--yes', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner', ...(lang ? ['--language', lang] : []), ...extra];
const project = (lang, extra) => {
  const dir = path.join(arena, (++seq) + '-' + lang); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  must(run(dir, install('init', lang, extra)), 'init');
  return dir;
};
const write = (dir, rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
// A done task whose evidence claims `files`, then verify-claim (text and --json).
const claim = (dir, files) => {
  const added = must(run(dir, ['task', 'add', 'Data work ' + (++seq), '--status', 'in-progress', '--path', dir]), 'task add');
  const id = (added.match(/T-\d{4}/) || [])[0]; assert.ok(id, added);
  must(run(dir, ['task', 'update', id, '--status', 'done', '--evidence', `Files: ${files.join(', ')}. Command: node --test; Exit: 0; Tests: 3/3`, '--path', dir]), 'task update');
  const text = run(dir, ['verify-claim', id, '--path', dir]);
  return { id, code: text.status, text: String(text.stdout || '') + String(text.stderr || ''), json: json(run(dir, ['verify-claim', id, '--json', '--path', dir]), 'verify-claim --json') };
};
const lensBlock = out => { const i = out.search(/품질 렌즈|Quality lens/); return i < 0 ? '' : out.slice(i, out.indexOf('\n\n', i) < 0 ? undefined : out.indexOf('\n\n', i)); };

const HALF = "const router = require('express').Router();\nrouter.get('/', list);\nrouter.post('/', create);\nrouter.get('/:id', show);\nmodule.exports = router;\n";
const FULL = "const router = require('express').Router();\nrouter.get('/', list);\nrouter.post('/', create);\nrouter.get('/:id', show);\nrouter.put('/:id', update);\nrouter.delete('/:id', remove);\nmodule.exports = router;\n";

test('request signal: data requests in both languages match, ordinary work does not', () => {
  const data = ['회원 관리 기능 추가해줘', '게시판 만들어줘 글 등록 수정 삭제', '상품 목록 페이지와 상세 페이지 구현', '주문 내역 조회 기능 추가', '예약 기능 구현해줘',
    '재고 관리 화면 만들어줘', '할 일 목록 앱 만들어줘', '댓글 기능 추가', 'DB 테이블 설계하고 API 만들어줘', 'Supabase 로 게시글 저장', '고객 정보 수정 기능 추가',
    'Add a products page with create and edit forms', 'Build a todo app', 'Implement order management for admins', 'Add CRUD endpoints for customers',
    'Let users manage their bookmarks', 'Create an invoices list with delete', 'Store blog posts in Postgres', 'Save contacts to the database',
    'Implement sqlite persistence', 'Use postgres for persistence'];   // database names in any case (cross-model review)
  const other = ['README 오타 수정', '로그인 버그 수정', '다크 모드 추가', '빌드 속도 개선', '코드 리팩토링해줘', '불필요한 코드 삭제', '번역 문구 수정', '제품 소개 페이지 디자인 개선',
    '결제 기능 추가 구현', '랜딩 페이지 만들어줘', 'Fix the login redirect bug', 'Add dark mode', 'Update the README', 'Remove unused imports', 'Add comments to the code',
    'Add code reviews to the workflow', 'Change the sort order of the menu', 'Add release notes', 'Build the product landing page', 'Implement retry with backoff'];
  for (const s of data) assert.ok(C.requestSignal(s).signal, 'missed: ' + s);
  for (const s of other) assert.ok(!C.requestSignal(s).signal, 'false signal: ' + s + ' ' + JSON.stringify(C.requestSignal(s).matched));
  // A verb alone is not a data request; the same verb with a data noun is.
  assert.ok(!C.requestSignal('이 파일 삭제').signal && C.requestSignal('게시글 삭제').signal);
});

test('routes, resource declarations and data clients map to create, read, update and delete', () => {
  const ops = (f, s) => { const m = {}; for (const e of C.crudOpsFromSource(f, s)) (m[e.resource] = m[e.resource] || new Set()).add(e.op); return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, ['C', 'R', 'U', 'D'].filter(o => v.has(o)).join('')])); };
  const cases = [
    ['routes/posts.js', HALF, { posts: 'CR' }],                                                  // mounted router: named after its file
    ['server.js', "app.get('/api/v1/orders', a); app.post('/api/orders', b); app.delete('/api/orders/:id', c);", { orders: 'CRD' }],
    ['src/posts/posts.controller.ts', "@Controller('posts') class P { @Get() a() {} @Get(':id') b() {} @Post() c() {} @Patch(':id') d() {} }", { posts: 'CRU' }],
    ['OrderController.java', '@RequestMapping("/orders") class O { @GetMapping List a() {} @PostMapping O b() {} @DeleteMapping("/{id}") void c() {} }', { orders: 'CRD' }],
    ['app/main.py', '@app.get("/items")\n@app.post("/items")\n@app.put("/items/{item_id}")\n@app.delete("/items/{item_id}")\n', { items: 'CRUD' }],
    ['app/routers/pets.py', 'router = APIRouter(prefix="/pets")\n@router.get("/")\n@router.post("/")\n', { pets: 'CR' }],
    ['app/views.py', "@app.route('/notes', methods=['GET', 'POST'])\n", { notes: 'CR' }],
    ['app/api/products/route.ts', 'export async function GET() {}\nexport async function POST(req) {}', { products: 'CR' }],
    ['app/api/products/[id]/route.ts', 'export async function GET() {}\nexport const PATCH = async () => {};', { products: 'RU' }],
    ['pages/api/tasks/[id].ts', "if (req.method === 'GET') {} if (req.method === 'DELETE') {}", { tasks: 'RD' }],
    ['routes/web.php', "Route::resource('photos', P::class)->only(['index', 'show', 'store']); Route::apiResource('tags', T::class);", { photos: 'CR', tags: 'CRUD' }],
    ['config/routes.rb', 'resources :articles\nresources :comments, only: [:create, :destroy]\n', { articles: 'CRUD', comments: 'CD' }],
    ['blog/api.py', 'class PostViewSet(viewsets.ModelViewSet):\n  pass\nclass AuthorList(generics.ListCreateAPIView):\n  pass\n', { post: 'CRUD', author: 'CR' }],
    ['main.go', 'r.GET("/albums", a)\nr.POST("/albums", b)\nmux.HandleFunc("DELETE /albums/{id}", c)', { albums: 'CRD' }],
    ['web/Todo.tsx', "fetch('/api/todos', { method: 'POST', headers: { a: 1 }, body }); fetch('/api/todos'); fetch(`/api/todos/${id}`, { method: 'DELETE' });", { todos: 'CRD' }],
    ['web/api.js', "api.post('/notes', n); api.get('/notes'); axios.put(`/notes/${id}`, n);", { notes: 'CRU' }],
    ['lib/comments.service.ts', 'await prisma.comment.create({}); await this.prisma.comment.findMany(); await db.comment.update({});', { comment: 'CRU' }],
    ['lib/supa.js', "await supabase.from('messages').insert(r); await supabase.from('messages').select('*');", { messages: 'CR' }],
    ['lib/fire.js', "addDoc(collection(db, 'photos'), x); getDocs(collection(db, 'photos')); deleteDoc(doc(db, 'photos', id));", { photos: 'CRD' }],
    ['routes/forms.js', "router.get('/entries/new', f); router.post('/entries', c); router.get('/entries/:id/edit', e); router.post('/entries/:id/edit', s); router.post('/entries/:id/delete', d); router.get('/entries', l);", { entries: 'CRUD' }],
  ];
  for (const [f, s, want] of cases) assert.deepStrictEqual(ops(f, s), want, f);
});

test('actions, infrastructure endpoints, comments and non-route calls name no resource', () => {
  const none = (f, s) => assert.deepStrictEqual(C.crudOpsFromSource(f, s), [], f + ': ' + s);
  none('server.js', "app.post('/api/login', a); app.get('/health', b); app.post('/api/webhooks/stripe', c); app.get('/api/search', d); app.post('/', e);");
  none('src/server.js', "app.post('/', x); app.get('/', y);");                     // the site root, not a resource named after src/
  none('jobs.js', "router.post('/jobs/:id/cancel', a); router.post('/approve', b); router.post('/checkout', c);");   // remote calls, not new records
  none('ai.js', "await client.messages.create({}); new Map().get('/x'); cache.get('/posts'); stripe.customers.create({});");
  none('types.ts', "/**\n * Found by static analysis (e.g. `supabase.from('orders').insert(...)`)\n */\n// app.post('/posts', x)\n");
  none('app/api.py', '# @app.delete("/posts/{id}")\n    # @app.post("/posts")\n');
});

test('comments hide operations even after code; a marker glued to other text ("/*", a regex) is not a comment', () => {
  // Cross-model review 2026-09-30: a trailing comment counted as update and delete; a "/*" string erased the code after it.
  const ops = (f, s) => C.crudFindings(C.crudOpsFromSource(f, s)).resources.map(r => r.resource + '=' + r.ops.join(''));
  assert.deepStrictEqual(ops('server.js', "app.post('/posts', create); app.get('/posts', list); // app.patch('/posts/:id', update); app.delete('/posts/:id', remove);"), ['posts=CR']);
  assert.deepStrictEqual(ops('server.js', 'const a = "/*"; app.get("/posts", list); app.post("/posts", create); const b = "*/";'), ['posts=CR']);
  assert.deepStrictEqual(ops('server.js', "const u = 'http://x//y'; app.get('/posts', a); app.post('/posts', b); /* app.delete('/posts/:id', c) */ app.put('/posts/:id', d);"), ['posts=CRU']);
  assert.deepStrictEqual(ops('app/main.py', '@app.get("/items")  # @app.delete("/items/{id}")\n@app.post("/items")\nx = "# not a comment"\n'), ['items=CR']);
  // Round 2: markers glued to other text are not comments (regex and template literals), a comment inside a template
  // interpolation still is, and each language keeps its own comment syntax.
  assert.deepStrictEqual(ops('server.js', 'const re = /[/*]/;\napp.post("/posts", create);\napp.get("/posts", list);\n'), ['posts=CR']);
  assert.deepStrictEqual(ops('server.js', 'const x = `${`/*`}`;\napp.post("/posts", create);\napp.get("/posts", list);\n'), ['posts=CR']);
  assert.deepStrictEqual(ops('server.js', 'app.post("/posts", create); app.get("/posts", list);\nconst x = `${1 /* app.put("/posts/:id", update); app.delete("/posts/:id", remove); */}`;\n'), ['posts=CR']);
  assert.deepStrictEqual(ops('app/routes.py', 'n = 5 // 2; router.post("/posts")(create); router.get("/posts")(list)\n'), ['posts=CR']);
  assert.deepStrictEqual(ops('config/routes.rb', '=begin\nresources :posts\n=end\nresources :notes, only: [:index, :create]\n'), ['notes=CR']);
  assert.deepStrictEqual(ops('lib/queue.js', "/* app.post('/jobs', a)\n   app.get('/jobs', b) */\napp.get('/items', c);\n"), ['items=R']);
  // Documented limit (review rounds 3 and 4): a marker after whitespace inside a string counts as a comment, and
  // " /* " hides the lines up to the next "*/"; hidden operations can silence a finding or produce a false one. If
  // this changes, update the limits described in CHANGELOG 1.36.295.
  assert.deepStrictEqual(ops('server.js', 'const marker = " /* ";\napp.post("/posts", create);\napp.get("/posts", list);\n'), []);
  assert.deepStrictEqual(ops('server.js', 'const marker = " // "; app.post("/posts", create);\napp.post("/notes", c);\napp.get("/notes", r);\n'), ['notes=CR']);
  // The reviewer's case: update and delete after the marker are hidden, so full CRUD reads as create and read only.
  assert.deepStrictEqual(C.crudFindings(C.crudOpsFromSource('server.js', 'app.post("/posts", create);\napp.get("/posts", list);\nconst marker = " /* ";\napp.put("/posts/:id", update);\napp.delete("/posts/:id", remove);\n')).findings,
    [{ resource: 'posts', present: ['C', 'R'], missing: ['U', 'D'] }]);
});

test('findings: created and read but never updated or deleted, and nothing else', () => {
  const f = entries => C.crudFindings(entries.map(([resource, op]) => ({ resource, op })));
  assert.deepStrictEqual(f([['posts', 'C'], ['posts', 'R']]).findings, [{ resource: 'posts', present: ['C', 'R'], missing: ['U', 'D'] }]);
  assert.deepStrictEqual(f([['posts', 'C'], ['post', 'R'], ['posts', 'U']]).findings, [{ resource: 'posts', present: ['C', 'R', 'U'], missing: ['D'] }]);   // posts and post are one
  for (const quiet of [[['posts', 'C'], ['posts', 'R'], ['posts', 'U'], ['posts', 'D']], [['events', 'C']], [['reports', 'R']], [['settings', 'R'], ['settings', 'U']]]) {
    assert.deepStrictEqual(f(quiet).findings, [], JSON.stringify(quiet));
  }
  const ko = C.findingLine({ resource: 'posts', present: ['C', 'R'], missing: ['U', 'D'] }, 'ko');
  const en = C.findingLine({ resource: 'posts', present: ['C', 'R', 'D'], missing: ['U'] }, 'en');
  assert.match(ko, /^crud: posts — 주장 파일에 생성·조회만 있음\(수정·삭제 없음\)/);
  assert.match(en, /^crud: posts — the claimed files only create, read and delete it \(no update\)/);
  assert.ok(!HANGUL.test(en), en);
});

test('adversarial inputs stay linear', () => {
  const gens = [n => 'a$'.repeat(n), n => '@a.'.repeat(n), n => 'Route::resource("x"'.repeat(n / 8), n => "fetch('/" + 'a'.repeat(n), n => 'class A(' + 'x'.repeat(n),
    n => '"GET /' + 'a'.repeat(n), n => '/*'.repeat(n), n => 'prisma.a.'.repeat(n), n => ".from('a')".repeat(n / 4), n => 'addDoc(collection(' + 'a.'.repeat(n)];
  for (const g of gens) {
    const input = g(400000), t = Date.now();
    C.crudFindings(C.crudOpsFromSource('src/routes/x.js', input));
    assert.ok(Date.now() - t < 3000, `${Date.now() - t}ms for ${input.slice(0, 20)}…`);
  }
  const t = Date.now(); C.requestSignal('회원 '.repeat(200000)); assert.ok(Date.now() - t < 3000);
  // Cross-model review 2026-09-30 (P1): a whitespace run after an opener that the rest of a pattern does not follow
  // was split between two \s* in quadratically many ways (@Get( + 128,000 spaces took 6.6 s). Every opener, 256K spaces.
  for (const opener of ['@Controller("posts")\n@Get(', "fetch('/api/x'", '@GetMapping(', '@RequestMapping(', "Route::resource('x'", "@app.route('/x'",
    'app.get(', 'prisma.a.', "addDoc(collection(db,", 'class A(', 'export ', "req.method", "r.GET("]) {
    const s = Date.now();
    C.crudOpsFromSource('src/posts.controller.ts', opener + ' '.repeat(262144) + 'x');
    assert.ok(Date.now() - s < 1500, `${Date.now() - s}ms after ${JSON.stringify(opener)}`);
  }
});

test('lens crud prints six questions in both languages, and the English lens list has no Korean', () => {
  const ko = project('ko'), en = project('en');
  const k = must(run(ko, ['lens', 'crud']), 'lens crud ko');
  assert.match(k, /## crud \(CRUD 완결성\)/);
  assert.strictEqual((k.match(/^ {2}\d\. /gm) || []).length, 6, k);
  const e = must(run(en, ['lens', 'crud']), 'lens crud en');
  assert.match(e, /## crud \(CRUD completeness\) — persona: the people who use and run that data every day/);
  assert.strictEqual((e.match(/^ {2}\d\. /gm) || []).length, 6, e);
  assert.ok(!HANGUL.test(must(run(en, ['lens']), 'lens en')), 'English lens output has Korean');
  const j = json(run(en, ['lens', 'crud', '--json']), 'lens --json').lenses.crud;
  assert.strictEqual(j.questions.length, 6); assert.strictEqual(j.questionsEn.length, 6);
});

test('review-request adds the CRUD checklist to a data request only, in text and JSON, in both languages', () => {
  for (const [lang, data, other, head] of [['ko', '상품 관리 기능 추가해줘', '로그인 버그 수정', '## 데이터 기능 CRUD 점검'], ['en', 'Add an admin page to manage products', 'Fix the login redirect bug', '## Data feature CRUD check']]) {
    const dir = project(lang);
    const out = must(run(dir, ['review-request', data]), 'review-request ' + lang);
    const i = out.indexOf(head); assert.ok(i >= 0, out);
    const section = out.slice(i, out.indexOf('\n\n', i));
    assert.match(section, /leerness lens crud/); assert.match(section, /\|---\|---\|---\|---\|---\|---\|/);
    if (lang === 'en') assert.ok(!HANGUL.test(section), section);
    const dj = json(run(dir, ['review-request', data, '--json']), 'rr json');
    assert.strictEqual(dj.crudCheck.signal, true); assert.deepStrictEqual(dj.crudCheck.operations, ['create', 'read', 'update', 'delete']);
    const nj = json(run(dir, ['review-request', other, '--json']), 'rr json other');
    assert.deepStrictEqual(nj.crudCheck, { signal: false });
    assert.strictEqual(dj.proceed, nj.proceed, 'the checklist must not change proceed');
    assert.ok(!must(run(dir, ['review-request', other]), 'rr other').includes(head));
  }
});

test('verify-claim adds a crud line for half CRUD and a question for other data surfaces, never blocks, and keeps the other lens lines', () => {
  for (const lang of ['ko', 'en']) {
    const dir = project(lang);
    write(dir, 'routes/posts.js', HALF); write(dir, 'routes/users.js', FULL);
    write(dir, 'db/migrations/001_create_posts.sql', 'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\n');
    write(dir, 'lib/slug.js', "module.exports = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');\n");
    const half = claim(dir, ['routes/posts.js']);
    assert.strictEqual(half.code, 0, half.text);
    const block = lensBlock(half.text);
    assert.match(block, lang === 'en' ? /· crud: posts — the claimed files only create and read it \(no update or delete\)/ : /· crud: posts — 주장 파일에 생성·조회만 있음\(수정·삭제 없음\)/, half.text);
    assert.match(block, /· code\(/);                                       // the lens lines it had before are still there
    assert.match(block, /leerness lens <[^>]*\|crud>/);
    assert.deepStrictEqual(half.json.crud.findings, [{ resource: 'posts', present: ['C', 'R'], missing: ['U', 'D'] }]);
    assert.strictEqual(half.json.ok, true, 'advisory must not fail the claim');
    const full = claim(dir, ['routes/users.js']);
    assert.match(lensBlock(full.text), lang === 'en' ? /· crud\(CRUD completeness\): Did you decide which operations each entity needs/ : /· crud\(CRUD 완결성\): 엔티티마다 필요한 조작/);
    assert.deepStrictEqual(full.json.crud.findings, []);
    const sql = claim(dir, ['db/migrations/001_create_posts.sql']);
    assert.match(lensBlock(sql.text), /· database\(/); assert.match(lensBlock(sql.text), /· crud\(/);
    const plain = claim(dir, ['lib/slug.js']);
    assert.ok(!/· crud/.test(plain.text) && !/lens <[^>]*crud/.test(plain.text), plain.text);
    if (lang === 'en') assert.ok(!HANGUL.test(block), block);
  }
});

test('fresh standard projects carry the CRUD rule; minimal projects stay as they were; migrate adds it once and keeps custom text', () => {
  const rule = { ko: '**데이터 기능 CRUD 기본값**', en: '**CRUD by default for data features**' };
  for (const lang of ['ko', 'en']) {
    const dir = project(lang);
    const file = path.join(dir, 'AGENTS.md'), agents = fs.readFileSync(file, 'utf8');
    assert.strictEqual(agents.split(rule[lang]).length, 2, lang + ' rule missing or repeated');
    const line = agents.split('\n').find(l => l.includes(rule[lang]));
    assert.match(line, /leerness lens crud/);
    if (lang === 'en') assert.ok(!HANGUL.test(line), line);
    const min = project(lang, ['--mode', 'minimal']);
    assert.ok(!fs.readFileSync(path.join(min, 'AGENTS.md'), 'utf8').includes(rule[lang]), 'minimal mode AGENTS.md grew');
    // An existing project: the same file without the new line, a custom section, and the previous harness version.
    const custom = 'CUSTOM-KEEP 사용자 지침 ' + lang;
    fs.writeFileSync(file, agents.replace(line + '\n', '').trimEnd() + '\n\n## Project notes\n' + custom + '\n');
    fs.writeFileSync(path.join(dir, '.leerness', 'HARNESS_VERSION'), '1.36.294\n');
    assert.ok(!fs.readFileSync(file, 'utf8').includes(rule[lang]), 'setup: the old file must not have the rule');
    for (let i = 0; i < 2; i++) {
      must(run(dir, install('migrate', null)), 'migrate');
      const after = fs.readFileSync(file, 'utf8');
      assert.strictEqual(after.split(rule[lang]).length, 2, 'rule after migrate ' + (i + 1));
      assert.strictEqual(after.split(custom).length, 2, 'custom text after migrate ' + (i + 1));
    }
  }
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
