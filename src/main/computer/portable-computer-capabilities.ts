import type { DesktopHostCapability } from '../../contracts/agent-protocol/v1/host-capabilities.js';
import { COMPUTER_HOST_OPERATIONS } from '../host/host-operation-catalog.js';
import type { PortableComputerCommands } from './portable-computer-command-resolver.js';

export function buildPortableComputerCapability(provider: string, commands: PortableComputerCommands): DesktopHostCapability {
  const operations = COMPUTER_HOST_OPERATIONS.filter(operation => supports(operation, commands));
  return { available: true, provider, operations };
}

function supports(operation: string, commands: PortableComputerCommands): boolean {
  if (operation === 'computer.wait') return commands.listWindows !== undefined || commands.accessibility !== undefined || commands.idle !== undefined;
  if (operation === 'computer.listWindows' || operation === 'computer.focus' || operation === 'computer.closeWindow' || operation === 'computer.setWindowState') return commands.listWindows !== undefined;
  if (operation === 'computer.inspect' || operation === 'computer.readText' || operation === 'computer.readSelection' || operation === 'computer.readGrid' || operation === 'computer.selectText' || operation === 'computer.setValue' || operation === 'computer.invoke' || operation === 'computer.select' || operation === 'computer.setToggleState' || operation === 'computer.setExpandedState' || operation === 'computer.scrollIntoView' || operation === 'computer.waitForState') return commands.accessibility !== undefined;
  if (operation === 'computer.click' || operation === 'computer.type' || operation === 'computer.keypress' || operation === 'computer.scroll' || operation === 'computer.drag' || operation === 'computer.move' || operation === 'computer.manageFileDialog') return commands.input !== undefined;
  if (operation === 'computer.screenshot') return commands.screenshot !== undefined && commands.listWindows !== undefined;
  if (operation === 'computer.recognizeText') return commands.screenshot !== undefined && commands.ocr !== undefined && commands.listWindows !== undefined;
  if (operation === 'computer.readClipboard') return commands.clipboardRead !== undefined;
  if (operation === 'computer.writeClipboard') return commands.clipboardWrite !== undefined;
  if (operation === 'computer.launch') return commands.launch !== undefined;
  if (operation === 'computer.listDisplays') return commands.displays !== undefined;
  return false;
}
