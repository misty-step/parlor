// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AvatarBadge, ConnectionStatus, QRCodeDisplay, RoomCodeInput } from "../src/index.js";

afterEach(cleanup);

const descriptor = {
  key: "teal-circle",
  background: "#073b3a",
  foreground: "#f2f7f4",
  shape: "circle",
};

describe("RoomCodeInput", () => {
  it("normalizes pasted room-code text into the single input", () => {
    const onChange = vi.fn();
    render(<RoomCodeInput value="" onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: "Room code" });
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => " ab-cd ",
      },
    });

    expect(onChange).toHaveBeenCalledWith("ABCD");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("emits normalized changes and completion once the code is full", async () => {
    const onComplete = vi.fn();
    function ControlledInput() {
      const [value, setValue] = useState("");
      return <RoomCodeInput value={value} onChange={setValue} onComplete={onComplete} />;
    }

    const user = userEvent.setup();
    render(<ControlledInput />);
    const input = screen.getByRole("textbox", { name: "Room code" });
    await user.type(input, "a2b3");
    expect((input as HTMLInputElement).value).toBe("A2B3");

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("A2B3");
  });

  it("re-arms completion after an external controlled-value reset", () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    const { rerender } = render(
      <RoomCodeInput value="ABCD" onChange={onChange} onComplete={onComplete} />,
    );
    const input = screen.getByRole("textbox", { name: "Room code" });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onComplete).toHaveBeenCalledTimes(1);

    rerender(<RoomCodeInput value="" onChange={onChange} onComplete={onComplete} />);
    fireEvent.change(input, { target: { value: "ABCD" } });

    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith("ABCD");
  });
});

describe("accessible status and avatar components", () => {
  it("gives a named avatar badge an image role", () => {
    render(<AvatarBadge descriptor={descriptor} name="Ada Lovelace" />);

    expect(screen.getByRole("img", { name: "Ada Lovelace" })).toBeTruthy();
  });

  it("uses a polite atomic live region for connection changes", () => {
    const { rerender } = render(<ConnectionStatus status="connected" />);
    const status = screen.getByRole("status");

    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toContain("Connected");

    rerender(<ConnectionStatus status="disconnected" />);
    expect(status.textContent).toContain("Disconnected");
  });

  it("names the QR code for assistive technology", () => {
    render(<QRCodeDisplay value="room:ABCD" label="Scan to join room ABCD" />);

    expect(screen.getByRole("img", { name: "Scan to join room ABCD" })).toBeTruthy();
  });
});
