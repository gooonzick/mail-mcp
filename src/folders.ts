export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged';

export interface FolderInfo {
  path: string;
  specialUse?: string | undefined;
  /** As reported by imapflow: "extension" = SPECIAL-USE/XLIST flag from the server, "name" = matched a known localized name. */
  specialUseSource?: 'user' | 'extension' | 'name' | undefined;
}

const ROLE_FLAGS: Record<FolderRole, string> = {
  inbox: '\\Inbox',
  sent: '\\Sent',
  drafts: '\\Drafts',
  trash: '\\Trash',
  junk: '\\Junk',
  archive: '\\Archive',
  all: '\\All',
  flagged: '\\Flagged',
};

const ROLE_NAMES: Record<string, FolderRole> = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'drafts',
  trash: 'trash',
  junk: 'junk',
  spam: 'junk',
  archive: 'archive',
  all: 'all',
  flagged: 'flagged',
};

export const FOLDER_ARGUMENT_HELP =
  'Folder role (inbox, sent, drafts, trash, junk, archive, all, flagged) or an exact path from list_folders.';

export function findRoleFolder<T extends FolderInfo>(folders: T[], role: FolderRole): T | undefined {
  const flagged = folders.filter((folder) => folder.specialUse === ROLE_FLAGS[role]);
  const declared = flagged.find((folder) => folder.specialUseSource !== 'name');
  if (declared ?? flagged[0]) return declared ?? flagged[0];
  return role === 'inbox' ? folders.find((folder) => folder.path.toUpperCase() === 'INBOX') : undefined;
}

export function resolveFolder<T extends FolderInfo>(folders: T[], input: string): T {
  const role = ROLE_NAMES[input.trim().toLowerCase()];
  if (role) {
    const folder = findRoleFolder(folders, role);
    if (folder) return folder;
  }
  const exact = folders.find((folder) => folder.path === input);
  if (exact) return exact;
  const what = role ? `No ${role} folder found` : `Folder "${input}" not found`;
  throw new Error(`${what}. Available folders: ${folders.map((folder) => folder.path).join(', ')}`);
}
