export type UpstreamProvenance = {
  logicalModel: string;
  servedModel: string;
  servedModelSource: "metaengine" | "response" | "logical_fallback";
  tariffDependency: boolean;
  zeroSpendVerified: boolean | null;
  dataPolicy: string | null;
  confidentialDataSupported: boolean | null;
};

type JsonObject = Record<string, unknown>;

function asOptionalObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function configuredTariffDependency(
  customEndpointConfigured: boolean,
  rawOverride: string | undefined,
  name: string,
): boolean {
  if (rawOverride === undefined) return customEndpointConfigured;
  const normalized = rawOverride.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${name}_invalid_boolean`);
}

export function mergeUpstreamProvenance(
  body: JsonObject,
  logicalModel: string,
  configuredDependency: boolean,
): UpstreamProvenance {
  const meta = asOptionalObject(body.metaengine);
  const metaServed = optionalString(meta?.upstream_served_model);
  const responseServed = optionalString(body.model);
  const servedModel = metaServed || responseServed || logicalModel;
  const servedModelSource: UpstreamProvenance["servedModelSource"] = metaServed
    ? "metaengine"
    : responseServed
      ? "response"
      : "logical_fallback";

  const upstreamDependency = meta?.tariff_dependency === true;
  const zeroSpendVerified = typeof meta?.zero_spend_verified === "boolean"
    ? meta.zero_spend_verified
    : null;
  const confidentialDataSupported = typeof meta?.confidential_data_supported === "boolean"
    ? meta.confidential_data_supported
    : null;

  return {
    logicalModel,
    servedModel,
    servedModelSource,
    // Dependency is sticky: response metadata may raise it, never lower a
    // dependency already established by runner configuration.
    tariffDependency: configuredDependency || upstreamDependency,
    zeroSpendVerified,
    dataPolicy: optionalString(meta?.data_policy),
    confidentialDataSupported,
  };
}
