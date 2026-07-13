/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Alert, AlertTitle, AlertDescription } from "./alert"

afterEach(cleanup)

describe("Alert", () => {
  it("exposes role=alert and renders its children", () => {
    render(<Alert>Something happened</Alert>)
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("Something happened")
    expect(alert.getAttribute("data-slot")).toBe("alert")
  })

  it("uses the default variant classes when no variant is given", () => {
    render(<Alert>Default</Alert>)
    expect(screen.getByRole("alert").className).toContain("bg-card")
  })

  it("uses destructive token classes for the destructive variant", () => {
    render(<Alert variant="destructive">Boom</Alert>)
    const cls = screen.getByRole("alert").className
    expect(cls).toContain("bg-destructive/10")
    expect(cls).toContain("text-destructive")
    expect(cls).not.toContain("text-red-200")
  })

  it("renders optional title and description slots", () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Title</AlertTitle>
        <AlertDescription>Detail text</AlertDescription>
      </Alert>
    )
    expect(screen.getByText("Title").getAttribute("data-slot")).toBe("alert-title")
    expect(screen.getByText("Detail text").getAttribute("data-slot")).toBe(
      "alert-description"
    )
  })
})
