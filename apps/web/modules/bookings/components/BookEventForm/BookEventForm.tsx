import { getPaymentAppData } from "@calcom/app-store/_utils/payments/getPaymentAppData";
import { useIsPlatformBookerEmbed } from "@calcom/atoms/hooks/useIsPlatformBookerEmbed";
import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { useBookerTime } from "@calcom/features/bookings/Booker/hooks/useBookerTime";
import type { UseBookingFormReturnType } from "@calcom/features/bookings/Booker/hooks/useBookingForm";
import { formatEventFromTime } from "@calcom/features/bookings/Booker/utils/dates";
import type { BookerEvent } from "@calcom/features/bookings/types";
import dayjs from "@calcom/dayjs";
import ServerTrans from "@calcom/lib/components/ServerTrans";
import { WEBSITE_PRIVACY_POLICY_URL, WEBSITE_TERMS_URL } from "@calcom/lib/constants";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { useCompatSearchParams } from "@calcom/lib/hooks/useCompatSearchParams";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { TimeFormat } from "@calcom/lib/timeFormat";
import classNames from "@calcom/ui/classNames";
import { Alert } from "@calcom/ui/components/alert";
import { Button } from "@calcom/ui/components/button";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";
import { Form } from "@calcom/ui/components/form";
import type { TFunction } from "i18next";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { FieldError } from "react-hook-form";
import type { IUseBookingErrors, IUseBookingLoadingStates } from "../../hooks/useBookings";
import { RbpAppointmentSheet } from "../RbpAppointmentSheet";
import { BookingFields } from "./BookingFields";
import { FormSkeleton } from "./Skeleton";

type BookEventFormProps = {
  onCancel?: () => void;
  onSubmit: () => void;
  errorRef: React.RefObject<HTMLDivElement>;
  errors: UseBookingFormReturnType["errors"] & IUseBookingErrors;
  loadingStates: IUseBookingLoadingStates;
  bookingForm: UseBookingFormReturnType["bookingForm"];
  renderConfirmNotVerifyEmailButtonCond: boolean;
  extraOptions: Record<string, string | string[]>;
  isPlatform?: boolean;
  isVerificationCodeSending: boolean;
  isTimeslotUnavailable: boolean;
  shouldRenderCaptcha?: boolean;
  confirmButtonDisabled?: boolean;
  classNames?: {
    confirmButton?: string;
    backButton?: string;
  };
  timeslot: string | null;
};

