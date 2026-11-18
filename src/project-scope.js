const fs = require('node:fs');
const path = require('node:path');

function directory(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) {
    throw new Error('Expected an absolute directory path');
  }
  const resolved = fs.realpathSync(input);
  if (!fs.statSync(resolved).isDirectory())
    throw new Error('Expected a directory');
  return resolved;
}

function isWithin(root, project) {
  const relative = path.relative(root, project);
  return (
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function readProjectPaths(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !Array.isArray(manifest?.projects) ||
    !manifest.projects.every(
      (project) =>
        typeof project?.path === 'string' && path.isAbsolute(project.path),
    )
  ) {
    throw new Error(
      'Project manifest must contain projects with absolute path values',
    );
  }
  return new Set(
    manifest.projects.flatMap(({ path: projectPath }) => {
      try {
        return [directory(projectPath)];
      } catch {
        return [];
      }
    }),
  );
}

function createProjectResolver({ roots, manifest, boundProject }) {
  const allowedRoots = roots.map(directory);
  const allowedProjects =
    manifest === undefined ? undefined : readProjectPaths(manifest);
  const boundRoot =
    boundProject === undefined ? undefined : directory(boundProject);

  return (projectPath) => {
    let project;
    try {
      project = directory(projectPath);
    } catch {
      throw new Error(
        'project_path must be an existing absolute directory path',
      );
    }
    const withinRoots =
      allowedRoots.length === 0 ||
      allowedRoots.some((root) => isWithin(root, project));
    const registered =
      allowedProjects === undefined || allowedProjects.has(project);
    const withinSession = boundRoot === undefined || boundRoot === project;
    if (!withinRoots || !registered || !withinSession) {
      throw new Error('project_path is outside the allowed project scope');
    }
    return project;
  };
}

module.exports = { createProjectResolver };
