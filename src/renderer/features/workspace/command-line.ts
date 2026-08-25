export function parseCommandLine(input: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let token = '';
  let quote: 'single' | 'double' | undefined;
  let escaped = false;
  let hasToken = false;
  for (const character of input.trim()) {
    if (escaped) { token += character; escaped = false; hasToken = true; continue; }
    if (character === '\\' && quote !== 'single') { escaped = true; hasToken = true; continue; }
    if (quote === 'single' && character === "'") { quote = undefined; continue; }
    if (quote === 'double' && character === '"') { quote = undefined; continue; }
    if (!quote && character === "'") { quote = 'single'; hasToken = true; continue; }
    if (!quote && character === '"') { quote = 'double'; hasToken = true; continue; }
    if (!quote && /\s/u.test(character)) { if (hasToken) { tokens.push(token); token = ''; hasToken = false; } continue; }
    token += character;
    hasToken = true;
  }
  if (escaped || quote) throw new Error('Terminal command contains an unfinished escape or quote.');
  if (hasToken) tokens.push(token);
  const command = tokens.shift();
  if (!command) throw new Error('Enter a command first.');
  return { command, args: tokens };
}
