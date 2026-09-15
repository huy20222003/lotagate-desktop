export const BROWSER_OPENED_EVENT = 'lotagate.browser.opened';

export interface BrowserOpenedDetail {
  id: string;
  url: string;
}

export async function openInWorkspaceBrowser(url: string): Promise<BrowserOpenedDetail> {
  const result = await window.lotagate.browser.open(url, true);
  const detail: BrowserOpenedDetail = { id: result.id, url: result.url };
  window.dispatchEvent(new CustomEvent<BrowserOpenedDetail>(BROWSER_OPENED_EVENT, { detail }));
  return detail;
}
