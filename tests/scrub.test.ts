import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../backend/src/config.js';
import { collectErrors } from '../backend/src/lib/merger.js';
import { scrubSecrets } from '../backend/src/lib/scrub.js';
import type { ProviderResult } from '../backend/src/types/common.js';

/**
 * Regression, from a leak that actually happened in production.
 *
 * `@twurple/api` reports a failed token request by quoting the request it made.
 * For the OAuth token endpoint that means the query string, and the query string
 * carries `client_secret`. The enricher caught the error, `collectErrors` put
 * its message into `errors`, and the deployed service — reachable from the open
 * internet over a Tailscale Funnel, with no auth — answered
 * `GET /api/social/Bluscream` with its own Twitch client secret in the JSON.
 *
 * The verbatim shape of that message is pinned below, because the whole point is
 * that the text is composed by someone else's library and this codebase does not
 * get to choose what it contains.
 */
const TWURPLE_MESSAGE = (secret: string) =>
  `Encountered HTTP status code 400: Bad Request\n\nURL: token?grant_type=client_credentials&client_id=mkx662b5bw4ecf5yuz1fmik4mop2q5&client_secret=${secret}\nMethod: POST\nBody:\n{\n  "status": 400,\n  "message": "Invalid client credentials"\n}`;

/**
 * A fake, not the value that actually leaked.
 *
 * The real one was pinned here when this test was written, which put the live
 * credential into the repository and its history — the same mistake the code
 * under test exists to prevent, made one directory away from it. The test never
 * needed the real value: what it checks is that a configured secret of any
 * shape is removed from a message composed elsewhere.
 */
const SECRET = 'not-a-real-secret-0000000000000';

const original = config.twitchClientSecret;
afterEach(() => {
  config.twitchClientSecret = original;
});

describe('scrubbing a provider error', () => {
  it('removes a configured secret quoted verbatim by a client library', () => {
    config.twitchClientSecret = SECRET;
    const scrubbed = scrubSecrets(TWURPLE_MESSAGE(SECRET));

    expect(scrubbed).not.toContain(SECRET);
    expect(scrubbed).toContain('<redacted>');
    // The diagnosis has to survive the redaction, or nobody can fix the cause.
    expect(scrubbed).toContain('Invalid client credentials');
    expect(scrubbed).toContain('400');
  });

  it('removes a credential-shaped parameter even when the value is unknown here', () => {
    // The case the configured-value list cannot cover: a token minted upstream
    // and echoed back, which this process never held.
    config.twitchClientSecret = '';
    const scrubbed = scrubSecrets('GET /x?access_token=abc123def456ghi&page=2 failed');

    expect(scrubbed).not.toContain('abc123def456ghi');
    expect(scrubbed).toContain('access_token=<redacted>');
    // A non-credential parameter is left alone, so the URL stays readable.
    expect(scrubbed).toContain('page=2');
  });

  it('keeps client_id visible, because it is not a secret and names the app', () => {
    config.twitchClientSecret = SECRET;
    const scrubbed = scrubSecrets(TWURPLE_MESSAGE(SECRET));

    expect(scrubbed).toContain('client_id=mkx662b5bw4ecf5yuz1fmik4mop2q5');
  });

  it('removes an Authorization value', () => {
    config.twitchClientSecret = '';
    expect(scrubSecrets('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig rejected')).not.toContain(
      'eyJhbGciOiJIUzI1NiJ9',
    );
  });

  it('leaves a message with nothing sensitive in it untouched', () => {
    config.twitchClientSecret = '';
    const message = 'https://api.github.com/users/x returned status code 404';

    expect(scrubSecrets(message)).toBe(message);
  });

  it('does not corrupt text by redacting a very short configured value', () => {
    // A one- or two-character setting is not a credential, and treating it as
    // one would replace unrelated substrings all over the message.
    config.twitchClientSecret = 'ab';
    expect(scrubSecrets('a problem about abc')).toBe('a problem about abc');
  });
});

describe('collectErrors', () => {
  it('scrubs on the way into the response, for every lookup type at once', () => {
    config.twitchClientSecret = SECRET;
    const results: ProviderResult[] = [
      {
        provider: 'twitch-channel',
        success: false,
        data: {},
        error: TWURPLE_MESSAGE(SECRET),
        duration: 1,
      },
    ];

    const errors = collectErrors(results);

    expect(errors['twitch-channel']).toBeDefined();
    expect(JSON.stringify(errors)).not.toContain(SECRET);
  });

  it('still reports a successful provider as no error at all', () => {
    const results: ProviderResult[] = [
      { provider: 'keybase', success: true, data: {}, duration: 1 },
    ];

    expect(collectErrors(results)).toEqual({});
  });
});
