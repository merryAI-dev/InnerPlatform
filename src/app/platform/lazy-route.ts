import type { ComponentType } from 'react';

type LazyRouteModule = Record<string, unknown> & {
  default?: ComponentType;
};

export async function loadLazyRouteModule<TModule extends LazyRouteModule>(
  loader: () => Promise<TModule>,
  exportName: keyof TModule | string,
  fallback: ComponentType,
  errorPrefix?: string,
): Promise<{ default: ComponentType }> {
  try {
    const module = await loader();
    const resolved = module?.[exportName as keyof TModule] || module?.default;
    return { default: (resolved as ComponentType) || fallback };
  } catch (error) {
    if (errorPrefix) {
      console.error(errorPrefix, error);
    }
    return { default: fallback };
  }
}
