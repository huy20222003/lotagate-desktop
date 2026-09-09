import { useEffect, useState, type ReactNode } from 'react';
import { Folder, GitBranch } from 'lucide-react';
import type { Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { Icon } from '../../../components/ui/Icon.js';

export interface NewChatWelcomeProps {
  readonly workspace?: Workspace | undefined;
  readonly children: ReactNode;
}

export function NewChatWelcome({ workspace, children }: NewChatWelcomeProps) {
  const [branchName, setBranchName] = useState<string | undefined>();

  useEffect(() => {
    if (!workspace?.rootPath || !window.lotagate?.git?.branchList) {
      setBranchName(undefined);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const branches = await window.lotagate.git.branchList(workspace.rootPath);
        if (!active) return;
        const current = branches.find(b => b.current);
        if (current) {
          setBranchName(current.name);
        } else if (window.lotagate.git.status) {
          const snapshot = await window.lotagate.git.status(workspace.rootPath);
          if (active) setBranchName(snapshot.branch);
        }
      } catch {
        if (active) setBranchName(undefined);
      }
    })();
    return () => {
      active = false;
    };
  }, [workspace?.rootPath]);

  return (
    <div className="new-chat-welcome">
      <h1>LotaGate Agent</h1>
      {workspace ? (
        <div className="new-chat-context-bar">
          <div className="new-chat-context-item">
            <Icon icon={Folder} size={14} />
            <span>{workspace.name}</span>
          </div>
          {branchName ? (
            <div className="new-chat-context-item">
              <Icon icon={GitBranch} size={14} />
              <span>{branchName}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
