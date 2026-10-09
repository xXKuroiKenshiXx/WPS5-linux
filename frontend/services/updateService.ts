import appPackage from '../package.json';
export const currentVersion = appPackage.version;
const releasesUrl = 'https://github.com/xXKuroiKenshiXx/WPS5-linux/releases';
export async function fetchLatestRelease(): Promise<{ version: string; link: string }> {
  const response = await fetch('https://api.github.com/repos/xXKuroiKenshiXx/WPS5-linux/releases/latest');
  if (response.status === 404) return { version: currentVersion, link: releasesUrl };
  if (!response.ok) throw new Error('Could not check Linux releases');
  const release = await response.json() as { tag_name: string; html_url: string };
  return { version: release.tag_name.replace(/^v\.?/, ''), link: release.html_url };
}
