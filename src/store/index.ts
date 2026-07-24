// The single Redux store: server cache (RTK Query) + view state + theme.

import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { useDispatch, useSelector } from "react-redux";
import { openMeteoApi } from "./openMeteoApi";
import { viewReducer } from "./viewSlice";
import { themeReducer } from "./themeSlice";

export const store = configureStore({
  reducer: {
    [openMeteoApi.reducerPath]: openMeteoApi.reducer,
    view: viewReducer,
    theme: themeReducer,
  },
  middleware: (getDefault) => getDefault().concat(openMeteoApi.middleware),
});

// Enables focus/online tracking so the 10-minute polling can pause while the tab
// is backgrounded (skipPollingIfUnfocused). We don't set refetchOnFocus, so this
// doesn't cause extra refetches on its own.
setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
