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

// Debounces calls with the given delay, and queues the next call while the
// previous one hasn't completed so that no two calls can execute concurrently.
function debounceAsyncQueue(fn, delay) {
  let timeout;
  let waiting = false;
  let executing = false;
  let callbacks = [];

  async function execute() {
    const currentCallbacks = callbacks;
    callbacks = [];
    executing = true;
    const res = await fn();
    currentCallbacks.forEach((c) => c(res));
    executing = false;
    if (callbacks.length > 0) {
      await execute();
    }
  }

  return () =>
    new Promise((resolve, reject) => {
      callbacks.push(resolve);

      if (!executing) {
        if (waiting) {
          clearTimeout(timeout);
        } else {
          waiting = true;
        }
        timeout = setTimeout(async () => {
          waiting = false;
          await execute();
        }, delay);
      }
    });
}

module.exports = debounceAsyncQueue;
