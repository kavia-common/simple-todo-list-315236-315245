import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders todo list header and filters", () => {
  render(<App />);
  const title = screen.getByText(/todo list/i);
  expect(title).toBeInTheDocument();

  // Minimal verification for new filtering controls
  expect(screen.getByLabelText(/priority/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
});
