export {
  ScheduleRepository,
  type FindDetailedScheduleByIdReturnType,
} from "@calcom/features/schedules/repositories/ScheduleRepository";

export {
  updateSchedule,
  type UpdateScheduleResponse,
} from "@calcom/features/schedules/services/ScheduleService";
export { UserAvailabilityService } from "@calcom/features/availability/lib/getUserAvailability";

export {
  createHandler as createScheduleHandler,
  type CreateScheduleHandlerReturn,
} from "@calcom/trpc/server/routers/viewer/availability/schedule/create.handler";
export { ZCreateInputSchema as CreateScheduleSchema } from "@calcom/trpc/server/routers/viewer/availability/schedule/create.schema";

export {
  listHandler as getAvailabilityListHandler,
  type GetAvailabilityListHandlerReturn,
} from "@calcom/trpc/server/routers/viewer/availability/list.handler";
export {
  duplicateHandler as duplicateScheduleHandler,
  type DuplicateScheduleHandlerReturn,
} from "@calcom/trpc/server/routers/viewer/availability/schedule/duplicate.handler";

export { getScheduleByEventSlugHandler } from "@calcom/trpc/server/routers/viewer/availability/schedule/getScheduleByEventTypeSlug.handler";

// rbp: GET /v2/users/:userId/availability-check (UsersAdminAvailabilityService) loads
// a user the way the slots path loads a host, then runs UserAvailabilityService on
// them directly. These are the three pieces of that load api/v2 cannot import itself.
export { availabilityUserSelect } from "@calcom/prisma/selects/user";
export { withSelectedCalendars } from "@calcom/lib/server/withSelectedCalendars";
export { default as dayjs } from "@calcom/dayjs";
