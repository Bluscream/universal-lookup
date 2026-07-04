import {
  siActivision,
  siBattledotnet,
  siCloudflare,
  siDiscord,
  siEa,
  siEpicgames,
  siGithub,
  siPlaystation,
  siReddit,
  siSteam,
  siTwitch,
  siUbisoft,
  siVrchat,
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

/** Brand logo per service (Simple Icons + a couple from Material Design Icons). */
const LOGOS: Record<string, Icon> = {
  activision: siActivision,
  battlenet: siBattledotnet,
  cloudflare: siCloudflare,
  discord: siDiscord,
  ea: siEa,
  epic: siEpicgames,
  github: siGithub,
  playstation: siPlaystation,
  reddit: siReddit,
  steam: siSteam,
  twitch: siTwitch,
  ubisoft: siUbisoft,
  vrchat: siVrchat,
  nintendo: { title: 'Nintendo Switch', path: MDI_NINTENDO_SWITCH, hex: '' },
  xbox: { title: 'Xbox', path: MDI_XBOX, hex: '' },
};

/**
 * Brand logo for a status provider. Renders the Simple Icons SVG in the current
 * text colour (so it doesn't fight the status colouring); falls back to an emoji
 * for services without a logo, and a globe for anything unknown.
 */
export function ServiceLogo({ service, size = 16 }: { service: string; size?: number }) {
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
  return (
    <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>
      🌐
    </span>
  );
}
