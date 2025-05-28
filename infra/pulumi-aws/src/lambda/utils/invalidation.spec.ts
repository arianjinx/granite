import { describe, it, expect, vi } from 'vitest';
import { getPathsToInvalidate } from './invalidation';

vi.mock('@aws-sdk/client-cloudfront', () => {
  return {
    CloudFrontClient: vi.fn(() => ({
      send: vi.fn(),
    })),
    CreateInvalidationCommand: vi.fn(),
  };
});

describe('invalidation', () => {
  describe('getPathsToInvalidate', () => {
    it('returns invalidation paths for deployment_state file', () => {
      const paths = getPathsToInvalidate('deployments/my-app/deployment_state');
      expect(paths).toEqual(['/ios/my-app/*', '/android/my-app/*']);
    });

    it('returns invalidation paths for CURRENT file', () => {
      const paths = getPathsToInvalidate('deployments/my-app/CURRENT');
      expect(paths).toEqual(['/ios/my-app/*', '/android/my-app/*']);
    });

    it('returns invalidation paths for cluster deploymentInfo file', () => {
      const paths = getPathsToInvalidate('deployments/my-app/clusters/cluster-123.deploymentInfo');
      expect(paths).toEqual(['/ios/my-app/cluster-123/*', '/android/my-app/cluster-123/*']);
    });

    it('returns empty array for invalid paths', () => {
      expect(getPathsToInvalidate('wrong-path')).toEqual([]);
      expect(getPathsToInvalidate('deployments/my-app/wrong-file')).toEqual([]);
    });
  });
});
