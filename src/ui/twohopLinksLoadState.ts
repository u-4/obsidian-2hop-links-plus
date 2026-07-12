export interface TwohopLinksLoadIdentity {
  sourcePath: string;
  autoLoadTwoHopLinks: boolean;
}

export function getNextLoadedState(
  currentIsLoaded: boolean,
  previous: TwohopLinksLoadIdentity,
  next: TwohopLinksLoadIdentity
): boolean {
  if (
    previous.sourcePath !== next.sourcePath ||
    previous.autoLoadTwoHopLinks !== next.autoLoadTwoHopLinks
  ) {
    return next.autoLoadTwoHopLinks;
  }

  return currentIsLoaded;
}
