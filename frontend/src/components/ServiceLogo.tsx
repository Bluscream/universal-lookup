import {
  siActivision,
  siBattledotnet,
  siBluesky,
  siClaude,
  siCloudflare,
  siCounterstrike,
  siDeutschetelekom,
  siDigitalocean,
  siDiscord,
  siEa,
  siO2,
  siEpicgames,
  siGithub,
  siGooglecloud,
  siMongodb,
  siNetlify,
  siPlaystation,
  siReddit,
  siSentry,
  siSteam,
  siTwitch,
  siUbisoft,
  siVercel,
  siVodafone,
  siVrchat,
  siWindsurf,
} from 'simple-icons';

interface Icon {
  title: string;
  path: string;
  hex: string;
}

// Nintendo + Xbox aren't in Simple Icons (trademark takedowns); use Material
// Design Icons' monochrome 24x24 paths so they match the Simple Icons style.
const MDI_NINTENDO_SWITCH =
  'M10.04 20.4H7.12c-.93 0-1.82-.4-2.48-1.04C4 18.7 3.6 17.81 3.6 16.88V7.12c0-.93.4-1.82 1.04-2.48C5.3 4 6.19 3.62 7.12 3.62h2.92zM7.12 2A5.12 5.12 0 0 0 2 7.12v9.76C2 19.71 4.29 22 7.12 22h4.53V2zM5.11 8c0 1.04.84 1.88 1.89 1.88c1.03 0 1.87-.84 1.87-1.88S8.03 6.12 7 6.12c-1.05 0-1.89.84-1.89 1.88m12.5 3c1.11 0 2.01.89 2.01 2c0 1.12-.9 2-2.01 2s-2.03-.88-2.03-2c0-1.11.92-2 2.03-2m-.73 11A5.12 5.12 0 0 0 22 16.88V7.12C22 4.29 19.71 2 16.88 2h-3.23v20z';
const MDI_XBOX =
  'M6.43 3.72c.07-.06.14-.12.19-.16C8.18 2.55 10 2 12 2c1.88 0 3.64.5 5.14 1.42c.11.08.4.27.56.46C16.25 2.28 12 5.7 12 5.7c-1.5-1.13-2.83-1.9-3.84-2.2c-.85-.21-1.43 0-1.7.2m12.88 1.51c-.05-.05-.1-.1-.14-.15c-.36-.4-.82-.5-1.2-.47c-.39.12-2.1.73-4.2 2.72c0 0 2.37 2.3 3.82 4.65s2.31 4.2 1.78 6.77C21 16.95 22 14.59 22 12c0-2.62-1-5-2.66-6.79m-3.61 7.75c-.65-.72-1.6-1.75-2.87-3.01c-.27-.27-.56-.55-.86-.85c0 0-.47.46-1.07 1.07c-.77.77-1.76 1.78-2.32 2.37c-.98 1.05-3.8 4.35-3.96 6.2c0 0-.65-1.46.75-4.85c.9-2.21 3.6-5.53 4.75-6.61c0 0-1.03-1.14-2.33-1.93l-.05-.03c-.63-.37-1.31-.66-1.97-.7c-.67.05-1.09.54-1.09.54A9.95 9.95 0 0 0 2 12a10 10 0 0 0 10 10c2.93 0 5.57-1.26 7.4-3.27c0 0-.21-1.33-1.56-3.23c-.31-.43-1.47-1.81-2.11-2.54';
