import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders todo list header and filters", () => {
  render(<App />);
  const title = screen.getByText(/todo list/i);
  expect(title).toBeInTheDocument();

  // Minimal verification for filtering controls (accessibility labels)
  expect(screen.getByLabelText(/priority filter/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/status filter/i)).toBeInTheDocument();

  // New due date + due status filtering controls
  expect(screen.getByLabelText(/due date/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/due status filter/i)).toBeInTheDocument();
});
