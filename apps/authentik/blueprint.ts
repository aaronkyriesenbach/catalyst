import {
  Scalar,
  stringify,
  YAMLSeq,
  type CollectionTag,
  type ScalarTag,
} from "yaml";
import { authentikUrl } from "../../auth";
import type { OidcDeclaration } from "../../types";
import type { DeclaredUser } from "./users.config";

export type OidcApp = {
  name: string;
  url: string;
  oidc: OidcDeclaration;
};

export const APPS_BLUEPRINT_NAME = "catalyst-apps";

class KeyOf {
  constructor(readonly id: string) {}
}

class Find {
  constructor(
    readonly model: string,
    readonly field: string,
    readonly value: string,
  ) {}
}

const keyOfTag: ScalarTag = {
  tag: "!KeyOf",
  identify: (value: unknown) => value instanceof KeyOf,
  resolve: (str: string) => str,
  createNode: (_schema, value) => {
    const node = new Scalar((value as KeyOf).id);
    node.tag = "!KeyOf";
    return node;
  },
  stringify: (item) => String(item.value),
};

const findTag: CollectionTag = {
  tag: "!Find",
  collection: "seq",
  nodeClass: YAMLSeq,
  identify: (value: unknown) => value instanceof Find,
  resolve: (seq) => seq,
  createNode: (schema, value, ctx) => {
    const { model, field, value: match } = value as Find;
    const seq = YAMLSeq.from(schema, [model, [field, match]], ctx);
    seq.tag = "!Find";
    seq.flow = true;

    for (const item of seq.items) {
      if (item instanceof YAMLSeq) {
        item.flow = true;
      }
    }

    return seq;
  },
};

const stringifyOptions = {
  customTags: [findTag, keyOfTag],
  lineWidth: 0,
  aliasDuplicateObjects: false,
};

type Entry = {
  model: string;
  id?: string;
  identifiers?: Record<string, unknown>;
  attrs: Record<string, unknown>;
};

const groupId = (app: string) => `group-${app}`;
const providerId = (app: string) => `provider-${app}`;
const applicationId = (app: string) => `app-${app}`;

const implicitConsentFlow = () =>
  new Find(
    "authentik_flows.flow",
    "slug",
    "default-provider-authorization-implicit-consent",
  );
const invalidationFlow = () =>
  new Find(
    "authentik_flows.flow",
    "slug",
    "default-provider-invalidation-flow",
  );
const adminsGroup = () =>
  new Find("authentik_core.group", "name", "authentik Admins");

function scopeMapping(scope: "openid" | "email" | "profile"): Find {
  return new Find(
    "authentik_providers_oauth2.scopemapping",
    "managed",
    `goauthentik.io/providers/oauth2/scope-${scope}`,
  );
}

// Blueprints are applied in no fixed order on first boot, so each one first waits for the
// built-in blueprints that create what it looks up.
function requiredBlueprint(name: string): Entry {
  return {
    model: "authentik_blueprints.metaapplyblueprint",
    attrs: { identifiers: { name }, required: true },
  };
}

function providerEntry(app: OidcApp): Entry {
  const { name, url, oidc } = app;
  const common = {
    authorization_flow: implicitConsentFlow(),
    invalidation_flow: invalidationFlow(),
  };

  if (oidc.kind === "proxy") {
    return {
      model: "authentik_providers_proxy.proxyprovider",
      id: providerId(name),
      identifiers: { name },
      attrs: {
        ...common,
        mode: "forward_single",
        external_host: url,
        ...(oidc.skipPathRegex && {
          skip_path_regex: oidc.skipPathRegex.join("\n"),
        }),
      },
    };
  }

  // client_secret is set by the per-app secret blueprint, so authentik generates a throwaway
  // one only until that applies.
  return {
    model: "authentik_providers_oauth2.oauth2provider",
    id: providerId(name),
    identifiers: { name },
    attrs: {
      ...common,
      client_type: "confidential",
      client_id: name,
      redirect_uris: oidc.redirectPaths.map((path) => ({
        matching_mode: "strict",
        url: `${url}${path}`,
      })),
      issuer_mode: "per_provider",
      signing_key: new Find(
        "authentik_crypto.certificatekeypair",
        "name",
        "authentik Self-signed Certificate",
      ),
      property_mappings: [
        scopeMapping("openid"),
        scopeMapping("email"),
        scopeMapping("profile"),
      ],
    },
  };
}

