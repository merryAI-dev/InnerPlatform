#!/usr/bin/env node
/**
 * JVM 권한맵을 역할의 단일 원본으로 삼아 JSON으로 추출한다.
 *
 * 이 저장소에서는 같은 질문("이 역할이 이 명령을 실행할 수 있나")에 네 곳이 답해 왔고
 * 서로 어긋나 있었다. 실제로 강제되는 곳은 JVM 하나뿐이므로 그곳을 원본으로 두고,
 * 나머지는 이 산출물을 참조하거나 이 산출물과 대조한다.
 *
 *   node scripts/extract_jvm_command_roles.mjs           # 대조만 한다. 어긋나면 실패
 *   node scripts/extract_jvm_command_roles.mjs --write   # 산출물을 다시 만든다
 *
 * Java 를 정규식으로 읽으므로 형식이 바뀌면 깨진다. 그때는 조용히 빈 값을 내는 대신
 * 크게 실패해야 하므로, 항목 수가 기대보다 적으면 그 자체를 오류로 본다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const JAVA_ROOT = 'server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/service';
const COMMAND_SERVICE = path.join(ROOT, JAVA_ROOT, 'WeeklyExpenseCommandService.java');
const AUTH_SERVICE = path.join(ROOT, JAVA_ROOT, 'WeeklyExpenseAuthorizationService.java');
const OUTPUT = path.join(ROOT, 'policies/jvm-command-roles.json');

// 추출이 조용히 망가지는 것을 막는 하한선. 명령을 지울 일이 생기면 이 값도 함께 낮춘다.
const MIN_COMMANDS = 20;

function fail(message) {
  console.error(`[jvm-command-roles] ${message}`);
  process.exit(1);
}

function readCommandValues() {
  const source = readFileSync(COMMAND_SERVICE, 'utf8');
  const values = new Map();
  for (const match of source.matchAll(/static final String ([A-Z_]+_COMMAND)\s*=\s*"([^"]+)"/g)) {
    values.set(match[1], match[2]);
  }
  if (values.size < MIN_COMMANDS) {
    fail(`WeeklyExpenseCommandService 에서 상수를 ${values.size}개만 찾았다. 형식이 바뀌었는지 확인이 필요하다.`);
  }
  return values;
}

function readCommandRoles(commandValues) {
  const source = readFileSync(AUTH_SERVICE, 'utf8');
  const commands = {};
  for (const match of source.matchAll(
    /Map\.entry\(\s*WeeklyExpenseCommandService\.([A-Z_]+_COMMAND)\s*,\s*Set\.of\(([^)]*)\)/g,
  )) {
    const [, constant, rawRoles] = match;
    const value = commandValues.get(constant);
    if (!value) fail(`${constant} 의 문자열 값을 찾지 못했다.`);
    const roles = [...rawRoles.matchAll(/"([a-z_]+)"/g)].map((role) => role[1]).sort();
    if (roles.length === 0) fail(`${constant} 에 허용 역할이 없다. 파싱이 깨졌을 가능성이 높다.`);
    commands[constant] = { command: value, roles };
  }
  if (Object.keys(commands).length < MIN_COMMANDS) {
    fail(`권한맵에서 ${Object.keys(commands).length}개만 읽었다. 형식이 바뀌었는지 확인이 필요하다.`);
  }
  return commands;
}

function build() {
  const commands = readCommandRoles(readCommandValues());
  const roles = [...new Set(Object.values(commands).flatMap((entry) => entry.roles))].sort();
  return {
    $comment: '생성물이다. 직접 고치지 말고 JVM 권한맵을 고친 뒤 npm run policy:jvm-roles:write 를 실행한다.',
    source: `${JAVA_ROOT}/WeeklyExpenseAuthorizationService.java`,
    roles,
    commands: Object.fromEntries(Object.keys(commands).sort().map((key) => [key, commands[key]])),
  };
}

const generated = `${JSON.stringify(build(), null, 2)}\n`;

if (process.argv.includes('--write')) {
  writeFileSync(OUTPUT, generated, 'utf8');
  console.log(`[jvm-command-roles] wrote ${path.relative(ROOT, OUTPUT)}`);
  process.exit(0);
}

let committed;
try {
  committed = readFileSync(OUTPUT, 'utf8');
} catch {
  fail(`${path.relative(ROOT, OUTPUT)} 가 없다. npm run policy:jvm-roles:write 를 실행한다.`);
}

if (committed !== generated) {
  fail(
    'JVM 권한맵과 생성물이 다르다. 권한을 바꿨다면 npm run policy:jvm-roles:write 를 실행해 함께 커밋한다.\n'
    + '이 검사가 있어야 권한이 조용히 넓어지는 일을 막을 수 있다.',
  );
}

console.log('[jvm-command-roles] ok: 권한맵과 생성물이 일치한다');
