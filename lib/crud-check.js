// lib/crud-check.js — T-0323 (owner request 2026-09-30): features that store or manage data get the create, read,
// update and delete operations they need. Two advisory signals; neither blocks anything:
//   requestSignal(text)      review-request: does the request work with stored data? Then it prints a CRUD checklist.
//   crudOpsFromSource(f, s)  verify-claim: which operations do the claimed files perform, on which resource?
//   crudFindings(entries)    resources the claimed files create but never read, update or delete.
// Both stay narrow on purpose. A request needs an explicit data term, or a data noun together with an operation word:
// verbs alone (수정, fix, delete this file) appear in every bug fix and cleanup. The code side reads only explicit
// route, resource and data-client call shapes, and a gap is a question ("elsewhere, or not needed?"), not a failure:
// many resources are rightly append-only, and the other operations may live in files the claim does not list.
'use strict';

// ── Request signal ──────────────────────────────────────────────────────────────────────────────────────────────
const EXPLICIT_RES = [
  /\bcrud\b/i,
  /데이터베이스|\bdatabase\b|\bDB\b|엔티티|\bentit(?:y|ies)\b/i,
  /\b(?:ORM|Prisma|Supabase|Firestore|Firebase|Mongoose|Sequelize|TypeORM|Drizzle|SQLite|Postgres(?:QL)?|MySQL|MongoDB|DynamoDB)\b/i,
];
// Nouns that name records people keep and manage. Ambiguous words are left out on purpose: "comments", "notes",
// "reviews" and "tags" also mean code comments, release notes, code reviews and HTML or git tags, and a singular
// "product" or "order" is as often a landing page or a sort order as a record.
const NOUN_RES = [
  /게시판|게시글|게시물|댓글|회원|상품|주문|예약|재고|장바구니|카테고리|할\s?일|투두|일정|주소록|연락처|메모|후기|문의|공지|쿠폰|포인트|고객|직원|학생|거래처|매출|북마크|즐겨찾기|앨범|배송지|계정/,
  /\b(?:posts|blog posts?|articles|members|products|orders|order (?:management|history)|purchase orders?|bookings?|reservations?|inventory|shopping carts?|categories|todos?|to-dos?|contacts|customer reviews|product reviews|inquiries|announcements|coupons|customers|employees|students|invoices|bookmarks|favorites|albums|user accounts|user list|user management|records)\b/i,
];
const OP_RES = [
  /등록|추가|생성|작성|목록|조회|상세|수정|편집|변경|삭제|제거|저장|관리|업로드|구현|만들|개발/,
  /\b(?:create|add|list|view|show|detail|details|edit|update|change|delete|remove|save|store|manage|management|admin|build|implement|make|develop)\b/i,
];
function requestSignal(text) {
  const s = String(text || '');
  const hits = res => res.map(re => (s.match(re) || [])[0]).filter(Boolean);
  const explicit = hits(EXPLICIT_RES);
  if (explicit.length) return { signal: true, matched: [...new Set(explicit)] };
  const nouns = hits(NOUN_RES), ops = hits(OP_RES);
  if (nouns.length && ops.length) return { signal: true, matched: [...new Set([...nouns, ...ops])] };
  return { signal: false, matched: [] };
}

// ── Code: which operations do the claimed files perform, on which resource ─────────────────────────────────────
const METHOD_OP = { post: 'C', get: 'R', put: 'U', patch: 'U', delete: 'D', del: 'D' };
// A path with one of these segments names an action or an infrastructure endpoint, not a collection of records.
const ACTION_SEGMENTS = new Set(['login', 'logout', 'signin', 'signout', 'signup', 'register', 'auth', 'oauth', 'token', 'tokens',
  'refresh', 'callback', 'callbacks', 'webhook', 'webhooks', 'health', 'healthz', 'ping', 'status', 'search', 'upload', 'uploads',
  'download', 'downloads', 'export', 'import', 'verify', 'confirm', 'reset', 'send', 'publish', 'unpublish', 'subscribe',
  'unsubscribe', 'like', 'unlike', 'follow', 'unfollow', 'me', 'session', 'sessions', 'graphql', 'metrics', 'ready', 'live',
  'version', 'stats', 'count', 'bulk', 'batch', 'sync', 'preview', 'sse', 'ws', 'socket', 'cron']);
