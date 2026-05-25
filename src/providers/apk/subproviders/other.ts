import type { ApkDownloadInfo } from './aptoide.js';

export async function getEvoziDownload(pkg: string): Promise<ApkDownloadInfo[]> {
  return [
    {
      source: 'Evozi',
      url: `https://apps.evozi.com/apk-downloader/?id=${pkg}`,
    },
  ];
}

export async function getApkComboDownload(pkg: string): Promise<ApkDownloadInfo[]> {
  return [
    {
      source: 'APKCombo',
      url: `https://apkcombo.com/genericApp/${pkg}/download/apk`,
    },
  ];
}

export async function getApkPremierDownload(pkg: string): Promise<ApkDownloadInfo[]> {
  const premierPkg = pkg.replace(/\./g, '-');
  return [
    {
      source: 'APKPremier',
      url: `https://apkpremier.com/download/${premierPkg}`,
    },
  ];
}

export async function getApkDlDownload(pkg: string): Promise<ApkDownloadInfo[]> {
  return [
    {
      source: 'APK-DL',
      url: `http://apkfind.com/store/download?id=${pkg}`,
    },
  ];
}

export async function getApkSupportDownload(pkg: string): Promise<ApkDownloadInfo[]> {
  return [
    {
      source: 'APK.Support',
      url: `https://apk.support/download-app/${pkg}`,
    },
  ];
}
