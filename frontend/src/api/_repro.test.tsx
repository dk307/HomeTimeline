import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import { api } from "./client";

function Probe() {
  const { data } = useQuery({
    queryKey: ["probe"],
    queryFn: ({ signal }) => {
      // eslint-disable-next-line no-console
      console.log("[probe] fetch start, aborted=", signal.aborted);
      signal.addEventListener("abort", () => console.log("[probe] SIGNAL ABORTED"));
      return api.get<{ v: number }>("/probe", signal);
    },
  });
  return <div>value:{data?.v ?? "none"}</div>;
}

describe("repro", () => {
  it("delivers data when signal is consumed", async () => {
    server.use(http.get("/api/v1/probe", () => HttpResponse.json({ v: 42 })));
    renderWithClient(<Probe />);
    expect(await screen.findByText("value:42")).toBeInTheDocument();
  });
});
