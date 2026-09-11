export function parseMacWindows(output: string): readonly Record<string, unknown>[] {
  return output.split(/\r?\n/u).flatMap(line => {
    const [application, ...windows] = line.split('\t');
    return application === undefined || application.length === 0 ? [] : windows.filter(Boolean).map(window => ({ windowId: encodeMacWindowId(application, window), application, title: window }));
  });
}

export function parseLinuxWindows(output: string): readonly Record<string, unknown>[] {
  return output.split(/\r?\n/u).flatMap(line => {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 7 || fields[0] === undefined || !/^[0-9a-f]+$/iu.test(fields[0])) return [];
    const [windowId, desktop, x, y, width, height, ...title] = fields;
    return [{ windowId: `linux:${windowId}`, desktop, bounds: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) }, title: title.join(' ') }];
  });
}

export function parseLinuxDisplays(output: string): readonly Record<string, unknown>[] {
  return output.split(/\r?\n/u).flatMap(line => {
    const match = /^([^\s]+) connected(?: primary)? (\d+)x(\d+)\+(-?\d+)\+(-?\d+)/u.exec(line);
    return match === null ? [] : [{ name: match[1], width: Number(match[2]), height: Number(match[3]), x: Number(match[4]), y: Number(match[5]) }];
  });
}

export function encodeMacWindowId(application: string, window: string): string {
  return `mac:${Buffer.from(JSON.stringify({ application, window }), 'utf8').toString('base64url')}`;
}

export function decodeMacWindowId(value: string): { application: string; window: string } {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value.slice('mac:'.length), 'base64url').toString('utf8'));
    if (isRecord(decoded) && typeof decoded['application'] === 'string' && typeof decoded['window'] === 'string') return { application: decoded['application'], window: decoded['window'] };
  } catch { /* fall through */ }
  throw new Error('The macOS windowId is invalid.');
}

export function encodeMacElementId(application: string, window: string, index: number): string {
  return `mac-element:${Buffer.from(JSON.stringify({ application, window, index }), 'utf8').toString('base64url')}`;
}

export function decodeMacElementId(value: string): { application: string; window: string; index: number } {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value.slice('mac-element:'.length), 'base64url').toString('utf8'));
    if (isRecord(decoded) && typeof decoded['application'] === 'string' && typeof decoded['window'] === 'string' && typeof decoded['index'] === 'number' && Number.isInteger(decoded['index']) && decoded['index'] >= 0) return { application: decoded['application'], window: decoded['window'], index: decoded['index'] };
  } catch { /* fall through */ }
  throw new Error('The macOS elementId is invalid.');
}

export function decodeLinuxWindowId(value: string): string {
  const id = value.slice('linux:'.length);
  if (!value.startsWith('linux:') || !/^[0-9a-f]+$/iu.test(id)) throw new Error('The Linux windowId is invalid.');
  return `0x${id}`;
}

export function appleScriptString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
