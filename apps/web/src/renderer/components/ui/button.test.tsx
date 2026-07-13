/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Button, buttonVariants } from "./button"

afterEach(cleanup)

describe("Button", () => {
  it("renders a native button with the default variant and size", () => {
    render(<Button>Go</Button>)
    const button = screen.getByRole("button", { name: "Go" })
    expect(button.tagName).toBe("BUTTON")
    expect(button.className).toContain("bg-primary")
    expect(button.className).toContain("text-primary-foreground")
    expect(button.className).toContain("h-9")
    expect(button.getAttribute("data-slot")).toBe("button")
  })

  it("applies the secondary variant classes", () => {
    render(<Button variant="secondary">Cancel</Button>)
    expect(screen.getByRole("button").className).toContain("bg-secondary")
  })

  it("applies the outline variant classes", () => {
    render(<Button variant="outline">Outline</Button>)
    const cls = screen.getByRole("button").className
    expect(cls).toContain("border")
    expect(cls).not.toContain("bg-primary")
  })

  it("applies the ghost variant classes", () => {
    render(<Button variant="ghost">Ghost</Button>)
    const cls = screen.getByRole("button").className
    expect(cls).toContain("hover:bg-accent")
    expect(cls).not.toContain("bg-primary")
  })

  it("applies the destructive variant classes", () => {
    render(<Button variant="destructive">Delete</Button>)
    expect(screen.getByRole("button").className).toContain("bg-destructive")
  })

  it("applies each size", () => {
    expect(buttonVariants({ size: "sm" })).toContain("h-8")
    expect(buttonVariants({ size: "default" })).toContain("h-9")
    expect(buttonVariants({ size: "lg" })).toContain("h-10")
    expect(buttonVariants({ size: "icon" })).toContain("size-9")
  })

  it("renders as a child element when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/somewhere">Link</a>
      </Button>
    )
    const link = screen.getByRole("link", { name: "Link" })
    expect(link.tagName).toBe("A")
    expect(link.className).toContain("bg-primary")
  })

  it("forwards the disabled attribute", () => {
    render(<Button disabled>Nope</Button>)
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true)
  })
})
