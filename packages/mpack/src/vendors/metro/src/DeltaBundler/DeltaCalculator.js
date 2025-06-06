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

import {
  createGraph,
  initialTraverseDependencies,
  markModifiedContextModules,
  reorderGraph,
  traverseDependencies,
} from './graphOperations';

const { EventEmitter } = require('events');

/**
 * This class is in charge of calculating the delta of changed modules that
 * happen between calls. To do so, it subscribes to file changes, so it can
 * traverse the files that have been changed between calls and avoid having to
 * traverse the whole dependency tree for trivial small changes.
 */
class DeltaCalculator extends EventEmitter {
  _changeEventSource;
  _options;

  _currentBuildPromise;
  _deletedFiles = new Set();
  _modifiedFiles = new Set();
  _addedFiles = new Set();

  _graph;

  constructor(entryPoints, changeEventSource, options) {
    super();

    this._options = options;
    this._changeEventSource = changeEventSource;

    this._graph = createGraph({
      entryPoints,
      transformOptions: this._options.transformOptions,
    });

    this._changeEventSource.on('change', this._handleMultipleFileChanges);
  }

  /**
   * Stops listening for file changes and clears all the caches.
   */
  end() {
    this._changeEventSource.removeListener('change', this._handleMultipleFileChanges);

    this.removeAllListeners();

    // Clean up all the cache data structures to deallocate memory.
    this._graph = createGraph({
      entryPoints: this._graph.entryPoints,
      transformOptions: this._options.transformOptions,
    });
    this._modifiedFiles = new Set();
    this._deletedFiles = new Set();
    this._addedFiles = new Set();
  }

  /**
   * Main method to calculate the delta of modules. It returns a DeltaResult,
   * which contain the modified/added modules and the removed modules.
   */
  async getDelta({ reset, shallow }) {
    // If there is already a build in progress, wait until it finish to start
    // processing a new one (delta server doesn't support concurrent builds).
    if (this._currentBuildPromise) {
      await this._currentBuildPromise;
    }

    // We don't want the modified files Set to be modified while building the
    // bundle, so we isolate them by using the current instance for the bundling
    // and creating a new instance for the file watcher.
    const modifiedFiles = this._modifiedFiles;
    this._modifiedFiles = new Set();
    const deletedFiles = this._deletedFiles;
    this._deletedFiles = new Set();
    const addedFiles = this._addedFiles;
    this._addedFiles = new Set();

    // Concurrent requests should reuse the same bundling process. To do so,
    // this method stores the promise as an instance variable, and then it's
    // removed after it gets resolved.
    this._currentBuildPromise = this._getChangedDependencies(modifiedFiles, deletedFiles, addedFiles);

    let result;

    const numDependencies = this._graph.dependencies.size;

    try {
      result = await this._currentBuildPromise;
    } catch (error) {
      // In case of error, we don't want to mark the modified files as
      // processed (since we haven't actually created any delta). If we do not
      // do so, asking for a delta after an error will produce an empty Delta,
      // which is not correct.
      modifiedFiles.forEach((file) => this._modifiedFiles.add(file));
      deletedFiles.forEach((file) => this._deletedFiles.add(file));
      addedFiles.forEach((file) => this._addedFiles.add(file));

      // If after an error the number of modules has changed, we could be in
      // a weird state. As a safe net we clean the dependency modules to force
      // a clean traversal of the graph next time.
      if (this._graph.dependencies.size !== numDependencies) {
        this._graph.dependencies = new Map();
      }

      throw error;
    } finally {
      this._currentBuildPromise = null;
    }

    // Return all the modules if the client requested a reset delta.
    if (reset) {
      reorderGraph(this._graph, { shallow });

      return {
        added: this._graph.dependencies,
        modified: new Map(),
        deleted: new Set(),
        reset: true,
      };
    }

    return result;
  }

  /**
   * Returns the graph with all the dependencies. Each module contains the
   * needed information to do the traversing (dependencies, inverseDependencies)
   * plus some metadata.
   */
  getGraph() {
    return this._graph;
  }

  /* $FlowFixMe[missing-local-annot] The type annotation(s) required by Flow's
   * LTI update could not be added via codemod */
  _handleMultipleFileChanges = ({ eventsQueue }) => {
    eventsQueue.forEach(this._handleFileChange);
  };

  /**
   * Handles a single file change. To avoid doing any work before it's needed,
   * the listener only stores the modified file, which will then be used later
   * when the delta needs to be calculated.
   */
  _handleFileChange = ({ type, filePath }) => {
    let state;
    if (this._deletedFiles.has(filePath)) {
      state = 'deleted';
    } else if (this._modifiedFiles.has(filePath)) {
      state = 'modified';
    } else if (this._addedFiles.has(filePath)) {
      state = 'added';
    }

    let nextState;
    if (type === 'delete') {
      nextState = 'deleted';
    } else if (type === 'add') {
      // A deleted+added file is modified
      nextState = state === 'deleted' ? 'modified' : 'added';
    } else {
      // type === 'change'
      // An added+modified file is added
      nextState = state === 'added' ? 'added' : 'modified';
    }

    switch (nextState) {
      case 'deleted':
        this._deletedFiles.add(filePath);
        this._modifiedFiles.delete(filePath);
        this._addedFiles.delete(filePath);
        break;
      case 'added':
        this._addedFiles.add(filePath);
        this._deletedFiles.delete(filePath);
        this._modifiedFiles.delete(filePath);
        break;
      case 'modified':
        this._modifiedFiles.add(filePath);
        this._deletedFiles.delete(filePath);
        this._addedFiles.delete(filePath);
        break;
      default:
        nextState;
    }

    // Notify users that there is a change in some of the bundle files. This
    // way the client can choose to refetch the bundle.
    this.emit('change');
  };

  async _getChangedDependencies(modifiedFiles, deletedFiles, addedFiles) {
    if (!this._graph.dependencies.size) {
      const { added } = await initialTraverseDependencies(this._graph, this._options);

      return {
        added,
        modified: new Map(),
        deleted: new Set(),
        reset: true,
      };
    }

    // If a file has been deleted, we want to invalidate any other file that
    // depends on it, so we can process it and correctly return an error.
    deletedFiles.forEach((filePath) => {
      const module = this._graph.dependencies.get(filePath);

      if (module) {
        module.inverseDependencies.forEach((path) => {
          // Only mark the inverse dependency as modified if it's not already
          // marked as deleted (in that case we can just ignore it).
          if (!deletedFiles.has(path)) {
            modifiedFiles.add(path);
          }
        });
      }
    });

    // NOTE(EvanBacon): This check adds extra complexity so we feature gate it
    // to enable users to opt out.
    if (this._options.unstable_allowRequireContext) {
      // Check if any added or removed files are matched in a context module.
      // We only need to do this for added files because (1) deleted files will have a context
      // module as an inverse dependency, (2) modified files don't invalidate the contents
      // of the context module.
      addedFiles.forEach((filePath) => {
        markModifiedContextModules(this._graph, filePath, modifiedFiles);
      });
    }

    // We only want to process files that are in the bundle.
    const modifiedDependencies = Array.from(modifiedFiles).filter((filePath) => this._graph.dependencies.has(filePath));

    // No changes happened. Return empty delta.
    if (modifiedDependencies.length === 0) {
      return {
        added: new Map(),
        modified: new Map(),
        deleted: new Set(),
        reset: false,
      };
    }

    const { added, modified, deleted } = await traverseDependencies(modifiedDependencies, this._graph, this._options);

    return {
      added,
      modified,
      deleted,
      reset: false,
    };
  }
}

module.exports = DeltaCalculator;
