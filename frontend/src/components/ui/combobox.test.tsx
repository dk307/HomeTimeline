import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox, type ComboboxOption } from "./combobox";

const OPTIONS: ComboboxOption[] = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "America New York", group: "Americas" },
  { value: "Europe/Paris", label: "Europe Paris", group: "Europe" },
];

function setup(value = "") {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <Combobox options={OPTIONS} value={value} onChange={onChange} placeholder="Select a timezone" />,
  );
  return { onChange, user };
}

describe("<Combobox />", () => {
  it("shows the placeholder when nothing is selected", () => {
    setup();
    expect(screen.getByRole("button", { name: /Select a timezone/ })).toBeInTheDocument();
  });

  it("shows the selected option's label", () => {
    setup("Europe/Paris");
    expect(screen.getByRole("button", { name: /Europe Paris/ })).toBeInTheDocument();
  });

  it("opens a listbox of all options on click", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Select a timezone/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters options by the typed query", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button"));
    await user.type(screen.getByRole("combobox"), "paris");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Europe Paris");
  });

  it("shows a no-matches message when nothing matches", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button"));
    await user.type(screen.getByRole("combobox"), "zzzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("selects an option on click and closes", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("option", { name: /America New York/ }));
    expect(onChange).toHaveBeenCalledWith("America/New_York");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("selects via keyboard: ArrowDown then Enter", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button"));
    const input = screen.getByRole("combobox");
    await user.type(input, "{ArrowDown}{Enter}");
    // Active option starts at index 0 (UTC); one ArrowDown moves to America/New_York.
    expect(onChange).toHaveBeenCalledWith("America/New_York");
  });

  it("marks the current value as selected", async () => {
    const { user } = setup("UTC");
    await user.click(screen.getByRole("button", { name: /UTC/ }));
    expect(screen.getByRole("option", { name: /UTC/ })).toHaveAttribute("aria-selected", "true");
  });
});
