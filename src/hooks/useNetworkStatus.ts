import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe, type NetworkStatus } from "../status/statusStore";

/** Live view of in-flight + recently-failed network requests for <StatusBar>. */
export function useNetworkStatus(): NetworkStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
