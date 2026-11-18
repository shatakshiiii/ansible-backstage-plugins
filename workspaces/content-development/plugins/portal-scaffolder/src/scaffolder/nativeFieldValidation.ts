import {
  isValidEntityName,
  isValidTag,
  type ScmSelectorData,
} from '@ansible/portal-scaffolder-react';

export function validateEEFileName(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  const result = isValidEntityName(value);
  return result.valid ? [] : [result.error ?? 'Invalid name'];
}

export function validateEETags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tag, index) => {
    if (typeof tag !== 'string' || tag.trim() === '') return [];
    const result = isValidTag(tag);
    return result.valid
      ? []
      : [`Tag ${index + 1}: ${result.error ?? 'Invalid tag'}`];
  });
}

/** Credentials stay in Scaffolder secrets; validation only inspects public selections. */
export function validateScmSelector(
  value: ScmSelectorData | undefined,
  credentialsRequested: boolean,
): string[] {
  if (!credentialsRequested) return [];
  // In the Portal widget, the namespace/repository inputs are only available
  // after OAuth succeeds and a namespace is selected. A missing namespace
  // alone therefore cannot be treated as a validation error here.
  if (value?.org?.trim() && !value.repoName?.trim()) {
    return ['Enter a repository name.'];
  }
  return [];
}
