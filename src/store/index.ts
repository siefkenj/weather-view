// The single Redux store: server cache (RTK Query) + view state + theme.

import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { useDispatch, useSelector } from "react-redux";
import { openMeteoApi } from "./openMeteoApi";
import { viewReducer } from "./viewSlice";
import { themeReducer } from "./themeSlice";
import { readoutReducer } from "./readoutSlice";

export const store = configureStore({
  reducer: {
    [openMeteoApi.reducerPath]: openMeteoApi.reducer,
    view: viewReducer,
    theme: themeReducer,
    readout: readoutReducer,
  },
  middleware: (getDefault) => getDefault().concat(openMeteoApi.middleware),
});

// Enables focus/online tracking used by the live weather queries (hooks/useWeather.ts):
// polling pauses while the tab is backgrounded (skipPollingIfUnfocused), and those
// queries refetch on tab-refocus / reconnect (refetchOnFocus / refetchOnReconnect, set
// per-hook so the low-priority map grids and ensemble aren't affected).
setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
