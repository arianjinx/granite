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

/*::
export type * from './index.flow';
*/

try {
  require('metro-babel-register').unstable_registerForMetroMonorepo();
} catch {}

module.exports = require('./index.flow');
