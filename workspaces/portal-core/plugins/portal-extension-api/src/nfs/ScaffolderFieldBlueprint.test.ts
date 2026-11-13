import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { ConfigReader } from '@backstage/config';
import { configApiRef } from '@backstage/core-plugin-api';
import { TestApiProvider } from '@backstage/test-utils';
import {
  AuthorizeResult,
  createPermission,
} from '@backstage/plugin-permission-common';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import type { FieldExtensionOptions } from '@backstage/plugin-scaffolder-react';
import { CONTENT_TYPES } from '@ansible/portal-extension-common';
import {
  convertLegacyFieldSchema,
  createNativeScaffolderField,
  createPortalScaffolderFieldBlueprints,
  defineScaffolderField,
  type ScaffolderFieldDescriptor,
} from './ScaffolderFieldBlueprint';

const descriptor = {
  manifest: {
    id: 'contributor',
    version: '1.0.0',
    apiVersion: '0.1.0',
    entitlements: [],
    capabilities: [
      {
        id: 'contributor.authoring',
        ownerPlugin: 'contributor',
        displayName: 'Authoring',
        description: 'Authoring',
        minimumHostApiVersion: '0.1.0',
        appliesToContentTypes: [CONTENT_TYPES.PLAYBOOK_REPOSITORY],
        entryPoints: [
          {
            id: 'contributor.repo-field',
            kind: 'scaffolder-field',
            surface: 'experience-slot',
            appliesToContentTypes: [CONTENT_TYPES.PLAYBOOK_REPOSITORY],
            label: 'Repository',
            launches: { type: 'slot', targetSlot: 'scaffolder.fields' },
          },
        ],
      },
    ],
  },
  capabilityId: 'contributor.authoring',
  entryPointId: 'contributor.repo-field',
  attachment: 'scaffolder.fields' as const,
  fieldName: 'RepositoryInput',
  loader: async (): Promise<FieldExtensionOptions> => ({
    name: 'RepositoryInput',
    component: () => null,
    schema: {
      returnValue: {
        type: 'string',
        default: 'https://git.example.org/repo',
      },
    },
  }),
} satisfies ScaffolderFieldDescriptor;

const requiredPermission = createPermission({
  name: 'scaffolder.fields.repository.read',
  attributes: { action: 'read' },
});

type NativeFieldForTest = Pick<
  FieldExtensionOptions,
  'component' | 'validation' | 'schema'
>;

function createNativeFieldForTest(
  params: any,
  field: FieldExtensionOptions,
): NativeFieldForTest {
  // Backstage's public FormField type hides the runtime field options returned here.
  return createNativeScaffolderField(
    params,
    field,
  ) as unknown as NativeFieldForTest;
}

function makeParams(
  options: {
    enabledByConfig?: string;
    requiredPermission?: unknown;
    capabilityId?: string;
    entryPointId?: string;
  } = {},
): any {
  const { requiredPermission: permission, ...params } = options;
  return {
    ...descriptor,
    ...params,
    manifest: {
      ...descriptor.manifest,
      capabilities: descriptor.manifest.capabilities.map(capability => ({
        ...capability,
        entryPoints: capability.entryPoints.map(entry => ({
          ...entry,
          ...(permission === undefined
            ? {}
            : { requiredPermission: permission }),
        })),
      })),
    },
  };
}

function makeNativeField(options: Parameters<typeof makeParams>[0] = {}) {
  const validation = jest.fn();
  const field: FieldExtensionOptions = {
    name: descriptor.fieldName,
    component: () => createElement('div', null, 'native repository field'),
    validation,
  };
  const nativeField = createNativeFieldForTest(makeParams(options), field);
  return { nativeField, validation };
}

function apiHolder(apis: Map<string, unknown>) {
  return {
    get: jest.fn((apiRef: { id: string }) => apis.get(apiRef.id)),
  } as any;
}

async function runValidation(nativeField: NativeFieldForTest, holder: unknown) {
  const addError = jest.fn();
  await nativeField.validation?.(
    'https://git.example.org/repo',
    { addError } as any,
    { apiHolder: holder } as any,
  );
  return addError;
}

