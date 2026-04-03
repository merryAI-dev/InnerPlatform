import { describe, expect, it, vi } from 'vitest';
import {
  resolveProjectTeamMemberLookupKeys,
  tryRenameManagedProjectRootFolder,
} from './projects.mjs';

describe('project route helpers', () => {
  it('builds safe lookup keys when only nickname is present', () => {
    expect(resolveProjectTeamMemberLookupKeys({
      memberNickname: '보람',
      memberName: '',
    })).toEqual(['보람']);
  });

  it('builds safe lookup keys when only name is present', () => {
    expect(resolveProjectTeamMemberLookupKeys({
      memberNickname: '',
      memberName: '변민욱',
    })).toEqual(['변민욱']);
  });

  it('does not fail project save flow when managed Drive root rename throws', async () => {
    const logger = { error: vi.fn() };
    const driveService = {
      renameManagedProjectRootFolder: vi.fn(async () => {
        throw new Error('drive unavailable');
      }),
    };

    await expect(tryRenameManagedProjectRootFolder({
      driveService,
      projectId: 'p001',
      projectName: 'Updated Name',
      existingFolderId: 'folder-001',
      logger,
    })).resolves.toBeNull();

    expect(driveService.renameManagedProjectRootFolder).toHaveBeenCalledWith({
      projectId: 'p001',
      projectName: 'Updated Name',
      existingFolderId: 'folder-001',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