function appEntries(app: OidcApp): Entry[] {
  const { name, url } = app;

  return [
    {
      model: "authentik_core.group",
      id: groupId(name),
      identifiers: { name },
      attrs: {},
    },
    providerEntry(app),
    {
      model: "authentik_core.application",
      id: applicationId(name),
      identifiers: { slug: name },
      attrs: {
        name,
        provider: new KeyOf(providerId(name)),
        meta_launch_url: url,
      },
    },
    {
      model: "authentik_policies.policybinding",
      identifiers: { target: new KeyOf(applicationId(name)), order: 0 },
      attrs: { group: new KeyOf(groupId(name)), enabled: true, negate: false },
    },
  ];
}

// `providers` is a full set, so every proxy provider has to be listed in this one entry.
function outpostEntry(apps: readonly OidcApp[]): Entry {
  return {
    model: "authentik_outposts.outpost",
    identifiers: { managed: "goauthentik.io/outposts/embedded" },
    attrs: {
      name: "authentik Embedded Outpost",
      type: "proxy",
      providers: apps
        .filter((app) => app.oidc.kind === "proxy")
        .map((app) => new KeyOf(providerId(app.name))),
      config: { authentik_host: authentikUrl },
    },
  };
}

// `groups` is a full set too: memberships added to a declared user in the UI are reverted.
function userEntry(user: DeclaredUser, apps: readonly OidcApp[]): Entry {
  const known = new Set(apps.map((app) => app.name));
  const unknown = user.apps.filter((app) => !known.has(app));

  if (unknown.length > 0) {
    throw new Error(
      `User '${user.username}' lists apps without an oidc declaration: ${unknown.join(", ")}`,
    );
  }

  return {
    model: "authentik_core.user",
    identifiers: { username: user.username },
    attrs: {
      name: user.name,
      email: user.email,
      is_active: true,
      groups: [
        ...user.apps.map((app) => new KeyOf(groupId(app))),
        ...(user.admin ? [adminsGroup()] : []),
      ],
    },
  };
}

function renderBlueprint(name: string, entries: readonly Entry[]): string {
  return stringify(
    { version: 1, metadata: { name }, entries },
    stringifyOptions,
  );
}

export function buildAppsBlueprint(
  apps: readonly OidcApp[],
  users: readonly DeclaredUser[],
): string {
  const needsScopes = apps.some((app) => app.oidc.kind === "oauth2");

  return renderBlueprint(APPS_BLUEPRINT_NAME, [
    requiredBlueprint(
      "Default - Provider authorization flow (implicit consent)",
    ),
    requiredBlueprint("Default - Provider invalidation flow"),
    requiredBlueprint("authentik Bootstrap"),
    ...(needsScopes
      ? [requiredBlueprint("System - OAuth2 Provider - Scopes")]
      : []),
    ...apps.flatMap(appEntries),
    outpostEntry(apps),
    ...users.map((user) => userEntry(user, apps)),
  ]);
}

export const CLIENT_SECRET_PLACEHOLDER = "{{ .client_secret }}";

// Rendered by ESO (not here) so the secret is part of the file: authentik only re-applies a
// blueprint when the file itself changes, and a `!File` read would never trigger that.
export function buildClientSecretBlueprint(appName: string): string {
  return renderBlueprint(`${APPS_BLUEPRINT_NAME}-${appName}-secret`, [
    requiredBlueprint(APPS_BLUEPRINT_NAME),
    {
      model: "authentik_providers_oauth2.oauth2provider",
      identifiers: { name: appName },
      attrs: { client_secret: CLIENT_SECRET_PLACEHOLDER },
    },
  ]);
}