const MDI_AWS =
  'M7.64 10.38c0 .25.02.45.07.62c.05.12.12.28.21.46c.04.04.05.1.05.15c0 .07-.04.13-.13.2l-.42.28c-.06.04-.12.06-.17.06c-.07 0-.13-.04-.2-.1c-.09-.1-.17-.2-.24-.31c-.06-.11-.13-.24-.2-.39c-.52.61-1.17.92-1.96.92c-.56 0-1-.16-1.33-.48c-.32-.32-.49-.75-.49-1.29c0-.55.2-1 .6-1.36c.41-.34.95-.52 1.63-.52c.23 0 .44.02.71.06c.23.03.5.08.76.14v-.48c0-.51-.1-.84-.31-1.07c-.22-.21-.57-.3-1.08-.3c-.24 0-.48.03-.72.08c-.25.06-.49.13-.72.23c-.11.04-.2.07-.23.08c-.05.02-.08.02-.11.02c-.09 0-.14-.06-.14-.2v-.33c0-.1.01-.18.05-.23q.045-.075.18-.12c.24-.14.51-.24.84-.32a4 4 0 0 1 1.04-.13q1.185 0 1.74.54c.37.36.55.91.55 1.64v2.15zm-2.7 1.02c.22 0 .44-.04.68-.12s.45-.23.63-.43c.11-.13.19-.27.25-.43c0-.16.05-.35.05-.58v-.27c-.2-.07-.4-.07-.62-.12a7 7 0 0 0-.62-.04c-.45 0-.77.09-.99.27s-.32.43-.32.76c0 .32.07.56.24.71c.16.17.39.25.7.25m5.34.71a.6.6 0 0 1-.28-.06c-.03-.05-.08-.14-.12-.26L8.32 6.65c-.04-.15-.06-.22-.06-.27c0-.11.05-.17.16-.17h.65c.13 0 .22.02.26.07c.06.04.1.13.14.26l1.11 4.4l1.04-4.4c.03-.13.07-.22.13-.26c.05-.04.14-.07.25-.07h.55c.12 0 .21.02.26.07c.05.04.1.13.13.26L14 11l1.14-4.46c.04-.13.09-.22.13-.26c.06-.04.14-.07.26-.07h.62c.11 0 .17.06.17.17c0 .03-.01.07-.02.12c0 0-.02.08-.04.15l-1.61 5.14c-.04.14-.08.21-.15.26c-.04.04-.13.07-.24.07h-.57c-.13 0-.19-.02-.27-.07a.45.45 0 0 1-.12-.26L12.27 7.5l-1.03 4.28q-.045.195-.12.27a.5.5 0 0 1-.27.06zm8.55.18c-.33 0-.7-.04-1.03-.12s-.59-.17-.76-.26a.5.5 0 0 1-.21-.19a.4.4 0 0 1-.04-.18v-.34c0-.14.05-.2.15-.2h.12c.04 0 .1.05.17.08c.22.1.47.18.73.23c.27.05.54.08.79.08c.42 0 .75-.07.97-.22c.23-.17.35-.36.35-.63c0-.19-.07-.34-.18-.47c-.12-.12-.35-.24-.67-.34l-.97-.3c-.48-.16-.84-.38-1.06-.68a1.58 1.58 0 0 1-.33-.97c0-.28.06-.52.18-.73c.12-.22.28-.4.46-.55c.22-.15.44-.26.71-.34q.39-.12.84-.12q.21 0 .45.03c.14.02.28.05.42.07c.14.04.26.07.38.11s.2.08.28.12c.09.05.16.1.2.16s.06.13.06.22v.32q0 .21-.15.21c-.05 0-.14-.03-.26-.08c-.37-.17-.8-.26-1.27-.26c-.38 0-.66.06-.89.19c-.2.12-.31.32-.31.59c0 .19.07.35.2.47c.13.13.38.25.73.37l.95.3c.48.14.82.36 1.03.64q.3.405.3.93c0 .28-.06.54-.17.77c-.12.22-.28.42-.5.58c-.19.17-.44.29-.72.38s-.62.13-.95.13m1.25 3.24C17.89 17.14 14.71 18 12 18c-3.85 0-7.3-1.42-9.91-3.77c-.21-.19-.02-.44.23-.29c2.82 1.63 6.29 2.62 9.89 2.62c2.43 0 5.1-.5 7.55-1.56c.37-.15.68.26.32.53M21 14.5c-.29-.37-1.86-.18-2.57-.1c-.21.03-.24-.16-.05-.3c1.25-.87 3.31-.6 3.54-.33c.24.3-.06 2.36-1.23 3.34c-.19.15-.36.07-.28-.11c.27-.68.86-2.16.59-2.5';
