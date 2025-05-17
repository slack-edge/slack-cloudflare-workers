import { KVNamespace, KVNamespaceListResult } from "@cloudflare/workers-types";
import {
  Authorize,
  AuthorizeError,
  AuthTestResponse,
  ConfigError,
  Installation,
  InstallationStore,
  InstallationStoreQuery,
  SlackAPIClient,
  SlackOAuthEnv,
  TokenRotator,
} from "slack-edge";
import {
  fromSerializableSlackAPIResponse,
  SerializableSlackAPIResponse,
  toSerializableSlackAPIResponse,
} from "./serializable-slack-api-response";

/**
 * Options for initializing a KV Installation Store instance
 */
export interface KVInstallationStoreOptions {
  /**
   * When this is set to true, calls to the `auth.test` Slack API method will use the authTestCacheStorage as a cache.
   * The authTestCacheStorage must be provided when this is set to true.
   * The default is set to false.
   */
  authTestCacheEnabled?: boolean;

  /**
   * When `authTestCacheEnabled` is set to true, this is the TTL expiration time in seconds for each cache entry.
   * 0 or negative value indicates the cache is permanent. The default is 10 minutes.
   * @see https://developers.cloudflare.com/kv/api/write-key-value-pairs/#expiring-keys
   */
  authTestCacheExpirationSecs?: number;

  /**
   * The KVNamespace to use for caching `auth.test` responses.
   * This must be provided when `authTestCacheEnabled` is set to true.
   */
  authTestCacheStorage?: KVNamespace;
}

export class KVInstallationStore<E extends SlackOAuthEnv> implements InstallationStore<E> {
  #env: E;
  #storage: KVNamespace;
  #tokenRotator: TokenRotator;

  /**
   * Whether to enable caching of `auth.test` responses.
   */
  #authTestCacheEnabled: boolean;

  /**
   * The TTL expiration time in seconds for each cache entry.
   * 0 or negative value indicates the cache is permanent. The default is 10 minutes.
   * @see https://developers.cloudflare.com/kv/api/write-key-value-pairs/#expiring-keys
   */
  #authTestCacheExpirationSecs: number;

  /**
   * The KVNamespace to use for caching `auth.test` responses.
   */
  #authTestCacheNamespace: KVNamespace | undefined;

