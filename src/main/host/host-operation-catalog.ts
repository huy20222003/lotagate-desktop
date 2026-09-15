/**
 * Native host operation inventory.
 *
 * The CLI owns public tool schemas. Desktop owns this implementation inventory
 * so all providers derive capabilities from one source instead of maintaining
 * unrelated operation arrays.
 */
export const COMPUTER_HOST_OPERATIONS = [
  'computer.listWindows', 'computer.inspect', 'computer.screenshot',
  'computer.readText', 'computer.readSelection', 'computer.readGrid',
  'computer.recognizeText', 'computer.focus', 'computer.click', 'computer.type',
  'computer.keypress', 'computer.scroll', 'computer.drag', 'computer.selectText',
  'computer.listDisplays', 'computer.launch', 'computer.wait', 'computer.move',
  'computer.setValue', 'computer.invoke', 'computer.select',
  'computer.setToggleState', 'computer.setExpandedState', 'computer.scrollIntoView',
  'computer.setWindowState', 'computer.closeWindow', 'computer.readClipboard',
  'computer.writeClipboard', 'computer.waitForState', 'computer.manageFileDialog',
] as const;