export const BookEventForm = ({
  onCancel,
  eventQuery,
  onSubmit,
  errorRef,
  errors,
  loadingStates,
  renderConfirmNotVerifyEmailButtonCond,
  bookingForm,
  extraOptions,
  isVerificationCodeSending,
  isPlatform = false,
  isTimeslotUnavailable,
  shouldRenderCaptcha,
  confirmButtonDisabled,
  classNames: customClassNames,
  timeslot,
}: Omit<BookEventFormProps, "event"> & {
  eventQuery: {
    isError: boolean;
    isPending: boolean;
    data?: Pick<BookerEvent, "price" | "currency" | "metadata" | "bookingFields" | "locations" | "length"> | null;
  };
}) => {
  const eventType = eventQuery.data;
  const setFormValues = useBookerStoreContext((state) => state.setFormValues);
  const bookingData = useBookerStoreContext((state) => state.bookingData);
  const rescheduleUid = useBookerStoreContext((state) => state.rescheduleUid);
  const username = useBookerStoreContext((state) => state.username);
  const isPlatformBookerEmbed = useIsPlatformBookerEmbed();
  const { timeFormat, timezone } = useBookerTime();
  const selectedDuration = useBookerStoreContext((state) => state.selectedDuration);
  const searchParams = useCompatSearchParams();
  // rbp: the funnel already has the lead's name and email (the result page
  // prefills both), so they fold into one "Booking as" line. The inputs stay
  // mounted and validated, only not shown; Edit, or a validation error, opens
  // them.
  const [identityOpen, setIdentityOpen] = useState(false);

  const [responseVercelIdHeader] = useState<string | null>(null);
  const { t, i18n } = useLocale();

  const isPaidEvent = useMemo(() => {
    if (!eventType?.price) return false;
    const paymentAppData = getPaymentAppData(eventType);
    return eventType?.price > 0 && !Number.isNaN(paymentAppData.price) && paymentAppData.price > 0;
  }, [eventType]);

  const paymentCurrency = useMemo(() => {
    if (!eventType) return "USD";
    return getPaymentAppData(eventType)?.currency || "USD";
  }, [eventType]);

  if (eventQuery.isError) return <Alert severity="warning" message={t("error_booking_event")} />;
  if (eventQuery.isPending || !eventQuery.data) return <FormSkeleton />;
  if (!timeslot)
    return (
      <EmptyScreen
        headline={t("timeslot_missing_title")}
        description={t("timeslot_missing_description")}
        Icon="calendar"
        buttonText={t("timeslot_missing_cta")}
        buttonOnClick={onCancel}
      />
    );

  if (!eventType) {
    console.warn("No event type found for event", extraOptions);
    return <Alert severity="warning" message={t("error_booking_event")} />;
  }

  const watchedCfToken = bookingForm.watch("cfToken");

  const isRescheduleView = !!(rescheduleUid && bookingData);
  const responses = (bookingForm.watch("responses") || {}) as Record<string, unknown>;
  const nameResponse = responses.name as string | { firstName?: string; lastName?: string } | undefined;
  const bookingName =
    typeof nameResponse === "string"
      ? nameResponse
      : [nameResponse?.firstName, nameResponse?.lastName].filter(Boolean).join(" ");
  const bookingEmail = typeof responses.email === "string" ? responses.email : "";
  const responsesError = bookingForm.formState.errors.responses as
    | { message?: string; name?: unknown; email?: unknown }
    | undefined;
  const identityInvalid =
    !!responsesError &&
    (!!responsesError.name || !!responsesError.email || /^\{(name|email)\}/.test(responsesError.message ?? ""));
  const identityPrefilled = !!(searchParams?.get("name") && searchParams?.get("email"));
  const identityFolded =
    identityPrefilled && !!bookingName && !!bookingEmail && !identityOpen && !identityInvalid;

  return (
    <div className="flex flex-col h-full">
      <Form
        className="flex flex-col h-full"
        onChange={() => {
          // Form data is saved in store. This way when user navigates back to
          // still change the timeslot, and comes back to the form, all their values
          // still exist. This gets cleared when the form is submitted.
          const values = bookingForm.getValues();
          setFormValues(values);
        }}
        form={bookingForm}
        handleSubmit={onSubmit}
        noValidate>
        <AppointmentRecap
          timeslot={timeslot}
          duration={selectedDuration || eventType.length}
          timezone={timezone}
          timeFormat={timeFormat}
          heading={isRescheduleView ? "Your new time" : "Your appointment"}
          onChange={onCancel}
        />
        {identityFolded && (
          <div className="mb-5 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="bg-muted text-emphasis flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-[inset_0_1px_2px_rgba(60,45,20,0.12)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
              {bookingName.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 text-sm leading-snug">
              <p className="text-subtle">
                Booking as <span className="text-emphasis font-semibold">{bookingName}</span>
              </p>
              <p className="text-subtle truncate">{bookingEmail}</p>
            </div>
            {!isRescheduleView && (
              <button
                type="button"
                onClick={() => setIdentityOpen(true)}
                className="text-emphasis hover:bg-muted -mr-2 shrink-0 rounded-lg px-3 py-2.5 text-sm font-medium underline-offset-4 hover:underline">
                Edit
              </button>
            )}
          </div>
        )}
        {/* rbp: inputs are wells (inset shadow), set against the raised keys of
            the time picker; 48px tall, brand focus ring. */}
        <div
          className={classNames(
            "[&_label]:text-default [&_label]:text-[13px] [&_label]:font-medium [&_[data-testid=add-guests]]:-ms-3",
            "[&_input:not([type=checkbox]):not([type=radio])]:h-12 [&_input]:rounded-xl [&_input]:px-3.5 [&_input]:text-[15px]",
            "[&_textarea]:min-h-[88px] [&_textarea]:rounded-xl [&_textarea]:px-3.5 [&_textarea]:py-3 [&_textarea]:text-[15px] [&_textarea]:leading-normal",
            "[&_input]:shadow-[inset_0_1px_2px_rgba(60,45,20,0.10)] [&_textarea]:shadow-[inset_0_1px_2px_rgba(60,45,20,0.10)]",
            "dark:[&_input]:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] dark:[&_textarea]:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]",
            "[&_input:focus]:border-brand-default [&_textarea:focus]:border-brand-default",
            "[&_input:focus]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--cal-brand)_22%,transparent)] [&_textarea:focus]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--cal-brand)_22%,transparent)]"
          )}>
          <BookingFields
            isDynamicGroupBooking={!!(username && username.indexOf("+") > -1)}
            fields={eventType.bookingFields}
            locations={eventType.locations}
            rescheduleUid={rescheduleUid || undefined}
            bookingData={bookingData}
            isPaidEvent={isPaidEvent}
            paymentCurrency={paymentCurrency}
            foldedFields={identityFolded ? ["name", "email"] : undefined}
          />
        </div>
        {errors.hasFormErrors || errors.hasDataErrors ? (
          <div data-testid="booking-fail">
            <Alert
              ref={errorRef}
              className="my-2"
              severity="info"
              title={rescheduleUid ? t("reschedule_fail") : t("booking_fail")}
              message={getError({
                globalError: errors.formErrors,
                dataError: errors.dataErrors,
                t,
                responseVercelIdHeader,
                timeFormat,
                timezone,
                language: i18n.language,
              })}
            />
          </div>
        ) : isTimeslotUnavailable ? (
          <div data-testid="slot-not-allowed-to-book">
            <Alert
              severity="info"
              title={t("unavailable_timeslot_title")}
              message={
                <ServerTrans
                  t={t}
                  i18nKey="timeslot_unavailable_book_a_new_time"
                  components={[
                    <button
                      key="please-select-a-new-time-button"
                      type="button"
                      className="underline"
                      onClick={onCancel}>
                      Please select a new time
                    </button>,
                  ]}
                />
              }
            />
          </div>
        ) : null}

        {/* rbp: our terms in plain words. The stock line named the app ("Cal.diy"
            locally) and linked cal.com's terms in production. */}
        {!isPlatform && (
          <p className="text-subtle mb-4 mt-1 w-full text-xs">
            By booking, you agree to our{" "}
            <Link className="text-emphasis underline-offset-2 hover:underline" href={WEBSITE_TERMS_URL} target="_blank">
              Terms
            </Link>{" "}
            and{" "}
            <Link
              className="text-emphasis underline-offset-2 hover:underline"
              href={WEBSITE_PRIVACY_POLICY_URL}
              target="_blank">
              Privacy Policy
            </Link>
            .
          </p>
        )}

        {isPlatformBookerEmbed && (
          <div className="my-3 w-full text-xs text-subtle">
            {t("proceeding_agreement")}{" "}
            <Link
              className="text-emphasis hover:underline"
              key="terms"
              href={`${WEBSITE_TERMS_URL}`}
              target="_blank">
              {t("terms")}
            </Link>{" "}
            {t("and")}{" "}
            <Link
              className="text-emphasis hover:underline"
              key="privacy"
              href={`${WEBSITE_PRIVACY_POLICY_URL}`}
              target="_blank">
              {t("privacy_policy")}
            </Link>
            .
          </div>
        )}
        {/* rbp: one full-width primary. Back is "Change" on the recap above. */}
        <div className="mt-auto modalsticky">
          <Button
            type="submit"
            color="primary"
            disabled={
              (!!shouldRenderCaptcha && !watchedCfToken) || isTimeslotUnavailable || confirmButtonDisabled
            }
            loading={
              loadingStates.creatingBooking ||
              loadingStates.creatingRecurringBooking ||
              isVerificationCodeSending
            }
            className={classNames(
              "h-12 w-full justify-center rounded-[11px] text-[15px] font-semibold enabled:shadow-[0_8px_18px_-6px_color-mix(in_srgb,var(--cal-brand)_55%,transparent),inset_0_1px_0_rgba(255,255,255,0.25)]",
              customClassNames?.confirmButton
            )}
            data-testid={rescheduleUid && bookingData ? "confirm-reschedule-button" : "confirm-book-button"}>
            {rescheduleUid && bookingData
              ? "Move my appointment"
              : renderConfirmNotVerifyEmailButtonCond
                ? isPaidEvent
                  ? t("pay_and_book")
                  : "Confirm appointment"
                : t("verify_email_button")}
          </Button>
        </div>
      </Form>
    </div>
  );
};

/**
 * rbp: the pick, carried onto the form. The event-type details are hidden in
 * the embed, so without this the form never says which time is being booked.
 */
const AppointmentRecap = ({
  timeslot,
  duration,
  timezone,
  timeFormat,
  heading,
  onChange,
}: {
  timeslot: string;
  duration: number;
  timezone: string;
  timeFormat: string;
  heading: string;
  onChange?: () => void;
}) => {
  const start = dayjs.utc(timeslot).tz(timezone);
  return (
    <div className="mb-6">
      <RbpAppointmentSheet
        start={start}
        end={start.add(duration, "minute")}
        timezone={timezone}
        timeFormat={timeFormat}
        heading={heading}
        action={
          onChange && (
            <button
              type="button"
              onClick={onChange}
              data-testid="back"
              className="text-emphasis hover:bg-muted -my-2 -mr-2 rounded-lg px-3 py-2 text-sm font-medium underline-offset-4 hover:underline">
              Change
            </button>
          )
        }
      />
    </div>
  );
};

const getError = ({
  globalError,
  dataError,
  t,
  responseVercelIdHeader,
  timeFormat,
  timezone,
  language,
}: {
  globalError: FieldError | undefined;
  // It feels like an implementation detail to reimplement the types of useMutation here.
  // Since they don't matter for this function, I'd rather disable them then giving you
  // the cognitive overload of thinking to update them here when anything changes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataError: any;
  t: TFunction;
  responseVercelIdHeader: string | null;
  timeFormat: TimeFormat;
  timezone: string;
  language: string;
}) => {
  if (globalError) return globalError?.message;

  const error = dataError;

  let date = "";
  let count = 0;

  if (error.message === ErrorCode.BookerLimitExceededReschedule) {
    const formattedDate = formatEventFromTime({
      date: error.data.startTime,
      timeFormat,
      timeZone: timezone,
      language,
    });
    date = `${formattedDate.date} ${formattedDate.time}`;
  }

  if (error.message === ErrorCode.BookerLimitExceeded && error.data?.count) {
    count = error.data.count;
  }

  const messageKey =
    error.message === ErrorCode.BookerLimitExceeded ? "booker_upcoming_limit_reached" : error.message;

  return error?.message ? (
    <>
      {responseVercelIdHeader ?? ""} {t(messageKey, { date, count })}
      {error.data?.traceId && (
        <div className="mt-2 text-xs text-subtle">
          <span className="font-medium">{t("trace_reference_id")}:</span>
          <code className="ml-1 font-mono break-all select-all">{error.data.traceId}</code>
        </div>
      )}
    </>
  ) : (
    <>{t("can_you_try_again")}</>
  );
};
