declare module "@calcom/lib/rbp/hidden-settings" {
  export const RBP_HIDDEN_SETTINGS_PATHS: string[];
  export const RBP_HIDDEN_SETTINGS_SECTIONS: string[];
  export const RBP_HIDDEN_SETTINGS_REDIRECT: string;

  /** Only `href` and `children` are read, so any nav-item shape passes through. */
  export function stripHiddenSettings<T extends { href?: string; children?: T[] }>(
    tabs: T[]
  ): T[];
}
