const fs = require('node:fs');
const path = require('node:path');

const file = 'packages/domain/package.json';
const forbidden = '@example/infrastructure';
const sections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

function check(root) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const manifest = JSON.parse(source);
  if (!manifest || typeof manifest.name !== 'string')
    throw new Error(file + ' is missing a package name');

  const violations = [];
  for (const section of sections) {
    const dependencies = manifest[section];
    if (dependencies === undefined) continue;
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies)
    ) {
      throw new Error(file + ': ' + section + ' must be an object');
    }
    if (Object.hasOwn(dependencies, forbidden)) {
      violations.push(section + '.' + forbidden);
    }
  }
  const lineOffset = source.search(/"@example\/infrastructure"\s*:/);
  const line =
    lineOffset < 0 ? 1 : source.slice(0, lineOffset).split('\n').length;

  return {
    inputs: [{ file, source }],
    coverage: {
      files: [file],
      limitation: 'Checks declared package dependencies only',
    },
    findings:
      violations.length === 0
        ? []
        : [
            {
              file,
              line,
              severity: 'error',
              message: 'The domain package must not depend on infrastructure',
              evidence: violations.join(', '),
            },
          ],
  };
}

module.exports = { check };
