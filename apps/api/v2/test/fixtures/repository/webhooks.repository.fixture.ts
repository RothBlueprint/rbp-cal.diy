import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { TestingModule } from "@nestjs/testing";

import type { Prisma } from "@calcom/prisma/client";

export class WebhookRepositoryFixture {
  private primaReadClient: PrismaReadService["prisma"];
  private prismaWriteClient: PrismaWriteService["prisma"];

  constructor(module: TestingModule) {
    this.primaReadClient = module.get(PrismaReadService).prisma;
    this.prismaWriteClient = module.get(PrismaWriteService).prisma;
  }

  async create(data: Prisma.WebhookCreateInput) {
    return this.prismaWriteClient.webhook.create({ data });
  }

  async getAllByEventTypeId(eventTypeId: number) {
    // Write client on purpose: these are read-after-write assertions.
    return this.prismaWriteClient.webhook.findMany({ where: { eventTypeId } });
  }

  async getById(webhookId: string) {
    return this.prismaWriteClient.webhook.findUnique({ where: { id: webhookId } });
  }

  async setTriggers(webhookId: string, eventTriggers: Prisma.WebhookUpdateInput["eventTriggers"]) {
    return this.prismaWriteClient.webhook.update({ where: { id: webhookId }, data: { eventTriggers } });
  }

  async deactivate(webhookId: string) {
    return this.prismaWriteClient.webhook.update({ where: { id: webhookId }, data: { active: false } });
  }

  async delete(webhookId: string) {
    return this.prismaWriteClient.webhook.delete({ where: { id: webhookId } });
  }
}
