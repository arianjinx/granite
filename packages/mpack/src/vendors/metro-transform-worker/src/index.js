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

const getMinifier = require('./utils/getMinifier');
const { transformFromAstSync } = require('@babel/core');
const generate = require('@babel/generator').default;
const babylon = require('@babel/parser');
const types = require('@babel/types');
const { stableHash } = require('metro-cache');
const getCacheKey = require('metro-cache-key');
const { fromRawMappings, toBabelSegments, toSegmentTuple } = require('metro-source-map');
const metroTransformPlugins = require('metro-transform-plugins');
// MARK: - GRANITE
const countLines = require('../../metro/src/lib/countLines');
const {
  InvalidRequireCallError: InternalInvalidRequireCallError,
} = require('../../metro/src/ModuleGraph/worker/collectDependencies');
const generateImportNames = require('../../metro/src/ModuleGraph/worker/generateImportNames');
const JsFileWrapping = require('../../metro/src/ModuleGraph/worker/JsFileWrapping');

const nullthrows = require('nullthrows');

function getDynamicDepsBehavior(inPackages, filename) {
  switch (inPackages) {
    case 'reject':
      return 'reject';
    case 'throwAtRuntime':
      const isPackage = /(?:^|[/\\])node_modules[/\\]/.test(filename);
      return isPackage ? inPackages : 'reject';
    default:
      inPackages;
      throw new Error(`invalid value for dynamic deps behavior: \`${inPackages}\``);
  }
}

const minifyCode = async (config, projectRoot, filename, code, source, map, reserved = []) => {
  const sourceMap = fromRawMappings([{ code, source, map, functionMap: null, path: filename }]).toMap(undefined, {});

  const minify = getMinifier(config.minifierPath);

  try {
    const minified = await minify({
      code,
      map: sourceMap,
      filename,
      reserved,
      config: config.minifierConfig,
    });

    return {
      code: minified.code,
      map: minified.map ? toBabelSegments(minified.map).map(toSegmentTuple) : [],
    };
  } catch (error) {
    if (error.constructor.name === 'JS_Parse_Error') {
      throw new Error(`${error.message} in file ${filename} at ${error.line}:${error.col}`);
    }

    throw error;
  }
};

const compileToBytecode = (rawCode, type, options) => {
  let code = rawCode;
  if (type.startsWith('js/module')) {
    const index = code.lastIndexOf(')');
    code = code.slice(0, index) + ',$$METRO_D[0],$$METRO_D[1],$$METRO_D[2]' + code.slice(index);
  }
  const HermesCompiler = require('metro-hermes-compiler');
  return HermesCompiler.compile(code, options);
};

const disabledDependencyTransformer = {
  transformSyncRequire: () => void 0,
  transformImportCall: () => void 0,
  transformJSResource: () => void 0,
  transformPrefetch: () => void 0,
  transformIllegalDynamicRequire: () => void 0,
};

class InvalidRequireCallError extends Error {
  innerError;
  filename;

  constructor(innerError, filename) {
    super(`${filename}:${innerError.message}`);
    this.innerError = innerError;
    this.filename = filename;
  }
}

