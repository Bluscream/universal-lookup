import gplay from 'google-play-scraper';

export interface GooglePlayMetadata {
  title: string;
  description: string;
  developer: string;
  developerEmail: string;
  developerWebsite: string;
  score: number;
  installs: string;
  icon: string;
  headerImage: string;
  screenshots: string[];
  genre: string;
  price: number;
  free: boolean;
  version: string;
  url: string;
  updated: number;
}

export async function getGooglePlayMetadata(pkg: string): Promise<GooglePlayMetadata | null> {
  try {
    const app = await gplay.app({ appId: pkg });
    return {
      title: app.title,
      description: app.description,
      developer: app.developer,
      developerEmail: app.developerEmail || '',
      developerWebsite: app.developerWebsite || '',
      score: app.score,
      installs: app.installs,
      icon: app.icon,
      headerImage: app.headerImage,
      screenshots: app.screenshots || [],
      genre: app.genre || '',
      price: app.price || 0,
      free: app.free || false,
      version: app.version || 'VARY',
      url: app.url,
      updated: app.updated || 0,
    };
  } catch (err) {
    console.error(`[APK] Google Play scraper error for ${pkg}:`, err);
    return null;
  }
}