const MDI_AZURE =
  'M13.05 4.24L6.56 18.05L2 18l5.09-8.76zm.7 1.09L22 19.76H6.74l9.3-1.66l-4.87-5.79z';
// OpenAI + Devin aren't in Simple Icons; use Iconify paths (RemixIcon / MDI).
const IC_OPENAI =
  'M20.562 10.188c.25-.688.313-1.376.25-2.063c-.062-.687-.312-1.375-.625-2c-.562-.937-1.375-1.687-2.312-2.125c-1-.437-2.063-.562-3.125-.312c-.5-.5-1.063-.938-1.688-1.25S11.687 2 11 2a5.17 5.17 0 0 0-3 .938c-.875.624-1.5 1.5-1.813 2.5c-.75.187-1.375.5-2 .875c-.562.437-1 1-1.375 1.562c-.562.938-.75 2-.625 3.063a5.44 5.44 0 0 0 1.25 2.874a4.7 4.7 0 0 0-.25 2.063c.063.688.313 1.375.625 2c.563.938 1.375 1.688 2.313 2.125c1 .438 2.062.563 3.125.313c.5.5 1.062.937 1.687 1.25S12.312 22 13 22a5.17 5.17 0 0 0 3-.937c.875-.625 1.5-1.5 1.812-2.5a4.54 4.54 0 0 0 1.938-.875c.562-.438 1.062-.938 1.375-1.563c.562-.937.75-2 .625-3.062c-.125-1.063-.5-2.063-1.188-2.876m-7.5 10.5c-1 0-1.75-.313-2.437-.875c0 0 .062-.063.125-.063l4-2.312a.5.5 0 0 0 .25-.25a.57.57 0 0 0 .062-.313V11.25l1.688 1v4.625a3.685 3.685 0 0 1-3.688 3.813M5 17.25c-.438-.75-.625-1.625-.438-2.5c0 0 .063.063.125.063l4 2.312a.56.56 0 0 0 .313.063c.125 0 .25 0 .312-.063l4.875-2.812v1.937l-4.062 2.375A3.7 3.7 0 0 1 7.312 19c-1-.25-1.812-.875-2.312-1.75M3.937 8.563a3.8 3.8 0 0 1 1.938-1.626v4.751c0 .124 0 .25.062.312a.5.5 0 0 0 .25.25l4.875 2.813l-1.687 1l-4-2.313a3.7 3.7 0 0 1-1.75-2.25c-.25-.937-.188-2.062.312-2.937M17.75 11.75l-4.875-2.812l1.687-1l4 2.312c.625.375 1.125.875 1.438 1.5s.5 1.313.437 2.063a3.7 3.7 0 0 1-.75 1.937c-.437.563-1 1-1.687 1.25v-4.75c0-.125 0-.25-.063-.312c0 0-.062-.126-.187-.188m1.687-2.5s-.062-.062-.125-.062l-4-2.313c-.125-.062-.187-.062-.312-.062s-.25 0-.313.062L9.812 9.688V7.75l4.063-2.375c.625-.375 1.312-.5 2.062-.5c.688 0 1.375.25 2 .688c.563.437 1.063 1 1.313 1.625s.312 1.375.187 2.062m-10.5 3.5l-1.687-1V7.063c0-.688.187-1.438.562-2C8.187 4.438 8.75 4 9.375 3.688a3.37 3.37 0 0 1 2.062-.313c.688.063 1.375.375 1.938.813c0 0-.063.062-.125.062l-4 2.313a.5.5 0 0 0-.25.25c-.063.125-.063.187-.063.312zm.875-2L12 9.5l2.187 1.25v2.5L12 14.5l-2.188-1.25z';
