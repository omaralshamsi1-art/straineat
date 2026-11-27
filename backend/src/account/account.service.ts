import { AiUsageLog } from '../usage/ai-usage';
import { ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { REPOSITORY, Repository } from '../storage/repository';
import { WhoopService } from '../integrations/whoop/whoop.service';
import { GroupsService } from '../groups/groups.service';

/**
 * Self-service account deletion (App Store guideline 5.1.1(v)): revokes third-party access,
 * then permanently deletes every row that belongs to the user, including the login itself.
 */
@Injectable()
export class AccountService {
  private readonly log = new Logger('Account');
  constructor(@Inject(REPOSITORY) private readonly repo: Repository, @Optional() private readonly whoop?: WhoopService, @Optional() private readonly groups?: GroupsService, @Optional() private readonly usage?: AiUsageLog) {}

  async deleteAccount(userId: string, role: 'owner' | 'user' | undefined, confirm: string | undefined) {
    if (String(confirm ?? '').trim().toUpperCase() !== 'DELETE') {
      throw new ForbiddenException('Type DELETE to confirm');
    }
    if (role === 'owner') throw new ForbiddenException('The owner account can’t be deleted from the app');
    const whoopRevoked = (await this.whoop?.revokeAccess(userId).catch(() => false)) ?? false;
    await this.groups?.removeEverywhere(userId).catch(() => undefined);
    await this.usage?.forget(userId).catch(() => undefined);
    const removed = await this.repo.deleteUserData(userId);
    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    this.log.log(`deleted account ${userId.slice(0, 3)}… (${total} rows, whoop revoked: ${whoopRevoked})`);
    return { deleted: true, whoopRevoked, removed };
  }
}