async function transformJS(file, { config, options, projectRoot }) {
  // Transformers can output null ASTs (if they ignore the file). In that case
  // we need to parse the module source code to get their AST.
  let ast = file.ast ?? babylon.parse(file.code, { sourceType: 'unambiguous' });

  const { importDefault, importAll } = generateImportNames(ast);

  // Add "use strict" if the file was parsed as a module, and the directive did
  // not exist yet.
  const { directives } = ast.program;

  if (
    ast.program.sourceType === 'module' &&
    directives != null &&
    directives.findIndex((d) => d.value.value === 'use strict') === -1
  ) {
    directives.push(types.directive(types.directiveLiteral('use strict')));
  }

  // Perform the import-export transform (in case it's still needed), then
  // fold requires and perform constant folding (if in dev).
  const plugins = [];
  const babelPluginOpts = {
    ...options,
    inlineableCalls: [importDefault, importAll],
    importDefault,
    importAll,
  };

  if (options.experimentalImportSupport === true) {
    plugins.push([metroTransformPlugins.importExportPlugin, babelPluginOpts]);
  }

  if (options.inlineRequires) {
    plugins.push([
      // $FlowFixMe[untyped-import] untyped module
      require('babel-preset-fbjs/plugins/inline-requires'),
      {
        ...babelPluginOpts,
        ignoredRequires: options.nonInlinedRequires,
      },
    ]);
  }

  plugins.push([metroTransformPlugins.inlinePlugin, babelPluginOpts]);

  ast = nullthrows(
    transformFromAstSync(ast, '', {
      ast: true,
      babelrc: false,
      code: false,
      configFile: false,
      comments: false,
      filename: file.filename,
      plugins,
      sourceMaps: false,
      // Not-Cloning the input AST here should be safe because other code paths above this call
      // are mutating the AST as well and no code is depending on the original AST.
      // However, switching the flag to false caused issues with ES Modules if `experimentalImportSupport` isn't used https://github.com/facebook/metro/issues/641
      // either because one of the plugins is doing something funky or Babel messes up some caches.
      // Make sure to test the above mentioned case before flipping the flag back to false.
      cloneInputAst: true,
    }).ast
  );

  if (!options.dev) {
    // Run the constant folding plugin in its own pass, avoiding race conditions
    // with other plugins that have exit() visitors on Program (e.g. the ESM
    // transform).
    ast = nullthrows(
      transformFromAstSync(ast, '', {
        ast: true,
        babelrc: false,
        code: false,
        configFile: false,
        comments: false,
        filename: file.filename,
        plugins: [[metroTransformPlugins.constantFoldingPlugin, babelPluginOpts]],
        sourceMaps: false,
        cloneInputAst: false,
      }).ast
    );
  }

  let dependencyMapName = '';
  let dependencies;
  let wrappedAst;

  // If the module to transform is a script (meaning that is not part of the
  // dependency graph and it code will just be prepended to the bundle modules),
  // we need to wrap it differently than a commonJS module (also, scripts do
  // not have dependencies).
  if (file.type === 'js/script') {
    dependencies = [];
    wrappedAst = JsFileWrapping.wrapPolyfill(ast);
  } else {
    try {
      const opts = {
        asyncRequireModulePath: config.asyncRequireModulePath,
        dependencyTransformer:
          config.unstable_disableModuleWrapping === true ? disabledDependencyTransformer : undefined,
        dynamicRequires: getDynamicDepsBehavior(config.dynamicDepsInPackages, file.filename),
        inlineableCalls: [importDefault, importAll],
        keepRequireNames: options.dev,
        allowOptionalDependencies: config.allowOptionalDependencies,
        dependencyMapName: config.unstable_dependencyMapReservedName,
        unstable_allowRequireContext: config.unstable_allowRequireContext,
      };
      // $FlowFixMe[unsupported-syntax] dynamic require
      const collectDependencies = require(config.unstable_collectDependenciesPath);
      ({ ast, dependencies, dependencyMapName } = collectDependencies(ast, opts));
    } catch (error) {
      if (error instanceof InternalInvalidRequireCallError) {
        throw new InvalidRequireCallError(error, file.filename);
      }
      throw error;
    }

    if (config.unstable_disableModuleWrapping === true) {
      wrappedAst = ast;
    } else {
      ({ ast: wrappedAst } = JsFileWrapping.wrapModule(
        ast,
        importDefault,
        importAll,
        dependencyMapName,
        config.globalPrefix
      ));
    }
  }

  const minify =
    options.minify &&
    options.unstable_transformProfile !== 'hermes-canary' &&
    options.unstable_transformProfile !== 'hermes-stable';

  const reserved = [];
  if (config.unstable_dependencyMapReservedName != null) {
    reserved.push(config.unstable_dependencyMapReservedName);
  }
  if (minify && file.inputFileSize <= config.optimizationSizeLimit && !config.unstable_disableNormalizePseudoGlobals) {
    reserved.push(
      ...metroTransformPlugins.normalizePseudoGlobals(wrappedAst, {
        reservedNames: reserved,
      })
    );
  }

  const result = generate(
    wrappedAst,
    {
      comments: false,
      compact: config.unstable_compactOutput,
      filename: file.filename,
      retainLines: false,
      sourceFileName: file.filename,
      sourceMaps: true,
    },
    file.code
  );

  let map = result.rawMappings ? result.rawMappings.map(toSegmentTuple) : [];
  let code = result.code;

  if (minify) {
    ({ map, code } = await minifyCode(config, projectRoot, file.filename, result.code, file.code, map, reserved));
  }

  const output = [
    {
      data: {
        code,
        lineCount: countLines(code),
        map,
        functionMap: file.functionMap,
      },
      type: file.type,
    },
  ];

  if (options.runtimeBytecodeVersion != null) {
    output.push({
      data: compileToBytecode(code, file.type, {
        sourceURL: file.filename,
        sourceMap: fromRawMappings([
          {
            code,
            source: file.code,
            map,
            functionMap: null,
            path: file.filename,
          },
        ]).toString(),
      }),
      type: getBytecodeFileType(file.type),
    });
  }

  return {
    dependencies,
    output,
  };
}

/**
 * Transforms an asset file
 */
async function transformAsset(file, context) {
  const assetTransformer = require('./utils/assetTransformer');
  const { assetRegistryPath, assetPlugins } = context.config;

  const result = await assetTransformer.transform(
    getBabelTransformArgs(file, context),
    assetRegistryPath,
    assetPlugins
  );

  const jsFile = {
    ...file,
    type: 'js/module/asset',
    ast: result.ast,
    functionMap: null,
  };

  return transformJS(jsFile, context);
}

/**
 * Transforms a JavaScript file with Babel before processing the file with
 * the generic JavaScript transformation.
 */
async function transformJSWithBabel(file, context) {
  const { babelTransformerPath } = context.config;
  // $FlowFixMe[unsupported-syntax] dynamic require
  const transformer = require(babelTransformerPath);

  const transformResult = await transformer.transform(getBabelTransformArgs(file, context));

  const jsFile = {
    ...file,
    ast: transformResult.ast,
    functionMap: transformResult.functionMap ?? null,
  };

  return await transformJS(jsFile, context);
}