  constructor(env: E, namespace: KVNamespace, options: KVInstallationStoreOptions = {}) {
    this.#env = env;
    this.#storage = namespace;
    this.#tokenRotator = new TokenRotator({
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
    });

    if (options.authTestCacheEnabled && !options.authTestCacheStorage) {
      throw new ConfigError("authTestCacheStorage must be provided when authTestCacheEnabled is true");
    }
    this.#authTestCacheEnabled = options.authTestCacheEnabled ?? false;
    this.#authTestCacheNamespace = options.authTestCacheStorage;
    this.#authTestCacheExpirationSecs = options.authTestCacheExpirationSecs ?? 10 * 60;
  }

  async save(installation: Installation, request: Request | undefined = undefined) {
    await this.#storage.put(toBotInstallationKey(this.#env.SLACK_CLIENT_ID, installation), JSON.stringify(installation));
    await this.#storage.put(toUserInstallationKey(this.#env.SLACK_CLIENT_ID, installation), JSON.stringify(installation));
  }

  async findBotInstallation(query: InstallationStoreQuery): Promise<Installation | undefined> {
    const storedString = await this.#storage.get(toBotInstallationQuery(this.#env.SLACK_CLIENT_ID, query));
    if (storedString) {
      return JSON.parse(storedString);
    }
    return undefined;
  }

  async findUserInstallation(query: InstallationStoreQuery): Promise<Installation | undefined> {
    const storedString = await this.#storage.get(toUserInstallationQuery(this.#env.SLACK_CLIENT_ID, query));
    if (storedString) {
      return JSON.parse(storedString);
    }
    return undefined;
  }

  async deleteBotInstallation(query: InstallationStoreQuery): Promise<void> {
    await this.#storage.delete(toBotInstallationQuery(this.#env.SLACK_CLIENT_ID, query));
  }
  async deleteUserInstallation(query: InstallationStoreQuery): Promise<void> {
    await this.#storage.delete(toUserInstallationQuery(this.#env.SLACK_CLIENT_ID, query));
  }
  async deleteAll(query: InstallationStoreQuery): Promise<void> {
    const clientId = this.#env.SLACK_CLIENT_ID;
    if (!query.enterpriseId && !query.teamId) {
      return; // for safety
    }
    const e = query.enterpriseId ? query.enterpriseId : "_";
    const prefix = query.teamId ? `${clientId}/${e}:${query.teamId}` : `${clientId}/${e}:`;
    var keys: string[] = [];
    const first = await this.#storage.list({ prefix });
    keys = keys.concat(first.keys.map((k) => k.name));
    if (!first.list_complete) {
      var cursor: string | undefined = first.cursor;
      while (cursor) {
        const response: KVNamespaceListResult<unknown, string> = await this.#storage.list({ prefix, cursor });
        keys = keys.concat(response.keys.map((k) => k.name));
        cursor = response.list_complete ? undefined : response.cursor;
      }
    }
    for (const key of keys) {
      await this.#storage.delete(key);
    }
  }

  toAuthorize(): Authorize<E> {
    return async (req) => {
      const query: InstallationStoreQuery = {
        isEnterpriseInstall: req.context.isEnterpriseInstall,
        enterpriseId: req.context.enterpriseId,
        teamId: req.context.teamId,
        userId: req.context.userId,
      };
      try {
        const bot = await this.findBotInstallation(query);
        if (bot && bot.bot_refresh_token) {
          const maybeRefreshed = await this.#tokenRotator.performRotation({
            bot: {
              access_token: bot.bot_token!,
              refresh_token: bot.bot_refresh_token!,
              token_expires_at: bot.bot_token_expires_at!,
            },
          });
          if (maybeRefreshed && maybeRefreshed.bot) {
            bot.bot_token = maybeRefreshed.bot.access_token;
            bot.bot_refresh_token = maybeRefreshed.bot.refresh_token;
            bot.bot_token_expires_at = maybeRefreshed.bot.token_expires_at;
            await this.save(bot);
          }
        }

        const botClient = new SlackAPIClient(bot?.bot_token, {
          logLevel: this.#env.SLACK_LOGGING_LEVEL,
        });
        const botAuthTest: AuthTestResponse = await this.callAuthTest(botClient, bot?.bot_token);
        const botScopes = botAuthTest.headers.get("x-oauth-scopes")?.split(",") ?? bot?.bot_scopes ?? [];

        const userQuery: InstallationStoreQuery = {};
        Object.assign(userQuery, query);
        if (this.#env.SLACK_USER_TOKEN_RESOLUTION !== "installer") {
          userQuery.enterpriseId = req.context.actorEnterpriseId;
          userQuery.teamId = req.context.actorTeamId;
          userQuery.userId = req.context.actorUserId;
        }
        const user = await this.findUserInstallation(query);
        if (user && user.user_refresh_token) {
          const maybeRefreshed = await this.#tokenRotator.performRotation({
            user: {
              access_token: user.user_token!,
              refresh_token: user.user_refresh_token!,
              token_expires_at: user.user_token_expires_at!,
            },
          });
          if (maybeRefreshed && maybeRefreshed.user) {
            user.user_token = maybeRefreshed.user.access_token;
            user.user_refresh_token = maybeRefreshed.user.refresh_token;
            user.user_token_expires_at = maybeRefreshed.user.token_expires_at;
            await this.save(user);
          }
        }
        let userAuthTest: AuthTestResponse | undefined = undefined;
        if (user) {
          userAuthTest = await this.callAuthTest(botClient, user.user_token);
        }

        return {
          enterpriseId: bot?.enterprise_id,
          teamId: bot?.team_id,
          team: botAuthTest.team,
          url: botAuthTest.url,

          botId: botAuthTest.bot_id!,
          botUserId: botAuthTest.user_id!,
          botToken: bot?.bot_token!,
          botScopes,

          userId: user ? user.user_id : undefined,
          user: userAuthTest?.user,
          userToken: user?.user_token,
          userScopes: user?.user_scopes,
        };
      } catch (e) {
        throw new AuthorizeError(`Failed to authorize (error: ${e}, query: ${JSON.stringify(query)})`);
      }
    };
  }

  /**
   * Calls the `auth.test` Slack API method, first checking the auth.test cache if enabled.
   * @param client - The Slack API client to use for the request.
   * @param token - The token to use for the request, and/or cache key.
   * @returns The response from the `auth.test` Slack API method.
   */
  private async callAuthTest(client: SlackAPIClient, token: string | undefined): Promise<AuthTestResponse> {
    if (token && this.#authTestCacheEnabled && this.#authTestCacheNamespace) {
      // Check the cache first
      const cachedResponse = await this.#authTestCacheNamespace.get(token);
      if (cachedResponse) {
        const serializableAuthTestResponse = JSON.parse(cachedResponse) as SerializableSlackAPIResponse<AuthTestResponse>;
        return fromSerializableSlackAPIResponse(serializableAuthTestResponse);
      }

      // If not cached, call the API and cache the result
      const authTestResponse = await client.auth.test();
      if (authTestResponse?.ok && !authTestResponse.error) {
        const serializableAuthTestResponse = toSerializableSlackAPIResponse(authTestResponse);
        const permanentCacheEnabled = this.#authTestCacheExpirationSecs <= 0;
        await this.#authTestCacheNamespace.put(token, JSON.stringify(serializableAuthTestResponse), {
          expirationTtl: permanentCacheEnabled ? undefined : this.#authTestCacheExpirationSecs,
        });
      }
      return authTestResponse;
    } else {
      return await client.auth.test();
    }
  }
}

export function toBotInstallationQuery(clientId: string, q: InstallationStoreQuery): string {
  const e = q.enterpriseId ? q.enterpriseId : "_";
  const t = q.teamId && !q.isEnterpriseInstall ? q.teamId : "_";
  return `${clientId}/${e}:${t}`;
}

export function toUserInstallationQuery(clientId: string, q: InstallationStoreQuery): string {
  const e = q.enterpriseId ? q.enterpriseId : "_";
  const t = q.teamId && !q.isEnterpriseInstall ? q.teamId : "_";
  const u = q.userId ? q.userId : "_";
  return `${clientId}/${e}:${t}:${u}`;
}

export function toBotInstallationKey(clientId: string, installation: Installation): string {
  const e = installation.enterprise_id ?? "_";
  const t = installation.team_id && !installation.is_enterprise_install ? installation.team_id : "_";
  return `${clientId}/${e}:${t}`;
}

export function toUserInstallationKey(clientId: string, installation: Installation): string {
  const e = installation.enterprise_id ?? "_";
  const t = installation.team_id && !installation.is_enterprise_install ? installation.team_id : "_";
  const u = installation.user_id ?? "_";
  return `${clientId}/${e}:${t}:${u}`;
}
