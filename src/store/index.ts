// The single Redux store: server cache (RTK Query) + view state + theme.

import { configureStore } from "@reduxjs/toolkit";
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

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
