'use strict';

const { createHash } = require('node:crypto');
const { POLICY_VERSION, TAXONOMY } = require('./ui-boundary');
const { REVIEW_SCHEMA, MAX_FINDINGS, validateUiBoundaryReview } = require('./ui-boundary-contracts');
const { SECRET_PATTERNS } = require('./catalogs');
const { _isPlaceholderSecret, _looksSecretLike } = require('./pure-utils');

const INPUT_SCHEMA = 'leerness.ui-boundary-scan-input/v1';
const OUTPUT_SCHEMA = 'leerness.ui-boundary-scan/v1';
const SCANNER_VERSION = 'leerness.ui-boundary-scanner/v2';
const MAX_INPUT_BYTES = 128 * 1024;
const MAX_SURFACES = MAX_FINDINGS;
const MAX_TEXT_BYTES = 4096;

// Signals are evidence of syntax, not of author intent or actual visibility.
// Deliberately omit general model/provider/status labels and bare Error/DEBUG/TODO words.
// v2 keeps the same two syntax classes (developer notes, debug metadata). Requirement,
// criterion and implementation wording needs product context and stays with review: phrase
// rules for them reached 15-25% recall on an independent corpus, against 100% on the corpus
// they were written from.
// A line may start with a list bullet; the bullet itself is never a signal.
const LINE = String.raw`(?:^|\n)[ \t]*(?:[-*•·▪◦‣●○■□►▶][ \t]+)?`;
// A finite suffix list, not a domain/file oracle: other domains and files can still be candidates.
const DOMAIN_OR_FILE = /\.(?:com|net|org|info|biz|edu|gov|int|mil|io|dev|app|co|kr|jp|cn|uk|us|de|fr|eu|ai|me|tv|xyz|html?|js|mjs|cjs|ts|tsx|jsx|json|md|css|scss|png|jpe?g|svg|gif|webp|ico|bmp|pdf|txt|csv|log|xml|ya?ml|toml|ini|lock|map|zip|gz|tgz|tar|7z|rar|exe|dmg|msi|sh|py|rb|go|rs|java|docx?|xlsx?|pptx?|hwp|mp3|mp4|mov|wav|woff2?|ttf)[ \t]*$/i;
// Only explicit talk about templating excuses a placeholder: a bare "variable" or "template" elsewhere
// in the text ("variable interest rate", "choose a template") does not.
const TEMPLATE_TALK = /\b(?:template|merge)[ -]?(?:variables?|tags?|fields?|placeholders?|syntax)\b|\b(?:variables?|placeholders?)\s+(?:like|such as)\b|(?:템플릿|치환)\s?(?:변수|태그|필드|문법)|변수\s?(?:예시|목록|이름)/i;
// `[object Object]` is excused only when it opens the text as the thing being explained: an English
// explanation verb right after it, a Korean definition (`…란`), or a Korean subject whose own sentence
// ends in an explanation predicate. A connective alone (`is`, `는`) starts an ordinary sentence
// ("[object Object]는 품절입니다" is a broken product name, not an explanation).
const EXPLAINED_OBJECT = /^[\s"'“‘`(]*\[object [A-Z][A-Za-z]*\][\s"'”’`)]*(?:means\b|indicates\b|(?:appears|shows up|happens|occurs)\s+when\b|(?:이란|란)(?:\s|$)|(?:는|은|이|가)\s[^\n.!?]*?(?:뜻(?:합니다|한다|해요|이에요|입니다|이다)|의미(?:합니다|한다|해요|하나요|하며)|(?:표시|출력)(?:됩니다|된다|돼요|되며|되면)|나타(?:납니다|난다|나요|나며|나면)|보이(?:면|며|나요)))/;
// A whole JSON document, or one that fills the rest of the text after a label (`state: {...}`).
// Parsed from the supplied text: the matching view would turn full-width characters inside strings into JSON syntax.
function jsonDocument(view, text) {
  const match = /(?:^|[:=\uFF1A])\s*([[{][\s\S]*[\]}])\s*$/.exec(text);
  if (!match) return false;
  try {
    const value = JSON.parse(match[1]);
    return !!value && typeof value === 'object'
      && (Array.isArray(value) ? value.some(item => item && typeof item === 'object') : Object.keys(value).length > 0);
  } catch { return false; }
}
// [code, sourceKind, pattern, optional acceptance check (matching view, supplied text)]
const RULES = [
  ['developer-marker', 'developer_note', new RegExp(LINE + String.raw`(?:(?:TODO|FIXME|XXX|HACK)[ \t]*:|\[(?:TODO|FIXME|XXX|HACK)\])`, 'i')],
  ['developer-note-label', 'developer_note', new RegExp(LINE + String.raw`(?:\[[ \t]*)?(?:(?:developer|dev|internal|designer|engineering|implementation)[ \t]+notes?|notes?[ \t]+(?:to|for)[ \t]+(?:self|devs?|developers?|designers?)|개발자?[ \t]?(?:메모|노트|참고|코멘트)|내부[ \t]?(?:메모|참고|노트)|디자이너[ \t]?(?:메모|코멘트|참고)|기획[ \t]?메모|작업[ \t]?필요|수정[ \t]?필요)[ \t]*[\]:]`, 'i')],
  ['placeholder-copy', 'developer_note', /\blorem[ \t\r\n]+ipsum\b|\b(?:placeholder|dummy|filler)[ \t]+(?:text|copy)\b|(?:임시|더미)[ \t]?(?:문구|텍스트|카피|버튼명|제목|타이틀|라벨|레이블)/i],
  ['maintenance-note', 'developer_note', /\breplace[ \t]+with[ \t]+(?:real|actual|final)\b|\b(?:replace|remove|change|fix)(?:[ \t]+(?:this|me|it))?[ \t]+before[ \t]+(?:launch|release|shipping|prod(?:uction)?|go-?live)\b|\bhard-?coded[ \t]+(?:for|until)\b|\btemporary[ \t]+hack\b|\bwaiting[ \t]+for[ \t]+(?:marketing|design|copy|backend|api|legal)\b|추후[ \t]?교체|교체[ \t]?예정[ \t]*$|(?:나중에|추후)[ \t]?(?:수정|교체)[ \t]*\.?[ \t]*$|(?:확정|결정|준비|완성|완료)되면[ \t]?(?:교체|수정|반영|변경)|(?:교체|삭제|반영)할[ \t]?것[ \t]*\.?[ \t]*$/im],
  ['rendered-comment', 'developer_note', /<!--|(?:^|\n)[ \t]*(?:\/\/|\/\*)[ \t]+\S/],
  ['debug-prefix', 'debug_metadata', new RegExp(LINE + String.raw`(?:(?:DEBUG|디버그|디버깅)[ \t]*:|\[(?:DEBUG|디버그)\])`, 'i')],
  ['exception-detail', 'debug_metadata', /(?:(?:^|\n)[ \t]*|:[ \t]*)(?:Uncaught[ \t]+)?(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError)[ \t]*:[ \t]*\S/],
  ['stack-frame', 'debug_metadata', /(?:^|\n)[ \t]+at[ \t]+[^\r\n]*[/:\\][^\r\n]*:\d+:\d+\)?[ \t]*(?:\r?\n|$)/],
  ['python-traceback', 'debug_metadata', /(?:^|\n)Traceback \(most recent call last\):[\s\S]*?\n[ \t]+File "[^"\r\n]+", line \d+/],
  ['loopback-url', 'debug_metadata', /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/?#\s]|$)/i],
  ['internal-metadata', 'debug_metadata', /(?:^|[\n{,])[ \t]*["']?(?:debug[ _-]?payload|raw[ _-]?(?:response|status)|system_?prompt|chain_?of_?thought|internal_?trace|stack_?trace)["']?[ \t]*[:=]/i],
  // Render artifacts: a value or template that never resolved. An explanation of the artifact
  // (it is the sentence's topic) or of templating is not flagged.
  ['object-coercion', 'debug_metadata', /\[object [A-Z][A-Za-z]*\]/, text => !EXPLAINED_OBJECT.test(text)],
  ['unresolved-template', 'debug_metadata', /\{\{[ \t]*[\p{L}_$][\p{L}\p{N}_$.\[\]-]*[ \t]*\}\}|\$\{[ \t]*[\p{L}_$][\p{L}\p{N}_$.]*[ \t]*\}|(?<![\w%])%[sd@](?![A-Za-z0-9_])/u, text => !TEMPLATE_TALK.test(text)],
  ['missing-value', 'debug_metadata', /^[ \t]*(?:undefined|null|NaN|Invalid Date)[ \t]*$|[:=][ \t]*(?:undefined|null|NaN|Invalid Date)[ \t]*$|(?<![A-Za-z0-9_])(?:undefined|null|NaN)(?=[님원개명건일시분초점%])|[$₩€£¥][ \t]?(?:undefined|null|NaN)(?![A-Za-z0-9_])/m],
  ['raw-i18n-key', 'debug_metadata', /^[ \t]*[a-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_-]*){1,5}[ \t]*$/, text => !DOMAIN_OR_FILE.test(text)],
  ['json-dump', 'debug_metadata', /[\]}]\s*$/, jsonDocument],
];

// Matching view only: full-width ASCII, wide or non-breaking spaces and zero-width characters
// must not hide a marker. Findings, digests and outputs keep the supplied bytes; copy is never rewritten.
function matchingView(text) {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}
const DEBUG_ATTRIBUTES = new Set(['data-debug', 'data-debug-only', 'data-internal-debug', 'data-source-prompt']);

class UiBoundaryScanError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'UiBoundaryScanError'; this.code = code; this.field = field;
  }
}
function fail(code, field) { throw new UiBoundaryScanError(`ui_boundary_scan_${code}`, field); }
function object(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object_required', field);
  if (Object.keys(value).some(key => !keys.includes(key))) fail('unknown_field', field);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail('field_required', `${field}.${key}`);
}
function choice(value, values, field) { if (!values.includes(value)) fail('enum_invalid', field); }
function validUnicode(value) {
  // Reject unpaired surrogates before UTF-8 hashing (Node 18 compatible).
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
    } else if (c >= 0xDC00 && c <= 0xDFFF) return false;
  }
  return true;
}
function parseInput(inputJson) {
  if (typeof inputJson !== 'string') fail('serialized_json_required', '$');
  if (inputJson.length > MAX_INPUT_BYTES || Buffer.byteLength(inputJson, 'utf8') > MAX_INPUT_BYTES) fail('input_too_large', '$');
  let input;
  try { input = JSON.parse(inputJson); } catch { fail('json_invalid', '$'); }
  object(input, ['schema', 'policyVersion', 'taskKind', 'surfaces'], '$');
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  if (input.policyVersion !== POLICY_VERSION) fail('policy_unsupported', '$.policyVersion');
  choice(input.taskKind, ['ui', 'non-ui', 'unknown'], '$.taskKind');
  if (!Array.isArray(input.surfaces) || input.surfaces.length > MAX_SURFACES) fail('surfaces_limit', '$.surfaces');
  if (input.taskKind === 'non-ui' && input.surfaces.length) fail('non_ui_surfaces', '$.surfaces');
  for (const surface of input.surfaces) {
    const field = '$.surfaces[]';
    object(surface, ['kind', 'exposure', 'text', 'attribute'], field);
    choice(surface.kind, ['text', 'attribute'], `${field}.kind`);
    choice(surface.exposure, ['proposed', 'rendered'], `${field}.exposure`);
    if (typeof surface.text !== 'string') fail('text_required', `${field}.text`);
    if (!validUnicode(surface.text)) fail('unicode_invalid', `${field}.text`);
    if (Buffer.byteLength(surface.text, 'utf8') > MAX_TEXT_BYTES) fail('text_too_large', `${field}.text`);
    if (surface.kind === 'text') {
      if (surface.attribute !== null) fail('attribute_must_be_null', `${field}.attribute`);
    } else if (typeof surface.attribute !== 'string' || !/^[a-z][a-z0-9:-]{0,63}$/.test(surface.attribute)) {
      fail('attribute_invalid', `${field}.attribute`);
    }
  }
  return input;
}
function digest(value) { return 'sha256:' + createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }

