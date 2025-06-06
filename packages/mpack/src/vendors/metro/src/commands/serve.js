/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 * @format
 */

'use strict';

const { makeAsyncCommand, watchFile } = require('../cli-utils');
// MARK: - GRANITE
const { loadConfig, resolveConfig } = require('../../../metro-config/src');
const { promisify } = require('util');

module.exports = () => ({
  command: 'serve',
  aliases: ['start'],
  desc: 'Starts Metro on the given port, building bundles on the fly',

  builder: (yargs) => {
    yargs.option('project-roots', {
      alias: 'P',
      type: 'string',
      array: true,
    });

    yargs.option('host', { alias: 'h', type: 'string', default: 'localhost' });
    yargs.option('port', { alias: 'p', type: 'number', default: 8080 });

    yargs.option('max-workers', { alias: 'j', type: 'number' });

    yargs.option('secure', { type: 'boolean', describe: '(deprecated)' });
    yargs.option('secure-key', { type: 'string', describe: '(deprecated)' });
    yargs.option('secure-cert', { type: 'string', describe: '(deprecated)' });
    yargs.option('secure-server-options', {
      alias: 's',
      type: 'string',
      describe: 'Use dot notation for object path',
    });

    yargs.option('hmr-enabled', { alias: 'hmr', type: 'boolean' });

    yargs.option('config', { alias: 'c', type: 'string' });

    // Deprecated
    yargs.option('reset-cache', { type: 'boolean' });

    // Examples
    yargs.example('secure-server-options', '-s.cert="$(cat path/to/cert)" -s.key="$(cat path/to/key")');
  },

  handler: makeAsyncCommand(async (argv) => {
    let server = null;
    let restarting = false;

    async function restart() {
      if (restarting) {
        return;
      } else {
        restarting = true;
      }

      if (server) {
        // eslint-disable-next-line no-console
        console.log('Configuration changed. Restarting the server...');
        // $FlowFixMe[method-unbinding] added when improving typing for this parameters
        await promisify(server.close).call(server);
      }

      const config = await loadConfig(argv);

      // Inline require() to avoid circular dependency with ../index
      const MetroApi = require('../index');

      // $FlowExpectedError YargArguments and RunBuildOptions are used interchangeable but their types are not yet compatible
      server = await MetroApi.runServer(config, argv);

      restarting = false;
    }

    const foundConfig = await resolveConfig(argv.config, argv.cwd);

    if (foundConfig) {
      await watchFile(foundConfig.filepath, restart);
    } else {
      await restart();
    }
  }),
});
