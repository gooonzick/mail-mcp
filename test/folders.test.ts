import { describe, expect, test } from 'vitest';
import { findRoleFolder, resolveFolder, type FolderInfo } from '../src/folders.ts';

const folder = (path: string, specialUse?: string, specialUseSource?: FolderInfo['specialUseSource']): FolderInfo => ({
  path,
  specialUse,
  specialUseSource,
});

describe('special-use folder lookup', () => {
  test('server-declared SPECIAL-USE flag wins over a folder matched only by name', () => {
    const folders = [folder('INBOX', '\\Inbox', 'extension'), folder('Sent', '\\Sent', 'name'), folder('Sent Messages', '\\Sent', 'extension')];

    const sent = findRoleFolder(folders, 'sent');

    expect(sent?.path).toBe('Sent Messages');
  });

  test('localized name match is the fallback when no folder carries the flag', () => {
    const folders = [folder('INBOX', '\\Inbox', 'extension'), folder('INBOX.Отправленные', '\\Sent', 'name')];

    const sent = findRoleFolder(folders, 'sent');

    expect(sent?.path).toBe('INBOX.Отправленные');
  });

  test('missing role yields nothing', () => {
    const folders = [folder('INBOX', '\\Inbox', 'extension')];

    expect(findRoleFolder(folders, 'drafts')).toBeUndefined();
  });
});

describe('folder argument resolution', () => {
  const gmail = [
    folder('INBOX', '\\Inbox', 'extension'),
    folder('[Gmail]/Черновики', '\\Drafts', 'extension'),
    folder('[Gmail]/Отправленные', '\\Sent', 'extension'),
    folder('Clients/Acme'),
  ];

  test('role names resolve case-insensitively through special-use', () => {
    expect(resolveFolder(gmail, 'Drafts').path).toBe('[Gmail]/Черновики');
  });

  test('flagged resolves to the starred folder', () => {
    const folders = [...gmail, folder('[Gmail]/Помеченные', '\\Flagged', 'extension')];

    expect(resolveFolder(folders, 'flagged').path).toBe('[Gmail]/Помеченные');
  });

  test('an exact path is used as is', () => {
    expect(resolveFolder(gmail, 'Clients/Acme').path).toBe('Clients/Acme');
  });

  test('inbox resolves to INBOX', () => {
    expect(resolveFolder(gmail, 'inbox').path).toBe('INBOX');
  });

  test('unknown folder is an error that lists the available paths', () => {
    expect(() => resolveFolder(gmail, 'Archive 2019')).toThrow(/Clients\/Acme/);
  });
});
