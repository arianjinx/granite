/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *       strict-local
 * @format
 */

'use strict';

const buildSourcemapWithMetadata = require('../../shared/output/RamBundle/buildSourcemapWithMetadata.js');
const MAGIC_UNBUNDLE_NUMBER = require('../../shared/output/RamBundle/magic-number');
const { getModuleCodeAndMap, partition, toModuleTransport } = require('./util');
const path = require('path');

const MAGIC_UNBUNDLE_FILENAME = 'UNBUNDLE';
const JS_MODULES = 'js-modules';

function asMultipleFilesRamBundle({
  dependencyMapReservedName,
  filename,
  globalPrefix,
  idsForPath,
  modules,
  requireCalls,
  preloadedModules,
}) {
  const idForPath = (x) => idsForPath(x).moduleId;
  const [startup, deferred] = partition(modules, preloadedModules);
  const startupModules = [...startup, ...requireCalls];
  const deferredModules = deferred.map((m) =>
    toModuleTransport(m, idsForPath, { dependencyMapReservedName, globalPrefix })
  );
  const magicFileContents = Buffer.alloc(4);

  // Just concatenate all startup modules, one after the other.
  const code = startupModules
    .map(
      (m) =>
        getModuleCodeAndMap(m, idForPath, {
          dependencyMapReservedName,
          enableIDInlining: true,
          globalPrefix,
        }).moduleCode
    )
    .join('\n');

  // Write one file per module, wrapped with __d() call if it proceeds.
  const extraFiles = new Map();
  deferredModules.forEach((deferredModule) => {
    extraFiles.set(path.join(JS_MODULES, deferredModule.id + '.js'), deferredModule.code);
  });

  // Prepare and write magic number file.
  magicFileContents.writeUInt32LE(MAGIC_UNBUNDLE_NUMBER, 0);
  extraFiles.set(path.join(JS_MODULES, MAGIC_UNBUNDLE_FILENAME), magicFileContents);

  // Create the source map (with no module groups, as they are ignored).
  const map = buildSourcemapWithMetadata({
    fixWrapperOffset: false,
    lazyModules: deferredModules,
    moduleGroups: null,
    startupModules: startupModules.map((m) =>
      toModuleTransport(m, idsForPath, {
        dependencyMapReservedName,
        globalPrefix,
      })
    ),
  });

  return { code, extraFiles, map };
}

function createBuilder(preloadedModules, ramGroupHeads) {
  return (x) => asMultipleFilesRamBundle({ ...x, preloadedModules, ramGroupHeads });
}

exports.createBuilder = createBuilder;
