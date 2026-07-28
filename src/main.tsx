import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, RouterProvider, createHashRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { App } from "./App";
import { LocationPage } from "./LocationPage";
import { store } from "./store";
import { DEFAULT_PLACE, placeToSlug } from "./utils/place";
import "./index.css";

const router = createHashRouter(
  [
    {
      path: "/",
      element: <App />,
      children: [
        { index: true, element: <Navigate to={`/${placeToSlug(DEFAULT_PLACE)}`} replace /> },
        { path: ":slug", element: <LocationPage /> },
      ],
    },
  ],
  // Opt into the v7 data-router behaviour now to silence its future-flag warning.
  { future: { v7_relativeSplatPath: true } },
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Provider>
  </StrictMode>,
);
