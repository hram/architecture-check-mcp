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
  'the same stdio process checks multiple projects and filters only the report',
  { timeout: 15000 },
  async (t) => {
    const root = projectFixture(t);
    const second = projectFixture(t);
    const client = new Client({ name: 'protocol-test', version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entrypoint],
        cwd: os.tmpdir(),
      }),
    );

    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['architecture_check'],
    );
    assert.deepEqual(tools[0].inputSchema.required, ['project_path']);
    const call = (args) =>
      client.callTool({ name: 'architecture_check', arguments: args });

    const passing = await call({ project_path: root });
    assert.equal(passing.structuredContent.status, 'pass');
    assert.deepEqual(
      JSON.parse(passing.content[0].text),
      passing.structuredContent,
    );

    addForbiddenDependency(second);
    const failing = await call({ project_path: second });
    assert.equal(failing.structuredContent.status, 'fail');
    assert.equal(failing.structuredContent.findings.length, 1);
    assert.notEqual(failing.isError, true);

    const filtered = await call({
      project_path: second,
      report_filter: [{ path: manifestPath, lines: [[1, 2]] }],
    });
    assert.equal(filtered.structuredContent.status, 'fail');
    assert.equal(filtered.structuredContent.checks[0].status, 'fail');
    assert.deepEqual(filtered.structuredContent.findings, []);
    assert.equal(filtered.structuredContent.report_summary.hidden_findings, 1);

    assert.equal(
      (
        await call({
          project_path: root,
          report_filter: [{ path: '../other' }],
        })
      ).isError,
      true,
    );
    assert.equal((await call({ root: example })).isError, true);
    assert.equal((await call({})).isError, true);
    assert.equal((await call({ project_path: '.' })).isError, true);
    assert.equal(
      (await call({ project_path: path.join(root, manifestPath) })).isError,
      true,
    );

    fs.unlinkSync(path.join(root, '.architecture/cli.cjs'));
    const incomplete = await call({ project_path: root });
    assert.equal(incomplete.structuredContent.status, 'incomplete');
    assert.notEqual(incomplete.isError, true);
  },
);

test(
  'stdio scope honors the project manifest and the project session binding',
  { timeout: 15000 },
  async (t) => {
    const root = projectFixture(t);
    const second = projectFixture(t);
    const manifest = path.join(root, 'projects.json');
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        projects: [
          { path: root },
          { path: second },
          { path: path.join(root, 'missing') },
        ],
      }),
    );

    for (const projectPath of [undefined, root]) {
      const client = new Client({ name: 'scope-test', version: '1' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [
            entrypoint,
            '--project-manifest',
            manifest,
            '--project-path-env',
            'ARCHITECTURE_TEST_PROJECT',
          ],
          env:
            projectPath === undefined
              ? {}
              : { ARCHITECTURE_TEST_PROJECT: projectPath },
        }),
      );
      try {
        const call = (project_path) =>
          client.callTool({
            name: 'architecture_check',
            arguments: { project_path },
          });
        assert.equal((await call(root)).structuredContent.status, 'pass');
        assert.equal(
          (await call(second)).isError === true,
          projectPath !== undefined,
        );
        assert.equal((await call(example)).isError, true);
        assert.equal((await call(path.join(root, 'packages'))).isError, true);
      } finally {
        await client.close();
      }
    }
  },
);

test(
  'allowed roots reject project symlinks that leave the root',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = projectFixture(t);
    const link = path.join(root, 'outside');
    fs.symlinkSync(example, link, 'dir');
    const client = new Client({ name: 'root-test', version: '1' });
    t.after(() => client.close());
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entrypoint, '--allow-root', root],
      }),
    );
    const call = (project_path) =>
      client.callTool({
        name: 'architecture_check',
        arguments: { project_path },
      });
    assert.equal((await call(root)).structuredContent.status, 'pass');
    assert.equal((await call(link)).isError, true);
  },
);
