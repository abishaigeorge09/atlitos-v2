// Metro config for a pnpm workspace. Expo's default Metro config only
// watches the app directory and resolves node_modules by walking up from
// the app, which does not work with pnpm's symlinked, content addressed
// store. This adds the monorepo root to `watchFolders` and points
// `nodeModulesPaths` at both the app's and the workspace root's
// node_modules, per Expo's monorepo guide.
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// pnpm hoists less than npm/yarn, so keep hierarchical lookup enabled and
// disable the strict single node_modules assumption some Metro presets use.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
