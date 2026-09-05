import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AdminTabList, type AdminTabItem } from "./AdminTabList";

const SHORT: readonly AdminTabItem<"a" | "b">[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
];

const LONG: readonly AdminTabItem<string>[] = [
  { id: "one", label: "One" },
  { id: "two", label: "Two" },
  { id: "three", label: "Three" },
  { id: "four", label: "Four" },
  { id: "five", label: "Five" },
  { id: "six", label: "Six" },
  { id: "seven", label: "Seven" },
];

function ShortTabs() {
  const [active, setActive] = useState<"a" | "b">("a");
  return (
    <AdminTabList
      tabs={SHORT}
      active={active}
      onChange={setActive}
      label="Short sections"
      idPrefix="short"
      panelId="short-panel"
    />
  );
}

describe("AdminTabList", () => {
  it("activates the next tab on ArrowRight", async () => {
    const user = userEvent.setup();
    render(<ShortTabs />);
    const first = screen.getByRole("tab", { name: "Alpha" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders a native select when there are more than six tabs", () => {
    render(
      <AdminTabList
        tabs={LONG}
        active="one"
        onChange={() => undefined}
        label="Many sections"
        idPrefix="many"
      />,
    );
    const select = screen.getByRole("combobox", { name: "Many sections" });
    expect(select.tagName).toBe("SELECT");
    expect(select.id).toBe("many-select");
  });

  it("disables every tab when the list is disabled", () => {
    render(
      <AdminTabList
        tabs={SHORT}
        active="a"
        onChange={() => undefined}
        label="Disabled sections"
        disabled
      />,
    );
    expect(screen.getByRole("tab", { name: "Alpha" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Beta" })).toBeDisabled();
  });
});
