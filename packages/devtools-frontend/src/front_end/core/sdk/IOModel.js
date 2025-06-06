// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
import * as Common from '../common/common.js';
import { RemoteObject } from './RemoteObject.js';
import { SDKModel } from './SDKModel.js';
// [RN] Increase IO read size default
const IO_READ_SIZE = 1024 * 1024 * 4;
export class IOModel extends SDKModel {
    constructor(target) {
        super(target);
    }
    async read(handle, size, offset) {
        const result = await this.target().ioAgent().invoke_read({ handle, offset, size });
        if (result.getError()) {
            throw new Error(result.getError());
        }
        if (result.eof) {
            return null;
        }
        if (result.base64Encoded) {
            return Common.Base64.decode(result.data);
        }
        return result.data;
    }
    async close(handle) {
        const result = await this.target().ioAgent().invoke_close({ handle });
        if (result.getError()) {
            console.error('Could not close stream.');
        }
    }
    async resolveBlob(objectOrObjectId) {
        const objectId = objectOrObjectId instanceof RemoteObject ? objectOrObjectId.objectId : objectOrObjectId;
        if (!objectId) {
            throw new Error('Remote object has undefined objectId');
        }
        const result = await this.target().ioAgent().invoke_resolveBlob({ objectId });
        if (result.getError()) {
            throw new Error(result.getError());
        }
        return `blob:${result.uuid}`;
    }
    async readToString(handle) {
        const strings = [];
        const decoder = new TextDecoder();
        for (;;) {
            const data = await this.read(handle, IO_READ_SIZE);
            if (data === null) {
                strings.push(decoder.decode());
                break;
            }
            if (data instanceof ArrayBuffer) {
                strings.push(decoder.decode(data, { stream: true }));
            }
            else {
                strings.push(data);
            }
        }
        return strings.join('');
    }
}
SDKModel.register(IOModel, { capabilities: 131072 /* Capability.IO */, autostart: true });
//# sourceMappingURL=IOModel.js.map