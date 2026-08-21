/**
 * RBP: settings pages an agent must not reach.
 *
 * Agents are provisioned headlessly. rbp mints a single-use SSO token and drops
 * them into this app for the few things its own /calendar page deliberately does
 * not model — split shifts, date overrides, multiple calendars. They have no
 * password, never see a login screen, and hold no API credential. The settings
 * areas below are therefore either meaningless to them or actively harmful:
 *
 *   my-account/profile   Changing the username silently breaks their funnel.
 *                        rbp stores the booking page URL (Account.cal_booking_url)
 *                        built from the username at provisioning time and embeds
 *                        it on /a/<slug>. Rename here and that embed 404s —
 *                        prospects land on a dead page, the agent sees nothing
 *                        wrong, and Cal's admin API has no rename route, so rbp
 *                        cannot push the old name back.
 *   security/*           They have no password and no 2FA to manage; the account
 *                        is reachable only through rbp's SSO.
 *   developer/*          Webhooks, OAuth clients and API keys are ours. An agent
 *                        creating any of them is either a support ticket or a
 *                        credential nobody is tracking.
 *
 * WHY IT LIVES IN ITS OWN FILE: this fork tracks upstream. Deleting entries from
 * the nav array would put our diff inside a block upstream edits often, and every
 * merge would conflict. Filtering that array through one call keeps our change to
 * a single line there plus this file, which upstream will never touch.
 *
 * WHY .js RATHER THAN .ts: apps/web/next.config.ts imports this, and Next
 * evaluates that config with its own loader — importing workspace TypeScript from
 * it is unreliable. The one existing precedent in that file
 * (@calcom/i18n/next-i18next.config) is likewise .js with a .d.ts beside it, so
 * this follows the pattern already proven to work here.
 *
 * Hiding the nav is not the enforcement — the redirects in apps/web/next.config.ts
 * are, since a URL typed or reached from the command palette still resolves. Both
 * read this list so they cannot drift apart.
 */

/** Exact hrefs removed from the settings nav and redirected away. */
const RBP_HIDDEN_SETTINGS_PATHS = [
  "/settings/my-account/profile",
  // Timezone, time format and week start. rbp owns the working-hours timezone
  // through its own /calendar form and pushes it onto the Cal schedule; a second
  // place to set it is a second answer to the same question.
  "/settings/my-account/general",
  // Availability is set on rbp's page. An away-block set only here would be
  // invisible there, which reads as rbp losing the setting.
  "/settings/my-account/out-of-office",
  "/settings/security/password",
  "/settings/security/two-factor-auth",
  "/settings/developer/webhooks",
  "/settings/developer/oauth",
  "/settings/developer/api-keys",
];

/**
 * Whole sections removed from the nav, children and all.
 *
 * Not the same as "every child happens to be hidden". Developer still holds an
 * API-docs link pointing at /docs, and that route is not ours to redirect — it
 * is a real page, just not one an agent who cannot obtain an API key has any use
 * for. Dropping the section is the honest way to remove it without breaking a
 * top-level route for everyone.
 *
 * These hrefs are redirected as well, since the section landing pages resolve.
 */
const RBP_HIDDEN_SETTINGS_SECTIONS = ["/settings/security", "/settings/developer"];

/** Where a hidden page sends an agent instead. Somewhere they can act. */
const RBP_HIDDEN_SETTINGS_REDIRECT = "/settings/my-account/calendars";

/**
 * Drop hidden entries from a settings nav tree.
 *
 * A section whose children are all hidden is dropped too — leaving "Security"
 * with nothing under it reads as a broken page rather than a deliberate one.
 * Shape-agnostic on purpose: it only touches `href` and `children`, so it does
 * not depend on cal's UI types, which move between versions.
 */
function stripHiddenSettings(tabs) {
  const hidden = new Set(RBP_HIDDEN_SETTINGS_PATHS);
  const hiddenSections = new Set(RBP_HIDDEN_SETTINGS_SECTIONS);

  return tabs.reduce((kept, tab) => {
    if (tab.href && hidden.has(tab.href)) return kept;
    // A hidden SECTION goes wholesale, whatever it still contains.
    if (tab.href && hiddenSections.has(tab.href)) return kept;

    if (!tab.children || tab.children.length === 0) {
      kept.push(tab);
      return kept;
    }

    const children = stripHiddenSettings(tab.children);
    // Every child removed: the section has nothing left to show.
    if (children.length === 0) return kept;

    kept.push({ ...tab, children });
    return kept;
  }, []);
}

module.exports = {
  RBP_HIDDEN_SETTINGS_PATHS,
  RBP_HIDDEN_SETTINGS_SECTIONS,
  RBP_HIDDEN_SETTINGS_REDIRECT,
  stripHiddenSettings,
};
