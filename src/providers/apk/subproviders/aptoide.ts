export interface ApkDownloadInfo {
  source: string;
  version?: string;
  url: string;
  size?: number;
  md5?: string;
  status?: number;
  is_alive?: boolean;
}

interface AptoideResponse {
  nodes?: {
    meta?: {
      data?: {
        file?: {
          vername?: string;
          md5sum?: string;
          path?: string;
          path_alt?: string;
        };
        size?: number;
      };
    };
  };
}

export async function getAptoideDownload(pkg: string): Promise<ApkDownloadInfo[]> {
  try {
    const response = await fetch(`https://ws75.aptoide.com/api/7/app/get?package_name=${pkg}`);
    if (!response.ok) return [];

    const data = (await response.json()) as AptoideResponse;
    if (!data?.nodes?.meta?.data?.file) return [];

    const file = data.nodes.meta.data.file;
    const size = data.nodes.meta.data.size;
    const version = file.vername;
    const md5 = file.md5sum;

    const downloads: ApkDownloadInfo[] = [];

    if (file.path) {
      downloads.push({
        source: 'Aptoide',
        version,
        url: file.path,
        size,
        md5,
      });
    }

    if (file.path_alt && file.path_alt !== file.path) {
      downloads.push({
        source: 'Aptoide (Alt)',
        version,
        url: file.path_alt,
        size,
        md5,
      });
    }

    return downloads;
  } catch (err) {
    console.error(`[APK] Aptoide error for ${pkg}:`, err);
    return [];
  }
}
