import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Banner, ContextBar, StatusBar, contextBarCells, formatTokens } from "../../src/tui/components.js";

describe("formatTokens", () => {
  it("abbreviates thousands and millions, and leaves small counts alone", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(742)).toBe("742");
    expect(formatTokens(279_829)).toBe("280k");
    expect(formatTokens(1_000_000)).toBe("1.0M");
  });
});

describe("contextBarCells", () => {
  it("fills nothing at zero usage", () => {
    expect(contextBarCells(0, 1000)).toMatchObject({ filled: 0, percent: 0 });
  });

  it("fills the whole bar at capacity", () => {
    const cells = contextBarCells(1000, 1000);
    expect(cells.empty).toBe(0);
    expect(cells.percent).toBe(100);
  });

  // A bar reading completely empty while tokens are being spent is worse than
  // being one cell optimistic.
  it("shows at least one cell for any non-zero usage", () => {
    expect(contextBarCells(1, 1_000_000).filled).toBe(1);
  });

  // Otherwise a conversation past the window renders a bar wider than its
  // frame and the status line wraps.
  it("clamps past capacity instead of overflowing the bar", () => {
    const cells = contextBarCells(2000, 1000);
    expect(cells.empty).toBe(0);
    expect(cells.percent).toBe(100);
  });

  it("does not divide by zero when the window is unknown", () => {
    expect(contextBarCells(500, 0)).toMatchObject({ filled: 1, percent: 0 });
  });
});

describe("ContextBar", () => {
  it("shows used, total and percentage", () => {
    const { lastFrame } = render(<ContextBar used={279_829} total={1_000_000} />);

    expect(lastFrame()).toContain("280k/1.0M");
    expect(lastFrame()).toContain("28%");
  });
});

describe("StatusBar", () => {
  const base = { provider: "9router", model: "ComboOP", contextWindow: 200_000, busy: false, frame: 0 };

  it("shows the mode, provider and model", () => {
    const { lastFrame } = render(<StatusBar {...base} mode="accept-edits" usedTokens={1000} />);

    expect(lastFrame()).toContain("[accept-edits]");
    expect(lastFrame()).toContain("9router/ComboOP");
  });

  it("shows the branch when in a repository", () => {
    const { lastFrame } = render(<StatusBar {...base} mode="ask" branch="feat/forge-cli" usedTokens={1000} />);

    expect(lastFrame()).toContain("feat/forge-cli");
  });

  it("says so when there is no repository", () => {
    const { lastFrame } = render(<StatusBar {...base} mode="ask" usedTokens={1000} />);

    expect(lastFrame()).toContain("no git");
  });

  // Several compatible servers never report usage; showing 0 would read as
  // "no context used", which is the opposite of the truth.
  it("distinguishes unreported usage from zero usage", () => {
    const { lastFrame } = render(<StatusBar {...base} mode="ask" />);

    expect(lastFrame()).toContain("not reported");
    expect(lastFrame()).not.toContain("0%");
  });

  it("offers the mode hint when idle and the interrupt hint when busy", () => {
    expect(render(<StatusBar {...base} mode="ask" />).lastFrame()).toContain("shift+tab");
    expect(render(<StatusBar {...base} mode="ask" busy />).lastFrame()).toContain("ctrl-c interrupt");
  });
});

describe("Banner", () => {
  it("shows version, provider, model and working directory", () => {
    const { lastFrame } = render(<Banner version="0.1.0" provider="9router" model="ComboOP" cwd="/work/forge" />);

    expect(lastFrame()).toContain("Forge 0.1.0");
    expect(lastFrame()).toContain("9router");
    expect(lastFrame()).toContain("ComboOP");
    expect(lastFrame()).toContain("/work/forge");
    expect(lastFrame()).toContain("? for shortcuts");
  });
});
