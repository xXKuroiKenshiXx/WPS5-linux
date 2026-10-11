import appPackage from '../package.json';
export const currentVersion = appPackage.version;
const releasesUrl = 'https://github.com/xXKuroiKenshiXx/WPS5-linux/releases';
// Linux builds are published as prereleases, which /releases/latest skips.
export async function fetchLatestRelease(): Promise<{ version: string; link: string }> {
  const response = await fetch('https://api.github.com/repos/xXKuroiKenshiXx/WPS5-linux/releases?per_page=20');
  if (!response.ok) throw new Error('Could not check Linux releases');
  const releases = await response.json() as { tag_name: string; html_url: string; draft: boolean }[];
  const release = releases.find(r => !r.draft && /-linux$/i.test(r.tag_name));
  if (!release) return { version: currentVersion, link: releasesUrl };
  return { version: release.tag_name.replace(/^v\.?/i, '').replace(/-linux$/i, ''), link: release.html_url };
}
