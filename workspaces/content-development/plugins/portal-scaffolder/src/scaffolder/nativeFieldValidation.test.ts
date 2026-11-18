import {
  validateEEFileName,
  validateEETags,
  validateScmSelector,
} from './nativeFieldValidation';

describe('native picker validation', () => {
  it('preserves optional and empty execution environment names', () => {
    expect(validateEEFileName(undefined)).toEqual([]);
    expect(validateEEFileName('')).toEqual([]);
    expect(validateEEFileName('valid-ee')).toEqual([]);
    expect(validateEEFileName('invalid/name')).not.toEqual([]);
  });

  it('validates non-empty tags while allowing empty optional values', () => {
    expect(validateEETags(undefined)).toEqual([]);
    expect(validateEETags([])).toEqual([]);
    expect(validateEETags(['execution-environment', 'valid+tag'])).toEqual([]);
    expect(validateEETags(['Invalid Tag'])).toHaveLength(1);
  });

  it('requires the repository only after the credential flow exposes a namespace', () => {
    expect(validateScmSelector(undefined, false)).toEqual([]);
    expect(validateScmSelector(undefined, true)).toEqual([]);
    expect(
      validateScmSelector(
        {
          provider: 'github',
          providerLabel: 'GitHub',
          org: '',
          repoName: '',
          repoExists: false,
        },
        true,
      ),
    ).toEqual([]);
    expect(
      validateScmSelector(
        {
          provider: 'github',
          providerLabel: 'GitHub',
          org: 'org',
          repoName: '',
          repoExists: false,
        },
        true,
      ),
    ).toEqual(['Enter a repository name.']);
    expect(
      validateScmSelector(
        {
          provider: 'github',
          providerLabel: 'GitHub',
          org: 'org',
          repoName: 'repo',
          repoExists: false,
        },
        true,
      ),
    ).toEqual([]);
  });
});
