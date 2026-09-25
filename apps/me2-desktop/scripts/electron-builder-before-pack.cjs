#!/usr/bin/env node
/**
 * electron-builder-before-pack — fail-loud contract gate (R77 lesson: a config
 * entry without the physical artifact is a dead letter; electron-builder would
 * silently skip it). Aborts packaging unless me2-ui-dist is complete AND the
 * manifest pins THIS exact source SHA when ME2_BUILD_SHA is set.
 */
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async function beforePack(context) {
  const projectDir = context.packager.projectDir || context.packager.appInfo.projectDir || process.cwd();
  const dist = join(projectDir, 'me2-ui-dist');
  const required = ['server.js', 'package.json', join('.next', 'BUILD_ID'), 'me2-ui-manifest.json', 'node_modules'];
  for (const rel of required) {
    if (!existsSync(join(dist, rel))) {
      throw new Error(`me2_ui_dist_missing:${rel} — запустите \`npm run pack:ui\` до упаковки (R77-урок)`);
    }
  }
  const manifest = JSON.parse(readFileSync(join(dist, 'me2-ui-manifest.json'), 'utf8'));
  if (manifest.schema !== 'me2.ui-bundle-manifest.v1') throw new Error('me2_ui_manifest_schema_invalid');
  if (manifest.node_modules_included !== true) throw new Error('me2_ui_node_modules_absent — R77-дефект недопустим');
  const expectedSha = process.env.ME2_BUILD_SHA;
  if (expectedSha && manifest.git_sha !== expectedSha) {
    throw new Error(`me2_ui_sha_mismatch: manifest=${manifest.git_sha} expected=${expectedSha}`);
  }
  console.log(`[before-pack] me2-ui-dist OK: build_id=${manifest.build_id} sha=${manifest.git_sha} node_modules=included`);
};
