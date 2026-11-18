const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runArchitectureCheck } = require('../src/runner');

function fixture(t, script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.architecture'));
  if (script)
    fs.writeFileSync(path.join(root, '.architecture/cli.cjs'), script);
  return root;
}
const reply = `let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{
const r=JSON.parse(s); const status=process.env.UNUSED || 'pass';
console.log(JSON.stringify({...r,status,checks:[{id:'fixture/rule',version:'1',implementation_sha256:'a'.repeat(64),status,coverage:{files:['src/Example.kt']}}],findings:[],diagnostics:[]}));
});`;

test('architecture runner works without Git and sends only the whole-project request', async (t) => {
  const root = fixture(
    t,
    reply.replace(
      "const status=process.env.UNUSED || 'pass';",
      "if (JSON.stringify(Object.keys(r).sort()) !== JSON.stringify(['protocol_version','request_id','scope'])) throw Error('bad request'); const status='pass';",
    ),
  );
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  const result = await runArchitectureCheck(root);
  assert.equal(result.status, 'pass');
  assert.equal(result.scope, 'project');
  assert.equal(result.checks[0].id, 'fixture/rule');
  // The filter is applied after execution; the same strict CLI protocol applies.
  const filtered = await runArchitectureCheck(root, {
    reportFilter: [{ path: 'src/Example.kt', lines: [[1, 5]] }],
  });
  assert.equal(filtered.status, 'pass');
  assert.equal(filtered.report_summary.total_findings, 0);
});

test('architecture runner preserves red results as data and rejects contradictory green results', async (t) => {
  const root = fixture(
    t,
    reply
      .replace(
        "const status=process.env.UNUSED || 'pass';",
        "const status='fail'; process.exitCode=1;",
      )
      .replace(
        'findings:[]',
        "findings:[{rule_id:'fixture/rule',severity:'error',file:'src/Example.kt',line:3,message:'bad dependency',evidence:'import bad.Layer'}]",
      ),
  );
  const result = await runArchitectureCheck(root);
  assert.equal(result.status, 'fail');
  assert.equal(result.findings.length, 1);
  fs.writeFileSync(
    path.join(root, '.architecture/cli.cjs'),
    reply.replace(
      'findings:[]',
      "findings:[{rule_id:'fixture/rule',severity:'error',file:'src/Example.kt',line:3,message:'bad',evidence:'bad'}]",
    ),
  );
  assert.equal((await runArchitectureCheck(root)).status, 'incomplete');
  assert.equal(
    (
      await runArchitectureCheck(root, {
        reportFilter: [{ path: 'unrelated.kt' }],
      })
    ).status,
    'incomplete',
  );
});

test('architecture runner never treats missing, malformed, empty, timeout or excessive output as pass', async (t) => {
  const root = fixture(t);
  assert.equal((await runArchitectureCheck(root)).status, 'incomplete');
  for (const script of [
    "console.log('not json')",
    'process.exit(0)',
    reply.replace(
      "implementation_sha256:'a'.repeat(64)",
      "implementation_sha256:'invalid'",
    ),
  ]) {
    fs.writeFileSync(path.join(root, '.architecture/cli.cjs'), script);
    assert.equal((await runArchitectureCheck(root)).status, 'incomplete');
  }
  fs.writeFileSync(
    path.join(root, '.architecture/cli.cjs'),
    'setInterval(()=>{},1000)',
  );
  assert.match(
    (await runArchitectureCheck(root, { timeoutMs: 100 })).diagnostics[0],
    /timed out/,
  );
  fs.writeFileSync(
    path.join(root, '.architecture/cli.cjs'),
    "process.stdout.write('x'.repeat(10000))",
  );
  assert.match(
    (await runArchitectureCheck(root, { maxBytes: 100 })).diagnostics[0],
    /limit/,
  );
});
