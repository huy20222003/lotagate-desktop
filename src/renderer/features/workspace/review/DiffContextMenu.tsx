import { ChevronRight, Code2, Copy, FolderOpen, WrapText } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { FileOpenDestination } from '../../../../contracts/ipc/v1/settings.js';
import { Icon } from '../../../components/ui.js';
import { useClipboard } from '../../../hooks/use-clipboard.js';
import { openFilePath } from '../../../services/open-file.js';
import { absoluteWorkspacePath, displayFilePath, relativeWorkspaceFilePath } from './file-change-view.js';

export function DiffContextMenu({ path, workspaceCwd, lineWrap, onToggleLineWrap, children }: { path: string; workspaceCwd?: string | undefined; lineWrap: boolean; onToggleLineWrap: () => void; children: ReactNode }) {
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const [openWith, setOpenWith] = useState(false);
  const [submenuSide, setSubmenuSide] = useState<'right' | 'left'>('right');
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const { copy } = useClipboard();
  const absolutePath = absoluteWorkspacePath(workspaceCwd, path);
  const relativePath = relativeWorkspaceFilePath(workspaceCwd, path);
  useEffect(() => {
    if (position === undefined) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setPosition(undefined); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPosition(undefined); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', closeOnEscape); };
  }, [position]);
  const open = (destination?: FileOpenDestination) => { setPosition(undefined); openFilePath(absolutePath, destination); };
  const copyValue = (value: string) => { setPosition(undefined); void copy(value); };
  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOpenWith(false);
    setPosition({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 270)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 250)) });
  };
  const openOpenWith = () => {
    setOpenWith(true);
    window.requestAnimationFrame(() => {
      const menu = menuRef.current;
      const submenu = submenuRef.current;
      if (menu === null || submenu === null) return;
      const menuBounds = menu.getBoundingClientRect();
      const submenuWidth = submenu.getBoundingClientRect().width;
      const opensRight = menuBounds.right + submenuWidth <= window.innerWidth;
      setSubmenuSide(opensRight ? 'right' : 'left');
    });
  };
  return <div className="diff-context-menu-surface" onContextMenu={handleContextMenu}>{children}{position !== undefined ? <div ref={menuRef} className="diff-context-menu" style={{ left: position.x, top: position.y }} role="menu" aria-label={`Actions for ${displayFilePath(path)}`} onContextMenu={event => event.preventDefault()}>
    <button type="button" className="diff-context-menu-item" role="menuitem" onClick={() => open('vscode')}><Icon icon={Code2} size={15} /><span>Open in VS Code</span></button>
    <div className="diff-context-menu-submenu-wrap" onMouseEnter={openOpenWith} onMouseLeave={() => setOpenWith(false)}>
      <button type="button" className="diff-context-menu-item" role="menuitem" aria-haspopup="menu" aria-expanded={openWith}><Icon icon={FolderOpen} size={15} /><span>Open with</span><Icon icon={ChevronRight} size={14} /></button>
      {openWith ? <div ref={submenuRef} className={`diff-context-menu diff-context-menu-submenu${submenuSide === 'left' ? ' is-left' : ''}`} role="menu" aria-label="Open with"><button type="button" className="diff-context-menu-item" role="menuitem" onClick={() => open('vscode')}><Icon icon={Code2} size={15} /><span>VS Code</span></button><button type="button" className="diff-context-menu-item" role="menuitem" onClick={() => open('file-explorer')}><Icon icon={FolderOpen} size={15} /><span>File Explorer</span></button></div> : null}
    </div>
    <div className="diff-context-menu-separator" />
    <button type="button" className="diff-context-menu-item" role="menuitem" onClick={() => copyValue(window.getSelection()?.toString() ?? '')}><Icon icon={Copy} size={15} /><span>Copy selection</span></button>
    <button type="button" className="diff-context-menu-item" role="menuitem" onClick={() => copyValue(absolutePath)}><Icon icon={Copy} size={15} /><span>Copy path</span></button>
    <button type="button" className="diff-context-menu-item" role="menuitem" onClick={() => copyValue(relativePath)}><Icon icon={Copy} size={15} /><span>Copy relative path</span></button>
    <button type="button" className="diff-context-menu-item" role="menuitem" onClick={() => { setPosition(undefined); onToggleLineWrap(); }}><Icon icon={WrapText} size={15} /><span>{lineWrap ? 'Disable line wrap' : 'Toggle line wrap'}</span></button>
  </div> : null}</div>;
}