async function transformJSON(file, { options, config, projectRoot }) {
  let code =
    config.unstable_disableModuleWrapping === true
      ? JsFileWrapping.jsonToCommonJS(file.code)
      : JsFileWrapping.wrapJson(file.code, config.globalPrefix);
  let map = [];

  // TODO: When we can reuse transformJS for JSON, we should not derive `minify` separately.
  const minify =
    options.minify &&
    options.unstable_transformProfile !== 'hermes-canary' &&
    options.unstable_transformProfile !== 'hermes-stable';

  if (minify) {
    ({ map, code } = await minifyCode(config, projectRoot, file.filename, code, file.code, map));
  }

  let jsType;

  if (file.type === 'asset') {
    jsType = 'js/module/asset';
  } else if (file.type === 'script') {
    jsType = 'js/script';
  } else {
    jsType = 'js/module';
  }

  const output = [
    {
      data: { code, lineCount: countLines(code), map, functionMap: null },
      type: jsType,
    },
  ];

  if (options.runtimeBytecodeVersion != null) {
    output.push({
      data: compileToBytecode(code, jsType, {
        sourceURL: file.filename,
        sourceMap: fromRawMappings([
          {
            code,
            source: file.code,
            map,
            functionMap: null,
            path: file.filename,
          },
        ]).toString(),
      }),
      type: getBytecodeFileType(jsType),
    });
  }

  return {
    dependencies: [],
    output,
  };
}

/**
 * Returns the bytecode type for a file type
 */
function getBytecodeFileType(type) {
  switch (type) {
    case 'js/module/asset':
      return 'bytecode/module/asset';
    case 'js/script':
      return 'bytecode/script';
    default:
      type;
      return 'bytecode/module';
  }
}

function getBabelTransformArgs(file, { options, config, projectRoot }) {
  const additionalBabelConfig = config.INTERNAL__babelConfig ?? {};

  return {
    filename: file.filename,
    options: {
      ...options,
      enableBabelRCLookup: config.enableBabelRCLookup,
      enableBabelRuntime: config.enableBabelRuntime,
      globalPrefix: config.globalPrefix,
      hermesParser: config.hermesParser,
      // Inline requires are now performed at a secondary step. We cannot
      // unfortunately remove it from the internal transformer, since this one
      // is used by other tooling, and this would affect it.
      inlineRequires: false,
      nonInlinedRequires: [],
      projectRoot,
      publicPath: config.publicPath,
    },
    // MARK: - GRANITE
    ...additionalBabelConfig,
    plugins: additionalBabelConfig?.plugins ?? [],
    filename: file.filename,
    src: file.code,
  };
}

module.exports = {
  transform: async (config, projectRoot, filename, data, options) => {
    const context = {
      config,
      projectRoot,
      options,
    };
    const sourceCode = data.toString('utf8');

    const { unstable_dependencyMapReservedName } = config;
    if (unstable_dependencyMapReservedName != null) {
      const position = sourceCode.indexOf(unstable_dependencyMapReservedName);
      if (position > -1) {
        throw new SyntaxError(
          'Source code contains the reserved string `' +
            unstable_dependencyMapReservedName +
            '` at character offset ' +
            position
        );
      }
    }

    if (filename.endsWith('.json')) {
      const jsonFile = {
        filename,
        inputFileSize: data.length,
        code: sourceCode,
        type: options.type,
      };

      return await transformJSON(jsonFile, context);
    }

    if (options.type === 'asset') {
      const file = {
        filename,
        inputFileSize: data.length,
        code: sourceCode,
        type: options.type,
      };

      return await transformAsset(file, context);
    }

    const file = {
      filename,
      inputFileSize: data.length,
      code: sourceCode,
      type: options.type === 'script' ? 'js/script' : 'js/module',
      functionMap: null,
    };

    return await transformJSWithBabel(file, context);
  },

  getCacheKey: (config) => {
    const { babelTransformerPath, minifierPath, unstable_collectDependenciesPath, ...remainingConfig } = config;

    const filesKey = getCacheKey([
      require.resolve(babelTransformerPath),
      require.resolve(minifierPath),
      require.resolve('./utils/getMinifier'),
      require.resolve('./utils/assetTransformer'),
      require.resolve(unstable_collectDependenciesPath),
      // MARK: - GRANITE
      require.resolve('../../metro/src/ModuleGraph/worker/generateImportNames'),
      require.resolve('../../metro/src/ModuleGraph/worker/JsFileWrapping'),
      ...metroTransformPlugins.getTransformPluginCacheKeyFiles(),
    ]);

    // $FlowFixMe[unsupported-syntax]
    const babelTransformer = require(babelTransformerPath);
    return [
      filesKey,
      stableHash(remainingConfig).toString('hex'),
      babelTransformer.getCacheKey ? babelTransformer.getCacheKey() : '',
    ].join('$');
  },
};