// Form-style routes name the operation in the path: POST /posts/:id/delete deletes a post; GET /posts/new is a form.
const VERB_SEGMENT_OP = { new: 'C', create: 'C', add: 'C', edit: 'U', update: 'U', delete: 'D', destroy: 'D', remove: 'D' };
const PREFIX_SEGMENTS = /^(?:api|v\d+|rest|public|private|admin|internal)$/;
const PARAM_SEGMENT = /^(?::|\*|\$)|^\{.*\}$|^\[.*\]$|^<.*>$|^\(.*\)$|^@/;
// Route receivers: servers and HTTP clients alike (a page that creates and lists but never deletes raises the same
// question). Plain objects, maps and caches are not receivers here.
const ROUTE_RECEIVER = /^(?:app|router|routes?|server|fastify|hono|api|axios|http|\$http|instance|ky|superagent|r|e|g|group|mux|v\d+)$|(?:Router|router|Routes|routes|Api|api|Group|group)$/;

function singular(seg) { return seg.replace(/ies$/, 'y').replace(/([^s])s$/, '$1'); }
// POST creates only on a collection: /posts, /workspaces/:id/invites. On anything else (/jobs/:id/cancel, /approve,
// /checkout) it is a remote call, not a new record. Measured on 30 real projects: counting every POST as a create
// turned such calls into most of the findings.
const COLLECTION = /^[a-z][\w-]*[^s]s$/;
// ('/api/v1/posts/:id/comments', 'post') → { resource: 'posts/comments', op: 'C' }. Null for actions and form pages.
function routeOp(p, method, fallback) {
  const m = String(method || '').toLowerCase();
  const segs = String(p || '').split(/[?#]/)[0].split('/').filter(Boolean).filter(s => !PARAM_SEGMENT.test(s)).map(s => s.toLowerCase());
  while (segs.length && PREFIX_SEGMENTS.test(segs[0])) segs.shift();
  if (segs.some(s => ACTION_SEGMENTS.has(s))) return null;
  const last = segs[segs.length - 1];
  if (last && VERB_SEGMENT_OP[last]) {
    const parent = segs.length > 1 ? segs.slice(0, -1).join('/') : fallback;
    return m === 'get' || !parent ? null : { resource: parent, op: VERB_SEGMENT_OP[last] };
  }
  const resource = segs.length ? segs.join('/') : fallback;
  if (!resource || !METHOD_OP[m]) return null;
  if (METHOD_OP[m] === 'C' && !COLLECTION.test(resource.split('/').pop())) return null;
  return { resource, op: METHOD_OP[m] };
}
// A router file mounted elsewhere ('/' and '/:id' inside routes/posts.js) is named after its file, or after its
// folder for posts/index.js. Generic names (server.js in src/) name nothing: '/' there is the site root.
const GENERIC_NAMES = /^(?:index|main|app|server|routes?|router|api|handlers?|views?|controllers?|urls|src|lib|backend|frontend|web|client|services?|pages|components|utils|public|internal)$/i;
function resourceFromFile(f) {
  const parts = String(f || '').replace(/\\/g, '/').split('/');
  let base = (parts.pop() || '').replace(/\.[^.]+$/, '').replace(/[._-](?:routes?|router|controller|api|handlers?|views?|endpoints?|service)$/i, '');
  if (GENERIC_NAMES.test(base)) base = parts.pop() || '';
  base = base.toLowerCase();
  return base && /^[a-z][\w-]*$/.test(base) && !GENERIC_NAMES.test(base) && !ACTION_SEGMENTS.has(base) && !PREFIX_SEGMENTS.test(base) ? base : null;
}
const join = (a, b) => [a, b].filter(Boolean).join('/');
// Rails/Laravel resource actions → operations.
const ACTION_OP = { index: 'R', show: 'R', create: 'C', store: 'C', new: 'C', edit: 'U', update: 'U', destroy: 'D' };
function resourceActions(only, except) {
  const all = ['index', 'show', 'create', 'store', 'update', 'destroy'];
  const names = s => (String(s || '').match(/[a-z_]+/g) || []);
  const kept = only != null ? names(only) : all.filter(a => !names(except).includes(a));
  return [...new Set(kept.map(a => ACTION_OP[a]).filter(Boolean))];
}
// Django / DRF class-based views: the base class says which operations the view performs.
const DJANGO_BASE_OPS = [
  [/\bModelViewSet\b/, 'CRUD'], [/\bReadOnlyModelViewSet\b/, 'R'], [/\bRetrieveUpdateDestroyAPIView\b/, 'RUD'], [/\bRetrieveUpdateAPIView\b/, 'RU'],
  [/\bRetrieveDestroyAPIView\b/, 'RD'], [/\bListCreateAPIView\b/, 'CR'], [/\b(?:ListAPIView|RetrieveAPIView|ListView|DetailView)\b/, 'R'],
  [/\b(?:CreateAPIView|CreateView|CreateModelMixin)\b/, 'C'], [/\b(?:UpdateAPIView|UpdateView|UpdateModelMixin)\b/, 'U'],
  [/\b(?:DestroyAPIView|DeleteView|DestroyModelMixin)\b/, 'D'], [/\b(?:ListModelMixin|RetrieveModelMixin)\b/, 'R'],
];

// Comments are dropped first: a doc comment that shows `supabase.from('orders').insert(...)` as an example is not an
// insert (seen in a real project), and neither is `// app.delete(...)` after the code on the same line.
// Comment markers count only at the start of a line or after whitespace, and only in languages that have them:
// '//' and '/*' in C-like files, '#' in Python, Ruby and PHP, Ruby's =begin/=end blocks. That leaves a marker glued
// to other text alone: '/*' in the regex /[/*]/, in `${`/*`}` or "/*", '//' in a URL or in Python's floor division
// (cross-model review 2026-09-30, rounds 1 and 2: a string-tracking scanner erased code after regex and template
// literals). The cost: a comment glued to code (`x;//y`) is read as code, and a marker after whitespace inside a
// string is read as a comment. " // " in a string hides the rest of that line; " /* " hides everything up to the next
// "*/", which can be the rest of the file (review rounds 3 and 4; a documented limit of this advisory check). Hidden
// operations can silence a finding, or produce a false one: a create and a read before such a marker and the update
// and delete after it read as "no update or delete". One pass per line, linear.
const C_LIKE = /\.(?:js|mjs|cjs|jsx|ts|tsx|vue|svelte|java|cs|go|rs|php|kt|kts|scala|swift|dart)$/i;
const HASH_COMMENT = /\.(?:py|rb|php)$/i;
function stripComments(text, file) {
  const f = String(file || ''), slash = C_LIKE.test(f), hash = HASH_COMMENT.test(f), ruby = /\.rb$/i.test(f);
  const at = (line, k) => k === 0 || line[k - 1] === ' ' || line[k - 1] === '\t';
  const out = [];
  let block = false, rubyBlock = false;
  for (let line of String(text || '').split('\n')) {
    if (ruby) { if (rubyBlock) { if (/^=end\b/.test(line)) rubyBlock = false; out.push(''); continue; } if (/^=begin\b/.test(line)) { rubyBlock = true; out.push(''); continue; } }
    let kept = '', k = 0;
    while (k < line.length) {
      if (block) { const e = line.indexOf('*/', k); if (e < 0) { k = line.length; break; } block = false; k = e + 2; continue; }
      const c = line[k];
      if (slash && c === '/' && line[k + 1] === '*' && at(line, k)) { block = true; k += 2; continue; }
      if (((slash && c === '/' && line[k + 1] === '/') || (hash && c === '#')) && at(line, k)) break;
      kept += c; k++;
    }
    out.push(kept);
  }
  return out.join('\n');
}
function crudOpsFromSource(file, text) {
  const f = String(file || '').replace(/\\/g, '/');
  const src = stripComments(text, f);
  const out = [];
  const add = (hit, kind) => { if (hit && hit.resource && hit.op) out.push({ resource: hit.resource, op: hit.op, kind }); };
  const addOps = (resource, ops, kind) => { for (const op of ops || '') add({ resource, op }, kind); };
  // A FastAPI router or Flask blueprint prefix names the resource of its '/' routes; otherwise the file does.
  const pre = src.match(/\b(?:APIRouter\s*\([^)]{0,200}?\bprefix|url_prefix)\s*=\s*(['"])([^'"]{0,200})\1/);
  const fileRes = (pre && routeOp(pre[2], 'get') || {}).resource || resourceFromFile(f);
  // Express, Koa, Fastify, Hono, Gin/Echo/Fiber (r.GET), FastAPI decorators (@app.get) and HTTP clients (axios.post).
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]{0,40})\s*\.\s*(get|post|put|patch|delete|del)\s*\(\s*(['"`])(\/[^'"`\s]{0,200})\3/gi)) {
    if (ROUTE_RECEIVER.test(m[1])) add(routeOp(m[4], m[2], fileRes), 'route');
  }
  // fetch('/api/posts') reads; fetch('/api/posts', { method: 'DELETE' }) deletes.
  for (const m of src.matchAll(/\bfetch\s*\(\s*(['"`])(\/[^'"`\s]{0,200})\1\s*(?:,\s*\{([\s\S]{0,300}?)\}\s*)?\)/g)) {
    const mm = (m[3] || '').match(/\bmethod\s*:\s*(['"`])(GET|POST|PUT|PATCH|DELETE)\1/i);
    add(routeOp(m[2], mm ? mm[2] : 'get', null), 'client');
  }
  // Go 1.22 ServeMux patterns: mux.HandleFunc("DELETE /posts/{id}", …)
  for (const m of src.matchAll(/(['"`])(GET|POST|PUT|PATCH|DELETE)\s+(\/[^'"`\s]{0,200})\1/g)) add(routeOp(m[3], m[2], fileRes), 'route');
  // Flask: @app.route('/posts', methods=['GET', 'POST']) — no methods means GET.
  for (const m of src.matchAll(/@[\w.]{1,80}\.route\(\s*(['"])(\/[^'"]{0,200})\1\s*(?:,\s*methods\s*=\s*[[(]([^\])]{0,120})[\])])?/g)) {
    for (const meth of (m[3] ? m[3].match(/[A-Za-z]+/g) || [] : ['GET'])) add(routeOp(m[2], meth, fileRes), 'route');
  }
  // NestJS: @Controller('posts') + @Get(':id') / @Post() …
  if (/@Controller\s*\(/.test(src)) {
    const pm = src.match(/@Controller\s*\(\s*(?:\{\s*path\s*:\s*)?(['"`])([^'"`]{0,200})\1/);
    for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:(['"`])([^'"`]{0,200})\2\s*)?\)/g)) add(routeOp(join(pm ? pm[2] : '', m[3] || ''), m[1], fileRes), 'route');
  }
  // Spring: @RequestMapping("/posts") + @GetMapping("/{id}") …
  if (/@(?:Get|Post|Put|Patch|Delete|Request)Mapping\b/.test(src)) {
    const pm = src.match(/@RequestMapping\s*\(\s*(?:(?:value|path)\s*=\s*)?(?:\{\s*)?"([^"]{0,200})"/);
    for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping\b(?:\s*\(\s*(?:(?:value|path)\s*=\s*)?(?:\{\s*)?"([^"]{0,200})")?/g)) add(routeOp(join(pm ? pm[1] : '', m[2] || ''), m[1], fileRes), 'route');
  }
  // Laravel: Route::get('posts', …) and Route::resource('posts', …)->only([...]); Rails: resources :posts, only: [...]
  for (const m of src.matchAll(/Route::(get|post|put|patch|delete)\s*\(\s*(['"])([^'"]{0,200})\2/gi)) add(routeOp('/' + m[3], m[1], fileRes), 'route');
  for (const m of src.matchAll(/Route::(?:api)?[Rr]esource\s*\(\s*(['"])([\w./-]+)\1[^;]{0,300}?(?:->(only|except)\s*\(\s*\[([^\]]{0,200})\]\s*\))?\s*;/g)) {
    const r = routeOp('/' + m[2], 'get'); if (r) addOps(r.resource, resourceActions(m[3] === 'only' ? m[4] : null, m[3] === 'except' ? m[4] : null).join(''), 'route');
  }
  for (const m of src.matchAll(/\bresources?\s+:(\w+)(?:\s*,\s*(only|except):\s*\[([^\]]{0,200})\])?/g)) {
    addOps(m[1].toLowerCase(), resourceActions(m[2] === 'only' ? m[3] : null, m[2] === 'except' ? m[3] : null).join(''), 'route');
  }
  // Django / DRF: class PostViewSet(viewsets.ModelViewSet) → post: CRUD.
  for (const m of src.matchAll(/\bclass\s+([A-Z]\w*)\s*\(([^)]{0,200})\)\s*:/g)) {
    const base = DJANGO_BASE_OPS.filter(([re]) => re.test(m[2])).map(([, ops]) => ops).join('');
    const name = m[1].replace(/(?:ViewSet|APIView|View|List|Create|Detail|Update|Delete|Destroy|Retrieve)+$/, '').toLowerCase();
    if (base && name) addOps(name, [...new Set(base)].join(''), 'route');
  }
  // Next.js App Router (app/**/route.ts exports GET/POST/…) and Pages API routes (req.method checks).
  const app = f.match(/(?:^|\/)app\/((?:[^/]+\/)*)route\.(?:js|jsx|ts|tsx|mjs|cjs)$/);
  if (app) {
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g)) add(routeOp(app[1], m[1] || m[2], null), 'route');
  }
  const pages = f.match(/(?:^|\/)pages\/api\/(.+)\.(?:js|jsx|ts|tsx|mjs|cjs)$/);
  if (pages) {
    for (const m of src.matchAll(/req\.method\s*===?\s*['"](GET|POST|PUT|PATCH|DELETE)['"]|case\s+['"](GET|POST|PUT|PATCH|DELETE)['"]\s*:/g)) add(routeOp(pages[1].replace(/(?:^|\/)index$/, ''), m[1] || m[2], null), 'route');
  }
  // Prisma: prisma.post.create(…) / db.post.findMany(…)
  const PRISMA = { create: 'C', createMany: 'C', createManyAndReturn: 'C', upsert: 'CU', findMany: 'R', findFirst: 'R', findFirstOrThrow: 'R',
    findUnique: 'R', findUniqueOrThrow: 'R', count: 'R', aggregate: 'R', groupBy: 'R', update: 'U', updateMany: 'U', delete: 'D', deleteMany: 'D' };
  for (const m of src.matchAll(/\b(?:prisma|db|tx)\s*\.\s*([a-z]\w*)\s*\.\s*(\w+)\s*\(/g)) addOps(m[1].toLowerCase(), PRISMA[m[2]], 'data');
  // Supabase: .from('posts').insert(…) / .select(…) / .update(…) / .delete()
  const SUPA = { insert: 'C', upsert: 'CU', select: 'R', update: 'U', delete: 'D' };
  for (const m of src.matchAll(/\.from\(\s*(['"`])([\w.-]+)\1\s*\)\s*\.\s*(insert|upsert|select|update|delete)\s*\(/g)) addOps(m[2].toLowerCase(), SUPA[m[3]], 'data');
  // Firestore (modular): addDoc(collection(db, 'posts'), …) / deleteDoc(doc(db, 'posts', id))
  const FIRE = { addDoc: 'C', setDoc: 'C', getDoc: 'R', getDocs: 'R', updateDoc: 'U', deleteDoc: 'D' };
  for (const m of src.matchAll(/\b(addDoc|setDoc|getDocs?|updateDoc|deleteDoc)\s*\(\s*(?:collection|doc)\s*\(\s*[\w$.]{1,80}\s*,\s*(['"`])([\w-]+)\2/g)) addOps(m[3].toLowerCase(), FIRE[m[1]], 'data');
  return out;
}

// Group by resource (posts and post are one resource) and report every resource that the claimed files both create
// and read but never update or delete: the half CRUD this check exists for. Create-only resources (an event or log
// endpoint, or a claim that lists only the create route), read-only lists and update-only singletons say nothing.
function crudFindings(entries) {
  const groups = new Map();
  for (const e of entries || []) {
    const key = String(e.resource).split('/').map(singular).join('/');
    if (!groups.has(key)) groups.set(key, { resource: e.resource, ops: new Set() });
    groups.get(key).ops.add(e.op);
  }
  const resources = [...groups.values()].map(g => ({ resource: g.resource, ops: ['C', 'R', 'U', 'D'].filter(o => g.ops.has(o)) }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
  const findings = resources.filter(r => r.ops.includes('C') && r.ops.includes('R') && r.ops.length < 4)
    .map(r => ({ resource: r.resource, present: r.ops, missing: ['U', 'D'].filter(o => !r.ops.includes(o)) }));
  return { resources, findings };
}

const OP_WORDS = { ko: { C: '생성', R: '조회', U: '수정', D: '삭제' }, en: { C: 'create', R: 'read', U: 'update', D: 'delete' } };
const words = (ops, lang) => ops.map(o => OP_WORDS[lang][o]);
const andList = w => (w.length < 2 ? w.join('') : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1]);
const orList = w => (w.length < 2 ? w.join('') : w.slice(0, -1).join(', ') + ' or ' + w[w.length - 1]);
// One line per finding, for verify-claim's lens block.
function findingLine(fd, lang) {
  if (lang === 'en') return `crud: ${fd.resource} — the claimed files only ${andList(words(fd.present, 'en'))} it (no ${orList(words(fd.missing, 'en'))}). Elsewhere, or not needed? If left out, say why in the evidence`;
  return `crud: ${fd.resource} — 주장 파일에 ${words(fd.present, 'ko').join('·')}만 있음(${words(fd.missing, 'ko').join('·')} 없음). 다른 곳에 있나, 필요 없나? 빼면 이유를 evidence 에`;
}

module.exports = { requestSignal, crudOpsFromSource, crudFindings, findingLine, routeOp, resourceFromFile };
