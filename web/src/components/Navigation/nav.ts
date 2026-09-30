// Navigation destinations shared by the phone tab bar, the More sheet and the desktop sidebar,
// so a route or a label changes in one place (docs/UX.md section 2 and the copy glossary).

/** Where "Practice" goes. Until the Practice screens ship this is the cards page. */
export function practiceHref(set: string): string {
  return `/s/${set}/cards`;
}

export function toReviewHref(set: string): string {
  return `/s/${set}/inbox`;
}

/** The set a phone "Notes"/"Practice" tab should open: the current one, else the last visited, else none. */
export function setHomeHref(set: string | null | undefined): string {
  return set ? `/s/${set}` : "/sets";
}

const TITLES: [RegExp, string][] = [
  [/^\/today/, "Today"],
  [/^\/sets/, "Study sets"],
  [/^\/library/, "Sources"],
  [/^\/jobs/, "Activity"],
  [/^\/settings/, "Settings"],
];

/** Header title for routes outside a study set ("" inside one: the set switcher shows the set). */
export function pageTitleFor(pathname: string): string {
  return TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? "";
}