const MDI_ROBOT =
  'M22 14h-1c0-3.87-3.13-7-7-7h-1V5.73A2 2 0 1 0 10 4c0 .74.4 1.39 1 1.73V7h-1c-3.87 0-7 3.13-7 7H2c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h1v1a2 2 0 0 0 2 2h14c1.11 0 2-.89 2-2v-1h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1M9.79 16.5C9.4 15.62 8.53 15 7.5 15s-1.9.62-2.29 1.5c-.13-.31-.21-.64-.21-1a2.5 2.5 0 0 1 5 0c0 .36-.08.69-.21 1m9 0c-.39-.88-1.29-1.5-2.29-1.5s-1.9.62-2.29 1.5c-.13-.31-.21-.64-.21-1a2.5 2.5 0 0 1 5 0c0 .36-.08.69-.21 1';

/** Brand logo per service (Simple Icons + a few from Material Design Icons). */
const LOGOS: Record<string, Icon> = {
  activision: siActivision,
  battlenet: siBattledotnet,
  cloudflare: siCloudflare,
  cs2: siCounterstrike,
  digitalocean: siDigitalocean,
  discord: siDiscord,
  ea: siEa,
  epic: siEpicgames,
  gcp: siGooglecloud,
  github: siGithub,
  netlify: siNetlify,
  playstation: siPlaystation,
  reddit: siReddit,
  steam: siSteam,
  twitch: siTwitch,
  ubisoft: siUbisoft,
  vercel: siVercel,
  vrchat: siVrchat,
  mongodb: siMongodb,
  sentry: siSentry,
  bluesky: siBluesky,
  claude: siClaude,
  windsurf: siWindsurf,
  nintendo: { title: 'Nintendo Switch', path: MDI_NINTENDO_SWITCH, hex: '' },
  xbox: { title: 'Xbox', path: MDI_XBOX, hex: '' },
  aws: { title: 'Amazon Web Services', path: MDI_AWS, hex: '' },
  azure: { title: 'Microsoft Azure', path: MDI_AZURE, hex: '' },
  openai: { title: 'OpenAI', path: IC_OPENAI, hex: '' },
  devin: { title: 'Devin', path: MDI_ROBOT, hex: '' },
  // German ISPs. Only these three are in Simple Icons; the rest fall back to the
  // logo URL the API supplies (see below).
  'deutsche-telekom': siDeutschetelekom,
  vodafone: siVodafone,
  o2: siO2,
};

/**
 * Brand logo for a status provider.
 *
 * Prefers the inline Simple Icons SVG, rendered in the current text colour so it
 * doesn't fight the status colouring. Services we have no inline path for — the
 * crowd-sourced ones are drawn from a catalogue of hundreds, so hard-coding them
 * all isn't practical — fall back to the logo URL the API hands us, and finally
 * to a globe.
 */
export function ServiceLogo({
  service,
  size = 16,
  iconUrl,
}: {
  service: string;
  size?: number;
  iconUrl?: string | null;
}) {
  const key = service.toLowerCase();
  const icon = LOGOS[key];
  if (icon) {
    return (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        style={{ flexShrink: 0, verticalAlign: '-0.15em' }}
      >
        <title>{icon.title}</title>
        <path d={icon.path} />
      </svg>
    );
  }
  if (iconUrl) {
    return (
      <img
        alt=""
        aria-hidden
        src={iconUrl}
        width={size}
        height={size}
        loading="lazy"
        style={{
          flexShrink: 0,
          verticalAlign: '-0.15em',
          objectFit: 'contain',
          // These are full-colour raster logos, so give them a light backdrop —
          // several are dark artwork that would vanish against a dark theme.
          background: 'rgba(255,255,255,0.9)',
          borderRadius: '2px',
        }}
      />
    );
  }
  return (
    <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>
      🌐
    </span>
  );
}
