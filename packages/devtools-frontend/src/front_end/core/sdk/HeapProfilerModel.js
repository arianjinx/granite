// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
import { RuntimeModel } from './RuntimeModel.js';
import { SDKModel } from './SDKModel.js';
export class HeapProfilerModel extends SDKModel {
    #enabled;
    #heapProfilerAgent;
    #runtimeModelInternal;
    #samplingProfilerDepth;
    constructor(target) {
        super(target);
        target.registerHeapProfilerDispatcher(new HeapProfilerDispatcher(this));
        this.#enabled = false;
        this.#heapProfilerAgent = target.heapProfilerAgent();
        this.#runtimeModelInternal = target.model(RuntimeModel);
        this.#samplingProfilerDepth = 0;
    }
    debuggerModel() {
        return this.#runtimeModelInternal.debuggerModel();
    }
    runtimeModel() {
        return this.#runtimeModelInternal;
    }
    async enable() {
        if (this.#enabled) {
            return;
        }
        this.#enabled = true;
        await this.#heapProfilerAgent.invoke_enable();
    }
    async startSampling(samplingRateInBytes) {
        if (this.#samplingProfilerDepth++) {
            return false;
        }
        const defaultSamplingIntervalInBytes = 16384;
        const response = await this.#heapProfilerAgent.invoke_startSampling({ samplingInterval: samplingRateInBytes || defaultSamplingIntervalInBytes });
        return Boolean(response.getError());
    }
    async stopSampling() {
        if (!this.#samplingProfilerDepth) {
            throw new Error('Sampling profiler is not running.');
        }
        if (--this.#samplingProfilerDepth) {
            return this.getSamplingProfile();
        }
        const response = await this.#heapProfilerAgent.invoke_stopSampling();
        if (response.getError()) {
            return null;
        }
        return response.profile;
    }
    async getSamplingProfile() {
        const response = await this.#heapProfilerAgent.invoke_getSamplingProfile();
        if (response.getError()) {
            return null;
        }
        return response.profile;
    }
    async collectGarbage() {
        const response = await this.#heapProfilerAgent.invoke_collectGarbage();
        return Boolean(response.getError());
    }
    async snapshotObjectIdForObjectId(objectId) {
        const response = await this.#heapProfilerAgent.invoke_getHeapObjectId({ objectId });
        if (response.getError()) {
            return null;
        }
        return response.heapSnapshotObjectId;
    }
    async objectForSnapshotObjectId(snapshotObjectId, objectGroupName) {
        const result = await this.#heapProfilerAgent.invoke_getObjectByHeapObjectId({ objectId: snapshotObjectId, objectGroup: objectGroupName });
        if (result.getError()) {
            return null;
        }
        return this.#runtimeModelInternal.createRemoteObject(result.result);
    }
    async addInspectedHeapObject(snapshotObjectId) {
        const response = await this.#heapProfilerAgent.invoke_addInspectedHeapObject({ heapObjectId: snapshotObjectId });
        return Boolean(response.getError());
    }
    async takeHeapSnapshot(heapSnapshotOptions) {
        const response = await this.#heapProfilerAgent.invoke_takeHeapSnapshot(heapSnapshotOptions);
        return Boolean(response.getError());
    }
    async startTrackingHeapObjects(recordAllocationStacks) {
        const response = await this.#heapProfilerAgent.invoke_startTrackingHeapObjects({ trackAllocations: recordAllocationStacks });
        return Boolean(response.getError());
    }
    async stopTrackingHeapObjects(reportProgress) {
        const response = await this.#heapProfilerAgent.invoke_stopTrackingHeapObjects({ reportProgress });
        return Boolean(response.getError());
    }
    heapStatsUpdate(samples) {
        this.dispatchEventToListeners("HeapStatsUpdate" /* Events.HeapStatsUpdate */, samples);
    }
    lastSeenObjectId(lastSeenObjectId, timestamp) {
        this.dispatchEventToListeners("LastSeenObjectId" /* Events.LastSeenObjectId */, { lastSeenObjectId: lastSeenObjectId, timestamp: timestamp });
    }
    addHeapSnapshotChunk(chunk) {
        this.dispatchEventToListeners("AddHeapSnapshotChunk" /* Events.AddHeapSnapshotChunk */, chunk);
    }
    reportHeapSnapshotProgress(done, total, finished) {
        this.dispatchEventToListeners("ReportHeapSnapshotProgress" /* Events.ReportHeapSnapshotProgress */, { done: done, total: total, finished: finished });
    }
    resetProfiles() {
        this.dispatchEventToListeners("ResetProfiles" /* Events.ResetProfiles */, this);
    }
}
class HeapProfilerDispatcher {
    #heapProfilerModel;
    constructor(model) {
        this.#heapProfilerModel = model;
    }
    heapStatsUpdate({ statsUpdate }) {
        this.#heapProfilerModel.heapStatsUpdate(statsUpdate);
    }
    lastSeenObjectId({ lastSeenObjectId, timestamp }) {
        this.#heapProfilerModel.lastSeenObjectId(lastSeenObjectId, timestamp);
    }
    addHeapSnapshotChunk({ chunk }) {
        this.#heapProfilerModel.addHeapSnapshotChunk(chunk);
    }
    reportHeapSnapshotProgress({ done, total, finished }) {
        this.#heapProfilerModel.reportHeapSnapshotProgress(done, total, finished);
    }
    resetProfiles() {
        this.#heapProfilerModel.resetProfiles();
    }
}
SDKModel.register(HeapProfilerModel, { capabilities: 4 /* Capability.JS */, autostart: false });
//# sourceMappingURL=HeapProfilerModel.js.map