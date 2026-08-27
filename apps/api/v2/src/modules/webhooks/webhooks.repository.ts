import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { Injectable } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";

import type { Webhook } from "@calcom/prisma/client";

import { PrismaWriteService } from "../prisma/prisma-write.service";

type WebhookInputData = Pick<
  Webhook,
  "payloadTemplate" | "eventTriggers" | "subscriberUrl" | "secret" | "active"
>;

@Injectable()
export class WebhooksRepository {
  constructor(
    private readonly dbRead: PrismaReadService,
    private readonly dbWrite: PrismaWriteService
  ) {}

  async createUserWebhook(userId: number, data: WebhookInputData) {
    const id = uuidv4();
    return this.dbWrite.prisma.webhook.create({
      data: { ...data, id, userId },
    });
  }

  async createEventTypeWebhook(eventTypeId: number, data: WebhookInputData) {
    const id = uuidv4();
    return this.dbWrite.prisma.webhook.create({
      data: { ...data, id, eventTypeId },
    });
  }

  /**
   * Create-or-refresh keyed on (eventTypeId, subscriberUrl).
   *
   * A single atomic statement, resting on the @@unique([eventTypeId, subscriberUrl])
   * added for this. A find-then-create would be a race: two overlapping provisioning
   * calls — a double activation, or a retry after a request timed out at the ALB but
   * still landed — would both see no row and both insert, and every booking on that
   * event type would then deliver twice, which is the exact failure this endpoint
   * exists to prevent.
   *
   * `undefined` fields are left alone by Prisma on the update path, which is what
   * lets a caller omit `secret` without clearing the one already stored.
   */
  async upsertEventTypeWebhook(
    eventTypeId: number,
    data: Partial<WebhookInputData> & Pick<WebhookInputData, "subscriberUrl">
  ) {
    return this.dbWrite.prisma.webhook.upsert({
      where: { eventTypeId_subscriberUrl: { eventTypeId, subscriberUrl: data.subscriberUrl } },
      update: data,
      create: { ...data, id: uuidv4(), eventTypeId },
    });
  }

  async createOAuthClientWebhook(platformOAuthClientId: string, data: WebhookInputData) {
    const id = uuidv4();
    return this.dbWrite.prisma.webhook.create({
      data: { ...data, id, platformOAuthClientId },
    });
  }

  async updateWebhook(webhookId: string, data: Partial<WebhookInputData>) {
    return this.dbWrite.prisma.webhook.update({
      where: { id: webhookId },
      data,
    });
  }

  async getWebhookById(webhookId: string) {
    return this.dbRead.prisma.webhook.findFirst({
      where: { id: webhookId },
    });
  }

  async getWebhookSubscriberUrl(webhookId: string): Promise<string | undefined> {
    const webhook = await this.dbRead.prisma.webhook.findFirst({
      where: { id: webhookId },
      select: { subscriberUrl: true },
    });
    return webhook?.subscriberUrl ?? undefined;
  }

  async getUserWebhooksPaginated(userId: number, skip: number, take: number) {
    return this.dbRead.prisma.webhook.findMany({
      where: { userId },
      skip,
      take,
    });
  }

  async getEventTypeWebhooksPaginated(eventTypeId: number, skip: number, take: number) {
    return this.dbRead.prisma.webhook.findMany({
      where: { eventTypeId },
      skip,
      take,
    });
  }

  async getOAuthClientWebhooksPaginated(platformOAuthClientId: string, skip: number, take: number) {
    return this.dbRead.prisma.webhook.findMany({
      where: { platformOAuthClientId },
      skip,
      take,
    });
  }

  async getUserWebhookByUrl(userId: number, subscriberUrl: string) {
    return this.dbRead.prisma.webhook.findFirst({
      where: { userId, subscriberUrl },
    });
  }

  async getOAuthClientWebhookByUrl(platformOAuthClientId: string, subscriberUrl: string) {
    return this.dbRead.prisma.webhook.findFirst({
      where: { platformOAuthClientId, subscriberUrl },
    });
  }

  async getEventTypeWebhookByUrl(eventTypeId: number, subscriberUrl: string) {
    return this.dbRead.prisma.webhook.findFirst({
      where: { eventTypeId, subscriberUrl },
    });
  }

  async deleteWebhook(webhookId: string) {
    return this.dbWrite.prisma.webhook.delete({
      where: { id: webhookId },
    });
  }

  async deleteAllEventTypeWebhooks(eventTypeId: number) {
    return this.dbWrite.prisma.webhook.deleteMany({
      where: { eventTypeId },
    });
  }

  async deleteAllOAuthClientWebhooks(oAuthClientId: string) {
    return this.dbWrite.prisma.webhook.deleteMany({
      where: { platformOAuthClientId: oAuthClientId },
    });
  }
}
