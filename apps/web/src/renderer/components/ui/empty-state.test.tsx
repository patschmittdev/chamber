/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { EmptyState } from "./empty-state"

afterEach(cleanup)

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(<EmptyState title="Nothing here" description="Add one to begin" />)
    expect(screen.getByText("Nothing here")).toBeTruthy()
    expect(screen.getByText("Add one to begin")).toBeTruthy()
    expect(screen.getByText("Nothing here").closest("[data-slot=empty-state]")).toBeTruthy()
  })

  it("renders the icon when provided", () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="With icon"
      />
    )
    expect(screen.getByTestId("icon")).toBeTruthy()
  })

  it("renders the action when one is passed", () => {
    render(
      <EmptyState
        title="Empty"
        description="Nothing yet"
        action={<button type="button">Create</button>}
      />
    )
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy()
  })

  it("omits the action region when no action is passed", () => {
    render(<EmptyState title="Empty" description="Nothing yet" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
