import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { ConfigReader } from '@backstage/config';
import { configApiRef } from '@backstage/core-plugin-api';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import {
  AuthorizeResult,
  createPermission,
} from '@backstage/plugin-permission-common';
import { rhAapAuthApiRef } from '@ansible/aap-app-auth';
import { scmAuthApiRef } from '@backstage/integration-react';
import {
  ScmSelectorExtension,
  type ScmSelectorData,
} from '@ansible/portal-scaffolder-react';
import type { FieldExtensionOptions } from '@backstage/plugin-scaffolder-react';
import { NativeScaffolderFields } from '@ansible/portal-extension-host/alpha';
import type { ScaffolderFieldDescriptor } from '@ansible/portal-extension-api/alpha';
import { CONTENT_TYPES } from '@ansible/portal-extension-api';
import { StepForm } from './StepForm';
import { validateScmSelector } from '../../scaffolder/nativeFieldValidation';

// Keep host widgets out of this test; exercise the real field loader, StepForm and RJSF.
jest.mock('./formExtraFields', () => ({ formExtraFields: [] }));

async function renderTemplate(
  gate: 'config' | 'permission' | 'loader',
  usesField = true,
) {
  const loader = jest.fn(async () => {
    throw new Error('Widget failed to load');
  });
  const submit = jest.fn().mockResolvedValue(undefined);
  const field: ScaffolderFieldDescriptor = {
    manifest: {
      id: 'test',
      version: '1.0.0',
      apiVersion: '0.1.0',
      entitlements: [],
      capabilities: [
        {
          id: 'test.fields',
          ownerPlugin: 'test',
          displayName: 'Fields',
          description: 'Fields',
          minimumHostApiVersion: '0.1.0',
          appliesToContentTypes: [CONTENT_TYPES.PLAYBOOK_REPOSITORY],
          entryPoints: [
            {
              id: 'test.repo',
              label: 'Repository',
              kind: 'scaffolder-field',
              surface: 'experience-slot',
              appliesToContentTypes: [CONTENT_TYPES.PLAYBOOK_REPOSITORY],
              launches: { type: 'slot', targetSlot: 'scaffolder.fields' },
              requiredPermission: createPermission({
                name: 'test.field.view',
                attributes: { action: 'read' },
              }),
            },
          ],
        },
      ],
    },
    capabilityId: 'test.fields',
    entryPointId: 'test.repo',
    attachment: 'scaffolder.fields',
    fieldName: 'RepositoryInput',
    enabledByConfig: 'test.fieldEnabled',
    loader,
  };
  await renderInTestApp(
    <TestApiProvider
      apis={[
        [
          configApiRef,
          new ConfigReader({ test: { fieldEnabled: gate !== 'config' } }),
        ],
        [
          permissionApiRef,
          {
            authorize: jest.fn().mockResolvedValue({
              result:
                gate === 'permission'
                  ? AuthorizeResult.DENY
                  : AuthorizeResult.ALLOW,
            }),
          },
        ],
        [
          rhAapAuthApiRef,
          { getAccessToken: jest.fn().mockResolvedValue('test-token') },
        ],
      ]}
    >
      <NativeScaffolderFields declarations={[field]}>
        {fields => (
          <StepForm
            nativeFields={fields}
            submitFunction={submit}
            steps={[
              {
                title: 'Details',
                schema: {
                  type: 'object',
                  properties: {
                    repo: {
                      type: 'string',
                      title: 'Repository',
                      default: 'example',
                      ...(usesField ? { 'ui:field': 'RepositoryInput' } : {}),
                    },
                  },
                },
              },
            ]}
          />
        )}
      </NativeScaffolderFields>
    </TestApiProvider>,
  );
  return { loader, submit };
}

it.each(['config', 'permission', 'loader'] as const)(
  'blocks the actual form when a referenced field fails its %s gate',
  async gate => {
    const { loader, submit } = await renderTemplate(gate);
    await screen.findByText(/Template fields are unavailable: RepositoryInput/);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Next' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create' }),
    ).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(loader).toHaveBeenCalledTimes(gate === 'loader' ? 1 : 0);
  },
);

it('still submits a template that does not reference the withheld field', async () => {
  const { submit } = await renderTemplate('permission', false);
  await screen.findByRole('textbox');
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      { repo: 'example' },
      expect.objectContaining({ aapToken: 'test-token' }),
    ),
  );
});

it('blocks Next for an authenticated source-control selection with no repository name', async () => {
  const submit = jest.fn().mockResolvedValue(undefined);
  const nativeScmField: FieldExtensionOptions<ScmSelectorData, any> = {
    name: 'ScmSelector',
    component: ScmSelectorExtension,
    validation: async (value, validation, context) => {
      const options = context.uiSchema?.['ui:options'] as
        | { requestUserCredentials?: unknown }
        | undefined;
      validateScmSelector(
        value,
        Boolean(options?.requestUserCredentials),
      ).forEach(error => validation.addError(error));
    },
  };

  await renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new ConfigReader({})],
        [permissionApiRef, { authorize: jest.fn() }],
        [rhAapAuthApiRef, { getAccessToken: jest.fn() }],
        [
          scmAuthApiRef,
          { getCredentials: jest.fn().mockResolvedValue({ token: 'secret' }) },
        ],
      ]}
    >
      <StepForm
        nativeFields={[nativeScmField]}
        submitFunction={submit}
        initialFormData={{
          sourceControl: {
            provider: 'github',
            providerLabel: 'GitHub',
            org: 'team',
            repoName: '',
          },
        }}
        steps={[
          {
            title: 'Repository',
            schema: {
              type: 'object',
              properties: {
                sourceControl: {
                  type: 'object',
                  title: 'Source Control Provider',
                  'ui:field': 'ScmSelector',
                  'ui:options': {
                    providers: [{ provider: 'github', label: 'GitHub' }],
                    requestUserCredentials: { secretsKey: 'USER_OAUTH_TOKEN' },
                  },
                },
              },
            },
          },
        ]}
      />
    </TestApiProvider>,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  expect(
    await screen.findByText('Please fill in this field.'),
  ).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});
