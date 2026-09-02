export function displayFileName(value: string): string {
  return value.split(/[\\/]/u).pop() ?? value;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${bytes / 1_000_000} MB` : `${bytes / 1_000} KB`;
}
