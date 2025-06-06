// Copyright 2022 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
import { assertNotNullOrUndefined } from '../../core/platform/platform.js';
import * as SDK from '../../core/sdk/sdk.js';
import * as Console from './console.js';
const { assert } = chai;
const { parseSourcePositionsFromErrorStack } = Console.ErrorStackParser;
describe('ErrorStackParser', () => {
    let runtimeModel;
    let parseErrorStack;
    const fileTestingUrl = 'file:///testing.js';
    beforeEach(() => {
        // TODO(crbug/1280141): Remove complicated stubbing code once `parseSourcePositionsFromErrorStack`
        //                      no longer needs a RuntimeModel.
        runtimeModel = sinon.createStubInstance(SDK.RuntimeModel.RuntimeModel, {
            target: sinon.createStubInstance(SDK.Target.Target, {
                inspectedURL: 'http://www.example.org',
            }),
            debuggerModel: sinon.createStubInstance(SDK.DebuggerModel.DebuggerModel, {
                scriptsForSourceURL: [],
            }),
        });
        parseErrorStack = parseSourcePositionsFromErrorStack.bind(null, runtimeModel);
    });
    it('returns null for invalid strings', () => {
        assert.isNull(parseErrorStack(''));
        assert.isNull(parseErrorStack('foobar'));
    });
    it('returns null if the first word does not end in "Error"', () => {
        assert.isNull(parseErrorStack('CustomFoo: bar'));
    });
    it('accepts stacks with any "*Error" as its first word', () => {
        assert.isNotNull(parseErrorStack('Error: standard error'));
        assert.isNotNull(parseErrorStack('ReferenceError: unknown variable'));
        assert.isNotNull(parseErrorStack('CustomError: foobar'));
    });
    it('omits position information for frames it cannot parse', () => {
        const frames = parseErrorStack(`Error: standard error
        not a valid line
        at file:///testing.js:42:5`);
        assertNotNullOrUndefined(frames);
        assert.strictEqual(frames[1].line, '        not a valid line');
        assert.isUndefined(frames[1].link);
    });
    it('returns null when encountering an invalid frame after a valid one', () => {
        const frames = parseErrorStack(`Error: standard error
        at foo (file:///testing.js:20:3)
        not a valid line
        at file:///testing.js:42:5`);
        assert.isNull(frames);
    });
    it('returns null for invalid frame URLs', () => {
        const frames = parseErrorStack(`Error: standard error
        at foo (schemeWithColon::20:3)`);
        assert.isNull(frames);
    });
    it('omits position information for anonymous scripts', () => {
        const frames = parseErrorStack(`Error: standard error
        at foo (<anonymous>:10:3)`);
        assertNotNullOrUndefined(frames);
        assert.strictEqual(frames[1].line, '        at foo (<anonymous>:10:3)');
        assert.isUndefined(frames[1].link);
    });
    it('detects URLs with line and column information in braces', () => {
        const frames = parseErrorStack(`Error: standard error
        at foo (file:///testing.js:10:3)`);
        assertNotNullOrUndefined(frames);
        assert.deepStrictEqual(frames[1].link, {
            url: fileTestingUrl,
            prefix: '        at foo (',
            suffix: ')',
            lineNumber: 9,
            columnNumber: 2,
            enclosedInBraces: true,
        });
    });
    it('detects URLs without line or column information in braces', () => {
        const frames = parseErrorStack(`Error: standard error
        at foo (file:///testing.js)`);
        assertNotNullOrUndefined(frames);
        assert.deepStrictEqual(frames[1].link, {
            url: fileTestingUrl,
            prefix: '        at foo (',
            suffix: ')',
            lineNumber: undefined,
            columnNumber: undefined,
            enclosedInBraces: true,
        });
    });
    it('detects URLs with line and column information without braces', () => {
        const frames = parseErrorStack(`Error: standard error
        at file:///testing.js:42:3`);
        assertNotNullOrUndefined(frames);
        assert.deepStrictEqual(frames[1].link, {
            url: fileTestingUrl,
            prefix: '        at ',
            suffix: '',
            lineNumber: 41,
            columnNumber: 2,
            enclosedInBraces: false,
        });
    });
    it('detects URLs without braces with the "async" keyword present', () => {
        const frames = parseErrorStack(`Error: standard error
        at async file:///testing.js:42:3`);
        assertNotNullOrUndefined(frames);
        assert.deepStrictEqual(frames[1].link, {
            url: fileTestingUrl,
            prefix: '        at async ',
            suffix: '',
            lineNumber: 41,
            columnNumber: 2,
            enclosedInBraces: false,
        });
    });
    it('detects URLs with parens', () => {
        const url = 'http://localhost:5173/src/routes/(v2-routes)/project/+layout.ts?ts=12345';
        const frames = parseErrorStack(`ZodError:
        at load (${url}:33:5)
        at ${url}:1:1`);
        assertNotNullOrUndefined(frames);
        assert.lengthOf(frames, 3);
        assert.deepStrictEqual(frames[1].link, {
            url,
            prefix: '        at load (',
            suffix: ')',
            lineNumber: 32,
            columnNumber: 4,
            enclosedInBraces: true,
        });
        assert.deepStrictEqual(frames[2].link, {
            url,
            prefix: '        at ',
            suffix: '',
            lineNumber: 0,
            columnNumber: 0,
            enclosedInBraces: false,
        });
    });
    it('allows frames with parens in function names', () => {
        const frames = parseErrorStack(`Error Component Stack:
    at FlatList (http://example.com/a.js:6:3)
    at Animated(FlatList) (http://example.com/b.js:43:14)
    at RNTesterApp(RootComponent) (http://example.com/c.js:29:11)`);
        assertNotNullOrUndefined(frames);
        assert.lengthOf(frames, 4);
        assert.deepStrictEqual(frames[1].link, {
            url: 'http://example.com/a.js',
            prefix: '    at FlatList (',
            suffix: ')',
            lineNumber: 5,
            columnNumber: 2,
            enclosedInBraces: true,
        });
        assert.deepStrictEqual(frames[2].link, {
            url: 'http://example.com/b.js',
            prefix: '    at Animated(FlatList) (',
            suffix: ')',
            lineNumber: 42,
            columnNumber: 13,
            enclosedInBraces: true,
        });
        assert.deepStrictEqual(frames[3].link, {
            url: 'http://example.com/c.js',
            prefix: '    at RNTesterApp(RootComponent) (',
            suffix: ')',
            lineNumber: 28,
            columnNumber: 10,
            enclosedInBraces: true,
        });
    });
    it('correctly handles eval frames', () => {
        const url = 'http://www.chromium.org/foo.js';
        const frames = parseErrorStack(`Error: MyError
    at eval (eval at <anonymous> (${url}:42:1), <anonymous>:1:1)`);
        assertNotNullOrUndefined(frames);
        assert.lengthOf(frames, 2);
        assert.deepStrictEqual(frames[1].link, {
            url,
            prefix: '    at eval (eval at <anonymous> (',
            suffix: '), <anonymous>:1:1)',
            lineNumber: 41,
            columnNumber: 0,
            enclosedInBraces: true,
        });
    });
    it('uses the inspected target URL to complete relative URLs', () => {
        const frames = parseErrorStack(`Error: standard error
        at foo (testing.js:10:3)`);
        assertNotNullOrUndefined(frames);
        assert.strictEqual(frames[1].link?.url, 'http://www.example.org/testing.js');
    });
    it('uses the inspected target URL to complete relative URLs in eval frames', () => {
        const frames = parseErrorStack(`Error: localObj.func
    at Object.func (test.js:26:25)
    at eval (eval at testFunction (inspected-page.html:29:11), <anonymous>:1:10)`);
        assertNotNullOrUndefined(frames);
        assert.lengthOf(frames, 3);
        assert.deepStrictEqual(frames[2].link, {
            url: 'http://www.example.org/inspected-page.html',
            prefix: '    at eval (eval at testFunction (',
            suffix: '), <anonymous>:1:10)',
            lineNumber: 28,
            columnNumber: 10,
            enclosedInBraces: true,
        });
    });
    it('uses the inspected target URL to complete relative URLs with parens', () => {
        const frames = parseErrorStack(`Error: wat
        at foo (/(abc)/foo.js:2:3)
        at async bar (/(abc)/foo.js:1:2)
        at /(abc)/foo.js:10:20`);
        assertNotNullOrUndefined(frames);
        assert.lengthOf(frames, 4);
        assert.deepStrictEqual(frames[1].link, {
            url: 'http://www.example.org/(abc)/foo.js',
            prefix: '        at foo (',
            suffix: ')',
            lineNumber: 1,
            columnNumber: 2,
            enclosedInBraces: true,
        });
        assert.deepStrictEqual(frames[2].link, {
            url: 'http://www.example.org/(abc)/foo.js',
            prefix: '        at async bar (',
            suffix: ')',
            lineNumber: 0,
            columnNumber: 1,
            enclosedInBraces: true,
        });
        assert.deepStrictEqual(frames[3].link, {
            url: 'http://www.example.org/(abc)/foo.js',
            prefix: '        at ',
            suffix: '',
            lineNumber: 9,
            columnNumber: 19,
            enclosedInBraces: false,
        });
    });
    describe('augmentErrorStackWithScriptIds', () => {
        const sid = (id) => id;
        it('sets the scriptId for matching frames', () => {
            const parsedFrames = parseErrorStack(`Error: some error
          at foo (http://example.com/a.js:6:3)
          at bar (http://example.com/b.js:43:14)`);
            assertNotNullOrUndefined(parsedFrames);
            const protocolFrames = [
                {
                    url: 'http://example.com/a.js',
                    scriptId: sid('25'),
                    lineNumber: 5,
                    columnNumber: 2,
                    functionName: 'foo',
                },
                {
                    url: 'http://example.com/b.js',
                    scriptId: sid('30'),
                    lineNumber: 42,
                    columnNumber: 13,
                    functionName: 'bar',
                },
            ];
            Console.ErrorStackParser.augmentErrorStackWithScriptIds(parsedFrames, { callFrames: protocolFrames });
            assert.strictEqual(parsedFrames[1].link?.scriptId, sid('25'));
            assert.strictEqual(parsedFrames[2].link?.scriptId, sid('30'));
        });
        it('omits the scriptId for non-matching frames', () => {
            const parsedFrames = parseErrorStack(`Error: some error
        at http://example.com/a.js:6:3`);
            assertNotNullOrUndefined(parsedFrames);
            const protocolFrames = [{
                    url: 'http://example.com/a.js',
                    scriptId: sid('25'),
                    lineNumber: 10,
                    columnNumber: 4,
                    functionName: 'foo',
                }];
            Console.ErrorStackParser.augmentErrorStackWithScriptIds(parsedFrames, { callFrames: protocolFrames });
            assertNotNullOrUndefined(parsedFrames[1].link);
            assert.isUndefined(parsedFrames[1].link.scriptId);
        });
        it('handles different number or frames', () => {
            const parsedFrames = parseErrorStack(`Error: some error
        at foo (http://example.com/a.js:6:3)
        at Array.forEach (<anonymous>)
        at bar (http://example.com/b.js:43:14)`);
            assertNotNullOrUndefined(parsedFrames);
            const protocolFrames = [
                {
                    url: 'http://example.com/a.js',
                    scriptId: sid('25'),
                    lineNumber: 5,
                    columnNumber: 2,
                    functionName: 'foo',
                },
                {
                    url: 'http://example.com/b.js',
                    scriptId: sid('30'),
                    lineNumber: 42,
                    columnNumber: 13,
                    functionName: 'bar',
                },
            ];
            Console.ErrorStackParser.augmentErrorStackWithScriptIds(parsedFrames, { callFrames: protocolFrames });
            assert.strictEqual(parsedFrames[1].link?.scriptId, sid('25'));
            assert.isUndefined(parsedFrames[2].link);
            assert.strictEqual(parsedFrames[3].link?.scriptId, sid('30'));
        });
    });
});
//# sourceMappingURL=ErrorStackParser.test.js.map