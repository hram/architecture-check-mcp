const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StdioClientTransport,
} = require('@modelcontextprotocol/sdk/client/stdio.js');
const { runArchitectureCheck } = require('../src/runner');

const example = path.resolve(__dirname, '../examples/layered-project');
const entrypoint = path.resolve(__dirname, '../src/mcp-server.js');
const manifestPath = 'packages/domain/package.json';
const request = {
  protocol_version: 1,
  request_id: 'manual-fixture',
  scope: 'project',
};

function projectFixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'architecture-check-fixture-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(example, root, { recursive: true });
  return root;
}

function addForbiddenDependency(root) {
  fs.writeFileSync(
    path.join(root, manifestPath),
    JSON.stringify(
      {
        name: '@example/domain',
        dependencies: { '@example/infrastructure': '*' },
      },
      null,
      2,
    ),
  );
}

function directCheck(root, input = request) {
  const { error, status, stdout, stderr } = spawnSync(
    process.execPath,
    ['.architecture/cli.cjs'],
    {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify(input),
      timeout: 5000,
    },
  );
  assert.ifError(error);
  assert.equal(stderr, '');
  const report = JSON.parse(stdout);
  assert.equal(report.request_id, input.request_id);
  return { status, report };
}

test('the example CLI runs directly and reports pass, fail, and incomplete', (t) => {
  const root = projectFixture(t);
  const passing = directCheck(root);
  assert.equal(passing.status, 0);
  assert.equal(passing.report.status, 'pass');
  assert.deepEqual(passing.report.checks[0].coverage.files, [manifestPath]);
  assert.match(passing.report.snapshot_sha256, /^[a-f\d]{64}$/);

  addForbiddenDependency(root);
  const failing = directCheck(root);
  assert.equal(failing.status, 1);
  assert.equal(failing.report.status, 'fail');
  assert.equal(failing.report.findings[0].line, 4);
  assert.equal(
    failing.report.findings[0].rule_id,
    'layers/domain-independence',
  );
  assert.notEqual(
    failing.report.snapshot_sha256,
    passing.report.snapshot_sha256,
  );

  const incompatible = directCheck(root, { ...request, protocol_version: 2 });
  assert.equal(incompatible.status, 2);
  assert.equal(incompatible.report.status, 'incomplete');
  assert.match(incompatible.report.diagnostics[0], /protocol_version/);

  fs.unlinkSync(path.join(root, manifestPath));
  const incomplete = directCheck(root);
  assert.equal(incomplete.status, 2);
  assert.equal(incomplete.report.status, 'incomplete');
  assert.equal(incomplete.report.checks[0].status, 'incomplete');
});

test(
  'the runner refuses a checker symlink outside the project',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = projectFixture(t);
    const checker = path.join(root, '.architecture/cli.cjs');
    fs.unlinkSync(checker);
    fs.symlinkSync(path.join(example, '.architecture/cli.cjs'), checker);
    const result = await runArchitectureCheck(root);
    assert.equal(result.status, 'incomplete');
    assert.match(result.diagnostics[0], /inside the project/);
  },
);

test(
  'the stdio MCP exposes the tool, uses its configured root, and filters only the report',
  { timeout: 15000 },
  async (t) => {
    const root = projectFixture(t);
    const client = new Client({ name: 'protocol-test', version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entrypoint, '--root', root],
        cwd: os.tmpdir(),
      }),
    );

    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['architecture_check'],
    );
    const call = (args) =>
      client.callTool({ name: 'architecture_check', arguments: args });

    const passing = await call({});
    assert.equal(passing.structuredContent.status, 'pass');
    assert.deepEqual(
      JSON.parse(passing.content[0].text),
      passing.structuredContent,
    );

    addForbiddenDependency(root);
    const failing = await call({});
    assert.equal(failing.structuredContent.status, 'fail');
    assert.equal(failing.structuredContent.findings.length, 1);
    assert.notEqual(failing.isError, true);

    const filtered = await call({
      report_filter: [{ path: manifestPath, lines: [[1, 2]] }],
    });
    assert.equal(filtered.structuredContent.status, 'fail');
    assert.equal(filtered.structuredContent.checks[0].status, 'fail');
    assert.deepEqual(filtered.structuredContent.findings, []);
    assert.equal(filtered.structuredContent.report_summary.hidden_findings, 1);

    assert.equal(
      (await call({ report_filter: [{ path: '../other' }] })).isError,
      true,
    );
    assert.equal((await call({ root: example })).isError, true);

    fs.unlinkSync(path.join(root, '.architecture/cli.cjs'));
    const incomplete = await call({});
    assert.equal(incomplete.structuredContent.status, 'incomplete');
    assert.notEqual(incomplete.isError, true);
  },
);
