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

import { getContextModuleTemplate } from './contextModuleTemplates';

const path = require('path');

const baseIgnoredInlineRequires = ['React', 'react', 'react-native'];

async function calcTransformerOptions(entryFiles, bundler, deltaBundler, config, options, resolverOptions) {
  const baseOptions = {
    customTransformOptions: options.customTransformOptions,
    dev: options.dev,
    hot: options.hot,
    inlineRequires: false,
    inlinePlatform: true,
    minify: options.minify,
    platform: options.platform,
    runtimeBytecodeVersion: options.runtimeBytecodeVersion,
    unstable_transformProfile: options.unstable_transformProfile,
  };

  // When we're processing scripts, we don't need to calculate any
  // inlineRequires information, since scripts by definition don't have
  // requires().
  if (options.type === 'script') {
    return {
      ...baseOptions,
      type: 'script',
    };
  }

  const getDependencies = async (path) => {
    const dependencies = await deltaBundler.getDependencies([path], {
      resolve: await getResolveDependencyFn(bundler, options.platform, resolverOptions),
      transform: await getTransformFn(
        [path],
        bundler,
        deltaBundler,
        config,
        {
          ...options,
          minify: false,
        },
        resolverOptions
      ),
      transformOptions: options,
      onProgress: null,
      experimentalImportBundleSupport: config.transformer.experimentalImportBundleSupport,
      unstable_allowRequireContext: config.transformer.unstable_allowRequireContext,
      shallow: false,
    });

    return Array.from(dependencies.keys());
  };

  const { transform } = await config.transformer.getTransformOptions(
    entryFiles,
    { dev: options.dev, hot: options.hot, platform: options.platform },
    getDependencies
  );

  return {
    ...baseOptions,
    inlineRequires: transform.inlineRequires || false,
    experimentalImportSupport: transform.experimentalImportSupport || false,
    unstable_disableES6Transforms: transform.unstable_disableES6Transforms || false,
    nonInlinedRequires: transform.nonInlinedRequires || baseIgnoredInlineRequires,
    type: 'module',
  };
}

function removeInlineRequiresBlockListFromOptions(path, inlineRequires) {
  if (typeof inlineRequires === 'object') {
    return !(path in inlineRequires.blockList);
  }

  return inlineRequires;
}

async function getTransformFn(entryFiles, bundler, deltaBundler, config, options, resolverOptions) {
  const { inlineRequires, ...transformOptions } = await calcTransformerOptions(
    entryFiles,
    bundler,
    deltaBundler,
    config,
    options,
    resolverOptions
  );

  return async (modulePath, requireContext) => {
    let templateBuffer;

    if (requireContext) {
      const graph = await bundler.getDependencyGraph();

      // TODO: Check delta changes to avoid having to look over all files each time
      // this is a massive performance boost.

      // Search against all files, this is very expensive.
      // TODO: Maybe we could let the user specify which root to check against.
      const files = graph.matchFilesWithContext(requireContext.from, {
        filter: requireContext.filter,
        recursive: requireContext.recursive,
      });

      const template = getContextModuleTemplate(requireContext.mode, requireContext.from, files);

      templateBuffer = Buffer.from(template);
    }

    return await bundler.transformFile(
      modulePath,
      {
        ...transformOptions,
        type: getType(transformOptions.type, modulePath, config.resolver.assetExts),
        inlineRequires: removeInlineRequiresBlockListFromOptions(modulePath, inlineRequires),
      },
      templateBuffer
    );
  };
}

function getType(type, filePath, assetExts) {
  if (type === 'script') {
    return type;
  }

  if (assetExts.indexOf(path.extname(filePath).slice(1)) !== -1) {
    return 'asset';
  }

  return 'module';
}

async function getResolveDependencyFn(bundler, platform, resolverOptions) {
  const dependencyGraph = await await bundler.getDependencyGraph();

  return (from, to) => dependencyGraph.resolveDependency(from, to, platform ?? null, resolverOptions);
}

module.exports = {
  getTransformFn,
  getResolveDependencyFn,
};
