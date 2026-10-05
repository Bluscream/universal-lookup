/**
 * Keep credentials out of anything the API hands back.
 *
 * This exists because of a real leak, not as a precaution. `@twurple/api`
 * reports a failed token request by quoting the request it made — and that
 * request is the OAuth token endpoint, so the message contained
 * `client_secret=<the actual secret>`. The provider caught the error, the
 * merger put its message in `errors`, and the service answered a public,
 * unauthenticated request with its own Twitch credentials in the JSON body.
 *
 * The lesson generalises past Twitch: an error message is composed by somebody
 * else's library, and no amount of care inside this codebase controls what it
 * decides to include. So the scrub happens at the one point where a provider
 * error becomes a response field, and it works two ways — by redacting the
 * literal secret values this process was configured with, which catches any
 * shape at all, and by redacting credential-shaped query parameters, which
 * catches a value this process does not know, such as a token an upstream
 * echoed back.
 */

import { config } from '../config.js';

const REDACTED = '<redacted>';

/**
 * Credential-shaped parameters in a URL or a quoted request body.
 *
 * `client_id` is deliberately absent: it is not a secret — every OAuth redirect
 * publishes it — and leaving it visible is what makes "Invalid client
 * credentials" diagnosable at all.
 */
const CREDENTIAL_PARAM =
  /\b(client_secret|access_token|refresh_token|api_?key|apikey|password|passwd|secret|token|auth|signature)=([^\s&"'<>]+)/gi;

/** Bearer and Basic values, which libraries sometimes echo from the headers. */
const AUTH_HEADER = /\b(bearer|basic)\s+([A-Za-z0-9._\-+/=]{8,})/gi;

/**
 * Every configured secret, longest first.
 *
 * Longest first matters: if one secret is a substring of another, redacting the
 * shorter one first would leave the tail of the longer one in the output.
 * Values under 8 characters are skipped — they are not credentials, and
 * redacting a short string would corrupt unrelated text.
 */
function configuredSecrets(): string[] {
  const candidates = [
    config.twitchClientSecret,
    config.kickClientSecret,
    config.redditClientSecret,
    config.synchraToken,
    config.googleApiKey,
    config.githubToken,
    config.steamApiKey,
    config.requireToken,
    config.tellowsApiKey,
    config.phoneblockApiKey,
    config.phoneblockPassword,
    config.maxmindLicenseKey,
    config.amazonPassword,
    config.aliexpressPassword,
    config.fritzboxPass,
    config.yourlsSignature,
    config.yourlsPassword,
    config.permaCcApiKey,
    config.iaSecretKey,
    config.nixpkgsSearchPassword,
    config.virustotalApiKey,
    config.urlscanApiKey,
    config.ipApiIoKey,
    config.ipApiComKey,
    config.dhlApiKey,
    config.fedexSecretKey,
    config.upsAccessKey,
    config.parcelsAppApiKey,
    config.seventeenTrackApiKey,
    config.backpackTfApiKey,
  ];

  return candidates
    .filter((value): value is string => typeof value === 'string' && value.length >= 8)
    .sort((a, b) => b.length - a.length);
}

/** `text` with every credential this process knows about replaced. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const secret of configuredSecrets()) {
    out = out.split(secret).join(REDACTED);
  }
  out = out.replace(CREDENTIAL_PARAM, (_match, key: string) => `${key}=${REDACTED}`);
  out = out.replace(AUTH_HEADER, (_match, scheme: string) => `${scheme} ${REDACTED}`);
  return out;
}
