// metro@0.77.0 이전 버전에는 타입 정의 파일이 패키지에 포함되어있지 않아 임시로 타입 정의 파일을 추가합니다

declare module 'metro-core' {
  /**
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *
   * @format
   * @oncall react_native
   */

  import * as net from 'net';
  import * as stream from 'stream';

  export type UnderlyingStream = net.Socket | stream.Writable;

  export class Terminal {
    constructor(stream: UnderlyingStream);
    /**
     * Shows some text that is meant to be overriden later. Return the previous
     * status that was shown and is no more. Calling `status()` with no argument
     * removes the status altogether. The status is never shown in a
     * non-interactive terminal: for example, if the output is redirected to a
     * file, then we don't care too much about having a progress bar.
     */
    status(format: string, ...args: unknown[]): string;
    /**
     * Similar to `console.log`, except it moves the status/progress text out of
     * the way correctly. In non-interactive terminals this is the same as
     * `console.log`.
     */
    log(format: string, ...args: unknown[]): void;
    /**
     * Log the current status and start from scratch. This is useful if the last
     * status was the last one of a series of updates.
     */
    persistStatus(): void;
    flush(): void;
  }
}

declare module 'metro-react-native-babel-transformer' {
  const babelTransformer: {
    transform: ({
      filename,
      options,
      src,
      plugins,
    }: {
      filename: string;
      options: any;
      src: string;
      plugins: any[];
    }) => { ast: any; metadata?: ant };
    getCacheKey: () => string;
  };

  export default babelTransformer;
}