function secretSignals(text) {
  const names = [];
  for (const pattern of SECRET_PATTERNS) {
    // Share the repository scan's catalog and guards, never its mutable cursor,
    // filesystem ignores, acknowledgements, or raw snippets. One pass per rule.
    const re = new RegExp(pattern.re.source, pattern.re.flags);
    let match;
    while ((match = re.exec(text))) {
      const value = pattern.valueGroup != null ? match[pattern.valueGroup] : match[0];
      if (!_isPlaceholderSecret(value)
        && !(pattern.valueGroup != null && pattern.requireSecretLike && !_looksSecretLike(value))) {
        names.push(pattern.name); break;
      }
      if (re.lastIndex === match.index) re.lastIndex++;
    }
  }
  return names;
}

function scanUiBoundary(inputJson) {
  const input = parseInput(inputJson);
  const findings = [];
  input.surfaces.forEach((surface, surfaceIndex) => {
    // Scan the supplied decoded surface only. No HTML parsing, file discovery or provenance
    // claims happen here; the matching view normalizes characters for comparison only.
    const view = matchingView(surface.text);
    const signals = RULES.filter(([, , re, accept]) => re.test(view) && (!accept || accept(view, surface.text)))
      .map(([code, sourceKind]) => ({ code, subtype: TAXONOMY[sourceKind] }));
    if (surface.kind === 'attribute' && DEBUG_ATTRIBUTES.has(surface.attribute)) {
      signals.push({ code: 'debug-attribute', subtype: TAXONOMY.debug_metadata });
    }
    const securityPatterns = secretSignals(surface.text);
    if (!signals.length && !securityPatterns.length) return;
    const security = securityPatterns.length > 0;
    // One finding per supplied surface; retain all signal kinds under it.
    // Security owns the severity when UI and security patterns overlap.
    const sourceKind = security || signals.some(s => s.subtype === TAXONOMY.debug_metadata)
      ? 'debug_metadata' : 'developer_note';
    findings.push({ surfaceIndex, category: security ? 'security' : 'instruction_to_ui_leakage',
      subtype: TAXONOMY[sourceKind], sourceKind, sourceBasis: 'pattern-inferred-candidate',
      severity: security ? 'delegated' : 'advisory', certainty: 'candidate',
      disposition: security && surface.exposure === 'proposed' ? 'withhold-pending-review' : 'review-remediation',
      signals, securityPatterns,
      evidenceDigest: digest([SCANNER_VERSION, POLICY_VERSION, input.taskKind, surfaceIndex,
        surface.kind, surface.exposure, surface.attribute, surface.text]) });
  });
  const review = validateUiBoundaryReview({ schema: REVIEW_SCHEMA, policyVersion: POLICY_VERSION,
    taskKind: input.taskKind, evidenceVerified: false, findings: findings.map(f => ({
      category: f.category, subtype: f.subtype, sourceKind: f.sourceKind, severity: f.severity,
      disposition: f.disposition, evidenceDigest: f.evidenceDigest,
    })) });
  return {
    schema: OUTPUT_SCHEMA, policyVersion: POLICY_VERSION, scannerVersion: SCANNER_VERSION,
    assessmentBasis: 'patterns-in-caller-supplied-surfaces',
    applicability: input.taskKind === 'ui' ? 'applicable' : input.taskKind === 'non-ui' ? 'not-applicable' : 'unknown',
    status: input.taskKind === 'non-ui' ? 'not-applicable' : !input.surfaces.length ? 'no-surfaces'
      : findings.length ? 'findings' : 'no-pattern-match',
    scannedSurfaces: input.surfaces.length, findings, review,
    verification: { sourceVerified: false, renderVerified: false, semanticVerified: false, independentReview: 'not-run' },
    effects: { filesRead: false, filesWritten: false, modelInvoked: false, approvalGranted: false,
      enforcementChanged: false, autoRemove: false },
  };
}

module.exports = { scanUiBoundary, UiBoundaryScanError, INPUT_SCHEMA, OUTPUT_SCHEMA, SCANNER_VERSION,
  POLICY_VERSION, MAX_INPUT_BYTES, MAX_SURFACES, MAX_TEXT_BYTES };