describe('createPortalScaffolderFieldBlueprints', () => {
  it('pairs the Portal contribution with a native Scaffolder field registration', () => {
    const [portalField, nativeField] = createPortalScaffolderFieldBlueprints(
      'repository-input',
      descriptor,
    );

    expect(portalField.$$type).toBe('@backstage/ExtensionDefinition');
    expect(nativeField.$$type).toBe('@backstage/ExtensionDefinition');
    expect(nativeField).not.toBe(portalField);
  });

  it('preserves legacy value and UI schemas when building native fields', () => {
    const schema = {
      returnValue: { type: 'string', default: 'https://git.example.org/repo' },
      uiOptions: {
        type: 'object',
        properties: { helperText: { type: 'string' } },
      },
    };

    expect(convertLegacyFieldSchema(schema).schema).toEqual(schema);
  });

  it('rejects malformed legacy schemas instead of silently omitting constraints', () => {
    expect(() => convertLegacyFieldSchema(null)).toThrow(
      'Invalid legacy field schema',
    );
    expect(() => convertLegacyFieldSchema({})).toThrow(
      'Invalid legacy field schema',
    );
    expect(() =>
      convertLegacyFieldSchema({ returnValue: [], uiOptions: {} }),
    ).toThrow('Invalid legacy field schema');
    expect(() =>
      convertLegacyFieldSchema({ returnValue: {}, uiOptions: 'invalid' }),
    ).toThrow('Invalid legacy field schema');
  });

  it('defines a loader that preserves the contributor field options', async () => {
    const field = await defineScaffolderField(descriptor).loader();
    expect(field.name).toBe(descriptor.fieldName);
    expect(field.component).toEqual(expect.any(Function));
    expect(field.schema?.returnValue).toEqual({
      type: 'string',
      default: 'https://git.example.org/repo',
    });
  });

  it('rejects a loaded field with a different name', () => {
    expect(() =>
      createNativeScaffolderField(makeParams(), {
        name: 'DifferentField',
        component: () => null,
      }),
    ).toThrow(
      'Scaffolder field RepositoryInput loaded with name DifferentField',
    );
  });

  it('rejects a descriptor whose capability or entry point is missing', () => {
    expect(() =>
      createNativeScaffolderField(makeParams({ capabilityId: 'missing' }), {
        name: descriptor.fieldName,
        component: () => null,
      }),
    ).toThrow('Missing scaffolder field entry contributor.repo-field');
    expect(() =>
      createNativeScaffolderField(makeParams({ entryPointId: 'missing' }), {
        name: descriptor.fieldName,
        component: () => null,
      }),
    ).toThrow('Missing scaffolder field entry missing');
  });

  it('keeps the original component and validator when no gate is configured', () => {
    const originalComponent = () => null;
    const originalValidation = jest.fn();
    const nativeField = createNativeFieldForTest(makeParams(), {
      name: descriptor.fieldName,
      component: originalComponent,
      validation: originalValidation,
    });

    expect(nativeField.component).toBe(originalComponent);
    expect(nativeField.validation).toBe(originalValidation);
    expect(nativeField.schema).toBeUndefined();
  });

  it('preserves the converted schema on a native field', () => {
    const nativeField = createNativeFieldForTest(makeParams(), {
      name: descriptor.fieldName,
      component: () => null,
      schema: {
        returnValue: { type: 'string' },
      },
    });

    expect(nativeField.schema).toBeDefined();
  });

  it('delegates validation when the configuration gate is enabled', async () => {
    const { nativeField, validation } = makeNativeField({
      enabledByConfig: 'plugins.contributor.enabled',
    });
    const config = new ConfigReader({
      plugins: { contributor: { enabled: true } },
    });
    const holder = apiHolder(new Map([[configApiRef.id, config]]));

    const addError = await runValidation(nativeField, holder);

    expect(addError).not.toHaveBeenCalled();
    expect(validation).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'false',
      new ConfigReader({ plugins: { contributor: { enabled: false } } }),
    ],
    ['missing', new ConfigReader({})],
  ])('blocks validation when configuration is %s', async (_label, config) => {
    const { nativeField, validation } = makeNativeField({
      enabledByConfig: 'plugins.contributor.enabled',
    });
    const holder = apiHolder(new Map([[configApiRef.id, config]]));

    const addError = await runValidation(nativeField, holder);

    expect(addError).toHaveBeenCalledWith(
      'Field RepositoryInput is unavailable due to configuration or permissions.',
    );
    expect(validation).not.toHaveBeenCalled();
  });

  it('fails closed when reading configuration throws', async () => {
    const { nativeField, validation } = makeNativeField({
      enabledByConfig: 'plugins.contributor.enabled',
    });
    const holder = {
      get: () => {
        throw new Error('configuration unavailable');
      },
    };

    const addError = await runValidation(nativeField, holder);

    expect(addError).toHaveBeenCalled();
    expect(validation).not.toHaveBeenCalled();
  });

  it.each([
    ['allowed', AuthorizeResult.ALLOW, true],
    ['denied', AuthorizeResult.DENY, false],
  ])('honors a %s permission decision', async (_label, result, allowed) => {
    const { nativeField, validation } = makeNativeField({
      requiredPermission,
    });
    const authorize = jest.fn().mockResolvedValue({ result });
    const holder = apiHolder(new Map([[permissionApiRef.id, { authorize }]]));

    const addError = await runValidation(nativeField, holder);

    expect(addError).toHaveBeenCalledTimes(allowed ? 0 : 1);
    expect(validation).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(authorize).toHaveBeenCalledWith({ permission: requiredPermission });
  });

  it('fails closed when the permission API is unavailable or throws', async () => {
    const { nativeField, validation } = makeNativeField({
      requiredPermission,
    });
    const addErrorWithoutApi = await runValidation(
      nativeField,
      apiHolder(new Map()),
    );
    const throwingHolder = apiHolder(
      new Map([
        [
          permissionApiRef.id,
          { authorize: jest.fn().mockRejectedValue(new Error('denied')) },
        ],
      ]),
    );
    const addErrorWithThrow = await runValidation(nativeField, throwingHolder);

    expect(addErrorWithoutApi).toHaveBeenCalled();
    expect(addErrorWithThrow).toHaveBeenCalled();
    expect(validation).not.toHaveBeenCalled();
  });

  it('renders gated fields only after eligibility resolves', async () => {
    const { nativeField } = makeNativeField({
      enabledByConfig: 'plugins.contributor.enabled',
    });
    const config = new ConfigReader({
      plugins: { contributor: { enabled: true } },
    });
    const component = nativeField.component!;

    render(
      createElement(TestApiProvider, {
        apis: [[configApiRef, config]],
        children: createElement(component as any),
      }),
    );

    expect(
      await screen.findByText('native repository field'),
    ).toBeInTheDocument();
  });

  it('renders an unavailable alert when a gated field is ineligible', async () => {
    const { nativeField } = makeNativeField({
      enabledByConfig: 'plugins.contributor.enabled',
    });
    const config = new ConfigReader({
      plugins: { contributor: { enabled: false } },
    });

    render(
      createElement(TestApiProvider, {
        apis: [[configApiRef, config]],
        children: createElement(nativeField.component as any),
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Field RepositoryInput is unavailable due to configuration or permissions.',
    );
  });
});
