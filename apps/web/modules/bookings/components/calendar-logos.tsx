/**
 * Brand marks for the "Add it to your calendar" buttons on the booked page.
 * Sized by the caller. Decorative: the button text already names the service.
 */

const mark = "h-5 w-5 shrink-0";

export function CalendarServiceLogo({ label }: { label: string }) {
  switch (label) {
    case "Google":
      return <GoogleCalendarLogo />;
    case "Outlook":
      return <OutlookLogo />;
    case "Office 365":
      return <Office365Logo />;
    case "Apple / other":
      return <AppleCalendarLogo />;
    default:
      return null;
  }
}

function GoogleCalendarLogo() {
  return (
    <svg viewBox="186 38 76 76" className={mark} aria-hidden="true">
      <path fill="#fff" d="M244 56h-40v40h40V56z" />
      <path fill="#EA4335" d="M244 114l18-18h-18v18z" />
      <path fill="#FBBC04" d="M262 56h-18v40h18V56z" />
      <path fill="#34A853" d="M244 96h-40v18h40V96z" />
      <path fill="#188038" d="M186 96v12c0 3.315 2.685 6 6 6h12V96h-18z" />
      <path fill="#1967D2" d="M262 56V44c0-3.315-2.685-6-6-6h-12v18h18z" />
      <path fill="#4285F4" d="M244 38h-52c-3.315 0-6 2.685-6 6v52h18V56h40V38z" />
      <path
        fill="#4285F4"
        d="M212.205 87.03c-1.495-1.01-2.53-2.485-3.095-4.435l3.47-1.43c.315 1.2.865 2.13 1.65 2.79.78.66 1.73.985 2.84.985 1.135 0 2.11-.345 2.925-1.035s1.225-1.57 1.225-2.635c0-1.09-.43-1.98-1.29-2.67-.86-.69-1.94-1.035-3.23-1.035h-2.005V74.13h1.8c1.11 0 2.045-.3 2.805-.9.76-.6 1.14-1.42 1.14-2.465 0-.93-.34-1.67-1.02-2.225-.68-.555-1.54-.835-2.585-.835-1.02 0-1.83.27-2.43.815a4.784 4.784 0 0 0-1.31 2.005l-3.435-1.43c.455-1.29 1.29-2.43 2.515-3.415 1.225-.985 2.79-1.48 4.69-1.48 1.405 0 2.67.27 3.79.815 1.12.545 2 1.3 2.635 2.26.635.965.95 2.045.95 3.245 0 1.225-.295 2.26-.885 3.11-.59.85-1.315 1.5-2.175 1.955v.205a6.605 6.605 0 0 1 2.79 2.175c.725.975 1.09 2.14 1.09 3.5 0 1.36-.345 2.575-1.035 3.64s-1.645 1.905-2.855 2.515c-1.215.61-2.58.92-4.095.92-1.755.005-3.375-.5-4.87-1.51zM233.52 69.81l-3.81 2.755-1.905-2.89 6.835-4.93h2.62V88h-3.74V69.81z"
      />
    </svg>
  );
}

function OutlookLogo() {
  return (
    <svg viewBox="0 0 24 24" className={mark} aria-hidden="true">
      <path fill="#28A8EA" d="M14 3.5h7.4c.9 0 1.6.7 1.6 1.6v13.8c0 .9-.7 1.6-1.6 1.6H14V3.5Z" />
      <path fill="#0F6CBD" d="M14 3.5h9v3.4L14 10.6V3.5Z" />
      <path fill="#0A4A8A" d="M1.8 6.1C1.8 4.9 2.7 4 3.9 4H14v16H3.9c-1.2 0-2.1-.9-2.1-2.1V6.1Z" />
      <path
        fill="#fff"
        d="M8.1 8.2c-2.3 0-3.9 1.8-3.9 3.8s1.6 3.8 3.9 3.8 3.9-1.8 3.9-3.8-1.6-3.8-3.9-3.8Zm0 5.7c-1.15 0-1.9-.9-1.9-1.9s.75-1.9 1.9-1.9 1.9.9 1.9 1.9-.75 1.9-1.9 1.9Z"
      />
    </svg>
  );
}

function Office365Logo() {
  return (
    <svg viewBox="0 0 16 16" className={mark} aria-hidden="true">
      <rect width="7" height="7" rx="0.6" fill="#F25022" />
      <rect x="9" width="7" height="7" rx="0.6" fill="#7FBA00" />
      <rect y="9" width="7" height="7" rx="0.6" fill="#00A4EF" />
      <rect x="9" y="9" width="7" height="7" rx="0.6" fill="#FFB900" />
    </svg>
  );
}

function AppleCalendarLogo() {
  return (
    <svg viewBox="0 0 267 268" className={mark} aria-hidden="true">
      <path
        d="M208.2 266.5H58.4C26.6 266.5 0.9 240.7 0.9 209V59.3C0.9 27.5 26.7 1.8 58.4 1.8H208.1C239.9 1.8 265.6 27.6 265.6 59.3V209C265.7 240.8 239.9 266.5 208.2 266.5Z"
        fill="#FCFCFC"
      />
      <path
        d="M198 111V119.8C175.7 154 161.9 189.5 156.5 226.3H146.6C152.3 189.2 166.3 153.7 188.8 119.8H130.7V111H198Z"
        fill="#5A5A5A"
      />
      <path
        d="M91.8 111C90.9 114.9 89.3 119.8 85.6 122.8C82 125.8 75 127.3 68.2 127.7V133.9H91.7V226.2H101.4V111H91.8Z"
        fill="#5A5A5A"
      />
      <path
        d="M265.8 80.8V60.7C265.8 28 239.3 1.4 206.5 1.4H60.2C27.5 1.4 0.9 27.9 0.9 60.7V80.8H265.8Z"
        fill="#E9574E"
      />
    </svg>
  );
}
