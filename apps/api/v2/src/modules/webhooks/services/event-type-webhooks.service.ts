import { PipedInputWebhookType } from "@/modules/webhooks/pipes/WebhookInputPipe";
import { validateWebhookUrl } from "@/modules/webhooks/utils/validate-webhook-url";
import { WebhooksRepository } from "@/modules/webhooks/webhooks.repository";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";

import { WebhookTriggerEvents } from "@calcom/prisma/enums";

export type UpsertEventTypeWebhookData = {
  subscriberUrl: string;
  eventTriggers: WebhookTriggerEvents[];
  active?: boolean;
  secret?: string;
  payloadTemplate?: string;
};

@Injectable()
export class EventTypeWebhooksService {
  constructor(private readonly webhooksRepository: WebhooksRepository) {}

  async createEventTypeWebhook(eventTypeId: number, body: PipedInputWebhookType) {
    validateWebhookUrl(body.subscriberUrl);

    if (body.eventTriggers.includes(WebhookTriggerEvents.DELEGATION_CREDENTIAL_ERROR)) {
      throw new BadRequestException(
        "DELEGATION_CREDENTIAL_ERROR trigger is only available for organization webhooks"
      );
    }

    const existingWebhook = await this.webhooksRepository.getEventTypeWebhookByUrl(
      eventTypeId,
      body.subscriberUrl
    );
    if (existingWebhook) {
      throw new ConflictException("Webhook with this subscriber url already exists for this event type");
    }
    return this.webhooksRepository.createEventTypeWebhook(eventTypeId, {
      ...body,
      payloadTemplate: body.payloadTemplate ?? null,
      secret: body.secret ?? null,
    });
  }

  /**
   * Create-or-refresh an event-type-scoped webhook, keyed on (eventTypeId, subscriberUrl).
   *
   * Unlike `createEventTypeWebhook` this does not 409 on a repeat call — it is the
   * provisioning path, which re-runs on every activation and must converge rather
   * than fail. `userId`/`teamId` are left NULL: event-type scope is the only shape
   * that delivers exactly once for a personal booking in this fork (a user-scoped row
   * also matches that user's round-robin bookings, and a team-scoped row never fires
   * at all — see UPSTREAM-BUGS.md #1).
   *
   * Ownership of `eventTypeId` is the caller's responsibility; this service has no
   * notion of who is asking.
   */
  async upsertEventTypeWebhook(eventTypeId: number, body: UpsertEventTypeWebhookData) {
    validateWebhookUrl(body.subscriberUrl);

    if (body.eventTriggers.includes(WebhookTriggerEvents.DELEGATION_CREDENTIAL_ERROR)) {
      throw new BadRequestException(
        "DELEGATION_CREDENTIAL_ERROR trigger is only available for organization webhooks"
      );
    }

    return this.webhooksRepository.upsertEventTypeWebhook(eventTypeId, {
      subscriberUrl: body.subscriberUrl,
      eventTriggers: body.eventTriggers,
      // `active` defaults on so a re-run reactivates a disabled webhook; `secret` and
      // `payloadTemplate` stay undefined when omitted, which Prisma reads as "don't
      // touch" on the update path. Clearing a working secret because the caller left
      // it out of the body would silently break signature verification downstream.
      active: body.active ?? true,
      secret: body.secret,
      payloadTemplate: body.payloadTemplate,
    });
  }

  getEventTypeWebhooksPaginated(eventTypeId: number, skip: number, take: number) {
    return this.webhooksRepository.getEventTypeWebhooksPaginated(eventTypeId, skip, take);
  }

  async deleteAllEventTypeWebhooks(eventTypeId: number): Promise<{ count: number }> {
    return this.webhooksRepository.deleteAllEventTypeWebhooks(eventTypeId);
  }
}
