import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider, useDispatch, useSelector } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { viewReducer, setDays, setUnits } from "./viewSlice";
import { themeReducer } from "./themeSlice";
import { openMeteoApi } from "./openMeteoApi";
import { useUrlSync } from "./urlSync";
import type { DashboardState } from "./urlState";

type S = { view: DashboardState };

function Harness() {
  useUrlSync();
  const days = useSelector((s: S) => s.view.days);
  const units = useSelector((s: S) => s.view.units);
  const dispatch = useDispatch();
  const loc = useLocation();
  return (
    <div>
      <div data-testid="days">{days}</div>
      <div data-testid="units">{units}</div>
      <div data-testid="search">{loc.search}</div>
      <button onClick={() => dispatch(setDays(3))}>days3</button>
      <button onClick={() => dispatch(setUnits("imperial"))}>toF</button>
    </div>
  );
}

function renderAt(path: string) {
  const store = configureStore({
    reducer: { [openMeteoApi.reducerPath]: openMeteoApi.reducer, view: viewReducer, theme: themeReducer },
    middleware: (gdm) => gdm().concat(openMeteoApi.middleware),
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Harness />
      </MemoryRouter>
    </Provider>,
  );
}

describe("useUrlSync", () => {
  it("store → URL: a view change is written to the query string (and not clobbered back)", async () => {
    renderAt("/");
    expect(screen.getByTestId("days")).toHaveTextContent("10");
    await userEvent.click(screen.getByText("days3"));
    // The change reaches the URL...
    await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent("days=3"));
    // ...and, critically, does NOT get reset by the opposite effect (the race bug).
    expect(screen.getByTestId("days")).toHaveTextContent("3");
  });

  it("URL → store: an incoming query string hydrates the view slice", async () => {
    renderAt("/?units=imperial&days=5");
    await waitFor(() => expect(screen.getByTestId("units")).toHaveTextContent("imperial"));
    expect(screen.getByTestId("days")).toHaveTextContent("5");
  });

  it("two store changes in a row both survive (no feedback clobber)", async () => {
    renderAt("/");
    await userEvent.click(screen.getByText("days3"));
    await userEvent.click(screen.getByText("toF"));
    await waitFor(() => {
      expect(screen.getByTestId("search")).toHaveTextContent("days=3");
      expect(screen.getByTestId("search")).toHaveTextContent("units=imperial");
    });
    expect(screen.getByTestId("days")).toHaveTextContent("3");
    expect(screen.getByTestId("units")).toHaveTextContent("imperial");
  });
});
