import { getPackageRoot } from '@granite-js/utils';
import { cosmiconfig } from 'cosmiconfig';
import { TypeScriptLoader } from 'cosmiconfig-typescript-loader';
import type { GraniteConfigResponse } from '../index';

const MODULE_NAME = 'granite';

export const loadConfig = async (): Promise<GraniteConfigResponse> => {
  const explorer = cosmiconfig(MODULE_NAME, {
    searchPlaces: [
      `${MODULE_NAME}.config.ts`,
      `${MODULE_NAME}.config.mts`,
      `${MODULE_NAME}.config.js`,
      `${MODULE_NAME}.config.cjs`,
    ],
    loaders: {
      '.ts': TypeScriptLoader(),
      '.mts': TypeScriptLoader(),
    },
  });

  const result = await explorer.search(getPackageRoot());

  const config = await result?.config;
  return config;
};
